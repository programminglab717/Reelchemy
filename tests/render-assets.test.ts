import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readlink,
  readdir,
  rename,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { blankTimeline } from "../src/lib/editor";
import { CommandCancelledError } from "../src/lib/process";
import { sceneCacheKey } from "../src/lib/render-cache";
import type { Timeline } from "../src/lib/schema";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-render-assets-"));
process.env.REELCHEMY_DATA_DIR = dir;
const files = path.join(dir, "assets");
await mkdir(files);
const { serveRenderAssets } = await import("../src/lib/render-assets");
after(() => rm(dir, { recursive: true, force: true }));
function timeline(image: string, video?: string, audio?: string): Timeline {
  const t = blankTimeline({
    prompt: "Private media streams",
    duration: 5,
    format: "landscape",
  });
  const base = t.scenes[0].layers[0];
  t.scenes[0].layers = [{ ...base, kind: "image", assetId: image }];
  if (video)
    t.scenes[0].layers.push({
      ...base,
      id: "clip",
      kind: "video",
      assetId: video,
      video: {
        startFrame: 0,
        offsetFrames: 0,
        durationFrames: 150,
        volume: 1,
        audio: false,
        fit: "contain",
      },
    });
  if (audio)
    t.audioTracks = [
      {
        id: "voice",
        assetId: audio,
        startFrame: 0,
        offsetFrames: 0,
        durationFrames: 150,
        volume: 1,
        fadeFrames: 0,
      },
    ];
  return t;
}
async function asset(bytes: Buffer) {
  const id = randomUUID();
  await writeFile(path.join(files, id), bytes);
  return id;
}
async function openReferences(file: string) {
  const targets = await Promise.all(
    (await readdir("/proc/self/fd")).map((fd) =>
      readlink(`/proc/self/fd/${fd}`).catch(() => ""),
    ),
  );
  return targets.filter((target) => target === file).length;
}
test("only an immutable job allowlist is served, with correct media types, HEAD and bounded byte ranges", async () => {
  const buffers = [
    Buffer.from("normalized PNG fixture"),
    Buffer.from("normalized MP4 fixture"),
    Buffer.from("normalized WAV fixture"),
  ];
  const ids = await Promise.all(buffers.map(asset));
  const foreign = await asset(Buffer.from("Another project's private media"));
  const t = timeline(ids[0], ids[1], ids[2]);
  const serving = await serveRenderAssets(t);
  const urls = { ...serving.sources };
  try {
    for (const [index, mime] of [
      "image/png",
      "video/mp4",
      "audio/wav",
    ].entries()) {
      const url = urls[ids[index]];
      assert.equal(new URL(url).hostname, "127.0.0.1");
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), mime);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        buffers[index],
      );
      const head = await fetch(url, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(
        Number(head.headers.get("content-length")),
        buffers[index].length,
      );
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      const partial = await fetch(url, { headers: { Range: "bytes=2-6" } });
      assert.equal(partial.status, 206);
      assert.deepEqual(
        Buffer.from(await partial.arrayBuffer()),
        buffers[index].subarray(2, 7),
      );
      const suffix = await fetch(url, { headers: { Range: "bytes=-3" } });
      assert.deepEqual(
        Buffer.from(await suffix.arrayBuffer()),
        buffers[index].subarray(-3),
      );
      assert.equal(
        (await fetch(url, { headers: { Range: "bytes=0-1,3-4" } })).status,
        416,
      );
      assert.equal(
        (await fetch(url, { headers: { Range: "bytes=999-" } })).status,
        416,
      );
      assert.equal((await fetch(url, { method: "POST" })).status, 405);
      assert.equal(
        serving.fingerprints[ids[index]],
        createHash("sha256").update(buffers[index]).digest("hex"),
      );
    }
    const url = urls[ids[0]];
    assert.equal((await fetch(url.replace(ids[0], foreign))).status, 404);
    assert.equal((await fetch(new URL("/unknown", url))).status, 404);
    assert.equal((await fetch(url + "?file=auth.sqlite")).status, 404);
    assert.equal(
      (await fetch(url.replace(/\/[a-f0-9]{64}\//, `/${"0".repeat(64)}/`)))
        .status,
      404,
    );
    t.scenes[0].layers.push({
      ...t.scenes[0].layers[0],
      id: "late",
      assetId: foreign,
    });
    assert.equal(
      (await fetch(url.replace(ids[0], foreign))).status,
      404,
      "later object mutations cannot expand the server's allowlist",
    );
  } finally {
    await serving.close();
    await serving.close();
  }
  await assert.rejects(() =>
    fetch(urls[ids[0]], { signal: AbortSignal.timeout(2000) }),
  );
});
test("large media stays out of props, concurrent ranges share the snapshotted file and cache hashes ignore capabilities", async () => {
  const content = Buffer.alloc(20 * 1024 * 1024, 37);
  const id = await asset(content),
    t = timeline(id);
  const first = await serveRenderAssets(t),
    second = await serveRenderAssets(t);
  try {
    assert(JSON.stringify(first.sources).length < 300);
    assert.notEqual(first.sources[id], second.sources[id]);
    assert.equal(
      sceneCacheKey(t, first.sources, "renderer", first.fingerprints),
      sceneCacheKey(t, second.sources, "renderer", second.fingerprints),
    );
    const pieces = await Promise.all(
      Array.from({ length: 8 }, async (_, n) => {
        const start = n * 512 * 1024;
        const response = await fetch(first.sources[id], {
          headers: { Range: `bytes=${start}-${start + 1023}` },
        });
        assert.equal(response.status, 206);
        return Buffer.from(await response.arrayBuffer());
      }),
    );
    for (const piece of pieces)
      assert.deepEqual(piece, content.subarray(0, 1024));
    await rename(path.join(files, id), path.join(files, `${id}-old`));
    await writeFile(path.join(files, id), Buffer.from("Replacement path"));
    const original = await fetch(first.sources[id], {
      headers: { Range: "bytes=0-31" },
    });
    assert.deepEqual(
      Buffer.from(await original.arrayBuffer()),
      content.subarray(0, 32),
    );
    const changed = await serveRenderAssets(t);
    try {
      assert.notEqual(changed.fingerprints[id], first.fingerprints[id]);
      assert.notEqual(
        sceneCacheKey(t, changed.sources, "renderer", changed.fingerprints),
        sceneCacheKey(t, first.sources, "renderer", first.fingerprints),
      );
    } finally {
      await changed.close();
    }
  } finally {
    await first.close();
    await second.close();
  }
});
test(
  "invalid IDs, missing files, symlinks, pipes and mid-hash cancellation close every prepared descriptor",
  { timeout: 5000 },
  async () => {
    const id = await asset(Buffer.alloc(2 * 1024 * 1024, 17));
    const file = path.join(files, id);
    for (const invalid of [
      "../auth.sqlite",
      "https://example.test/media",
      randomUUID(),
    ])
      await assert.rejects(() => serveRenderAssets(timeline(invalid)));
    const missing = timeline(id);
    missing.scenes[0].layers.push({
      ...missing.scenes[0].layers[0],
      id: "missing",
      assetId: randomUUID(),
    });
    await assert.rejects(
      () => serveRenderAssets(missing),
      /Missing or invalid/,
    );
    assert.equal(await openReferences(file), 0);
    const link = randomUUID();
    await symlink(file, path.join(files, link));
    await assert.rejects(
      () => serveRenderAssets(timeline(link)),
      /Missing or invalid/,
    );
    const pipe = randomUUID();
    execFileSync("mkfifo", [path.join(files, pipe)]);
    await assert.rejects(
      () => serveRenderAssets(timeline(pipe)),
      /bounded regular/,
    );
    assert.equal(await openReferences(path.join(files, pipe)), 0);
    let checks = 0;
    await assert.rejects(
      () => serveRenderAssets(timeline(id), () => ++checks >= 4),
      CommandCancelledError,
    );
    assert(checks >= 4, "cancel after fingerprint streaming begins");
    assert.equal(await openReferences(file), 0);
    const conflict = timeline(id, undefined, id);
    await assert.rejects(() => serveRenderAssets(conflict), /Conflicting/);
  },
);
test(
  "shutdown cancels an active large response and releases file handles",
  { timeout: 5000 },
  async () => {
    const id = await asset(Buffer.alloc(20 * 1024 * 1024, 29));
    const serving = await serveRenderAssets(timeline(id));
    try {
      const response = await fetch(serving.sources[id]);
      const reader = response.body!.getReader();
      assert.equal((await reader.read()).done, false);
      await serving.close();
      await assert.rejects(async () => {
        while (!(await reader.read()).done) {
          /* drain until the closed connection is observed */
        }
      });
      assert.equal(await openReferences(path.join(files, id)), 0);
    } finally {
      await serving.close();
    }
  },
);
