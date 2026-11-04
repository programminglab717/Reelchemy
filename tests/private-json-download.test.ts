import { test } from "node:test";
import assert from "node:assert/strict";
import { privateJsonDownload } from "../src/lib/private-json-download";
test("private activity streams preserve exact Unicode bytes in bounded independent chunks and release their review once", async () => {
  const text = JSON.stringify({
      details: "x".repeat(65500) + "🎬 café 世界".repeat(12000),
    }),
    expected = Buffer.from(text);
  let released = 0;
  const response = privateJsonDownload(text, "owned-activity.json", () => {
    released++;
  });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-length"), String(expected.length));
  const reader = response.body!.getReader(),
    chunks: Buffer[] = [];
  while (true) {
    const value = await reader.read();
    if (value.done) break;
    assert(value.value.byteLength <= 64 * 1024);
    chunks.push(Buffer.from(value.value));
  }
  assert.deepEqual(Buffer.concat(chunks), expected);
  assert.equal(released, 1);
  await reader.cancel();
  assert.equal(released, 1);
});
test("aborted, cancelled and stalled activity readers cannot keep a review lease alive indefinitely", async () => {
  for (const mode of ["abort", "cancel", "stall"] as const) {
    let released = 0;
    const abort = new AbortController(),
      response = privateJsonDownload(
        "x".repeat(200000),
        "owned.json",
        () => {
          released++;
        },
        abort.signal,
        mode === "stall" ? 10 : 20000,
      );
    if (mode === "cancel") await response.body!.cancel();
    else {
      if (mode === "abort") abort.abort();
      else await new Promise((resolve) => setTimeout(resolve, 20));
      await assert.rejects(response.arrayBuffer(), /interrupted/);
    }
    assert.equal(released, 1);
    abort.abort();
    assert.equal(released, 1);
  }
});
