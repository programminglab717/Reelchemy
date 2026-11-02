import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  open,
  rm,
  rename,
  symlink,
  readdir,
  readlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { privateFileResponse } from "../src/lib/private-file";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-private-file-"));
after(() => rm(root, { recursive: true, force: true }));
const request = (range?: string, init: RequestInit = {}) =>
  new Request("http://localhost/private", {
    ...init,
    headers: { ...(range ? { range } : {}), ...init.headers },
  });
async function handles() {
  const links = await Promise.all(
    (await readdir("/proc/self/fd")).map((fd) =>
      readlink(`/proc/self/fd/${fd}`).catch(() => ""),
    ),
  );
  return links.filter((name) => name.startsWith(root)).length;
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
test("private delivery preserves exact whole/range/suffix bytes, HEAD and empty files with private errors and no leaked descriptors", async () => {
  const bytes = Buffer.from(Array.from({ length: 200000 }, (_, i) => i % 251));
  await writeFile(path.join(root, "film.mp4"), bytes);
  for (const [range, start, end, status] of [
    [undefined, 0, bytes.length - 1, 200],
    ["bytes=15-32", 15, 32, 206],
    ["bytes=199998-", 199998, 199999, 206],
    ["bytes=-11", 199989, 199999, 206],
    ["bytes=199997-999999", 199997, 199999, 206],
  ] as const) {
    const response = await privateFileResponse(
      request(range),
      root,
      ["film.mp4"],
      "video/mp4",
      'attachment; filename="film.mp4"',
    );
    assert.equal(response.status, status);
    privateHeaders(response);
    assert.equal(
      response.headers.get("content-length"),
      String(end - start + 1),
    );
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(start, end + 1),
    );
  }
  for (const range of [
    "bytes=200000-",
    "bytes=2-1",
    "bytes=-0",
    "bytes=0-1,4-5",
    "items=0-5",
  ]) {
    const response = await privateFileResponse(
      request(range),
      root,
      ["film.mp4"],
      "video/mp4",
    );
    assert.equal(response.status, 416);
    privateHeaders(response);
    assert.equal(response.headers.get("content-range"), "bytes */200000");
    assert.equal(await response.text(), "");
  }
  const head = await privateFileResponse(
    request("bytes=0-1", { method: "HEAD" }),
    root,
    ["film.mp4"],
    "video/mp4",
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "200000");
  assert.equal(head.body, null);
  const conditional = await privateFileResponse(
    request(undefined, {
      headers: { range: "bytes=0-3", "if-range": '"unknown-validator"' },
    }),
    root,
    ["film.mp4"],
    "video/mp4",
  );
  assert.equal(conditional.status, 200);
  assert.deepEqual(Buffer.from(await conditional.arrayBuffer()), bytes);
  await writeFile(path.join(root, "empty.srt"), "");
  const empty = await privateFileResponse(
    request(),
    root,
    ["empty.srt"],
    "text/plain",
  );
  assert.equal(empty.status, 200);
  assert.equal(empty.body, null);
  assert.equal(await handles(), 0);
});
test("a gigabyte sparse download is pull-driven and cancellation/abort releases the descriptor without reading the remainder", async () => {
  const file = await open(path.join(root, "large.mp4"), "wx");
  await file.truncate(1024 ** 3);
  await file.close();
  const response = await privateFileResponse(
    request(),
    root,
    ["large.mp4"],
    "video/mp4",
  );
  assert.equal(response.headers.get("content-length"), String(1024 ** 3));
  assert.equal(await handles(), 1);
  const before = process.memoryUsage().arrayBuffers;
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.equal(first.value!.byteLength, 65536);
  assert(process.memoryUsage().arrayBuffers - before < 1024 ** 2);
  await reader.cancel();
  assert.equal(await handles(), 0);
  const abort = new AbortController();
  const interrupted = await privateFileResponse(
    request(undefined, { signal: abort.signal }),
    root,
    ["large.mp4"],
    "video/mp4",
  );
  abort.abort();
  await assert.rejects(
    interrupted.arrayBuffer(),
    /Private file transfer interrupted/,
  );
  // FileHandle.close completes after the abort callback's pending promise.
  for (let i = 0; i < 20 && (await handles()); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await handles(), 0);
  const stopped = await privateFileResponse(
    request(undefined, { signal: abort.signal }),
    root,
    ["large.mp4"],
    "video/mp4",
  );
  assert.equal(stopped.status, 404);
  assert.equal(await handles(), 0);
});
test("root/ancestor/directory/file symlinks, pipes and invalid components cannot serve external bytes or retain descriptors", async () => {
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "canary"), "PRIVATE_EXTERNAL_CANARY");
  const safe = path.join(root, "safe");
  await mkdir(safe);
  await symlink(path.join(outside, "canary"), path.join(safe, "linked"));
  await symlink(outside, path.join(safe, "directory"));
  await symlink(safe, path.join(root, "linked-root"));
  for (const [directory, names] of [
    [safe, ["linked"]],
    [safe, ["directory", "canary"]],
    [path.join(root, "linked-root"), ["linked"]],
    [path.join(root, "linked-root", "directory"), ["canary"]],
    [safe, ["../outside/canary"]],
    [safe, ["..", "outside", "canary"]],
    [safe, ["directory"]],
    [safe, ["absent"]],
  ] as const) {
    const response = await privateFileResponse(
      request(),
      directory,
      names,
      "text/plain",
    );
    assert.equal(response.status, 404);
    privateHeaders(response);
    assert.equal(await response.text(), "");
  }
  execFileSync("mkfifo", [path.join(safe, "pipe")]);
  const program = `const {privateFileResponse}=await import(${JSON.stringify(new URL("../src/lib/private-file.ts", import.meta.url).href)}); const r=await privateFileResponse(new Request('http://localhost/private'),process.argv[1],['pipe'],'text/plain'); console.log(r.status);`;
  const pipe = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", program, safe],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(pipe.status, 0, pipe.stderr);
  assert.equal(pipe.stdout.trim(), "404");
  assert.equal(
    await readFile(path.join(outside, "canary"), "utf8"),
    "PRIVATE_EXTERNAL_CANARY",
  );
  assert.equal(await handles(), 0);
});
test("a replaced parent cannot redirect an admitted stream, and same-inode truncation fails with a fixed private error", async () => {
  const directory = path.join(root, "original"),
    outside = path.join(root, "replacement");
  await mkdir(directory);
  await mkdir(outside);
  await writeFile(path.join(directory, "video.mp4"), "AUTHORIZED_ORIGINAL");
  await writeFile(
    path.join(outside, "video.mp4"),
    "PRIVATE_REPLACEMENT_CANARY",
  );
  const response = await privateFileResponse(
    request(),
    directory,
    ["video.mp4"],
    "video/mp4",
  );
  await rename(directory, `${directory}-held`);
  await symlink(outside, directory);
  assert.equal(await response.text(), "AUTHORIZED_ORIGINAL");
  const changing = path.join(root, "changing.mp4");
  await writeFile(changing, Buffer.alloc(200000, 4));
  const streamed = await privateFileResponse(
    request(),
    root,
    ["changing.mp4"],
    "video/mp4",
  );
  const reader = streamed.body!.getReader();
  assert.equal((await reader.read()).value!.length, 65536);
  await writeFile(changing, "PRIVATE_REPLACEMENT_SECRET");
  await assert.rejects(reader.read(), {
    message: "Private file transfer interrupted.",
  });
  for (let i = 0; i < 20 && (await handles()); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await handles(), 0);
});
