import { test } from "node:test";
import assert from "node:assert/strict";
import { localSceneTimeline, sceneCacheKey } from "../src/lib/render-cache";
import { mockPlan } from "../src/lib/provider";
test("scene cache invalidates only changed scenes and includes assets, captions and renderer fingerprint", () => {
  const t = mockPlan({
    prompt: "Cache test",
    duration: 5,
    format: "landscape",
  });
  t.captions = [
    {
      id: "cue",
      startFrame: 40,
      endFrame: 70,
      text: "Crossing a scene boundary",
    },
  ];
  const local = localSceneTimeline(t, 1);
  assert.equal(local.captions![0].startFrame, 0);
  assert.equal(local.captions![0].endFrame, 20);
  const keys = t.scenes.map((_, i) =>
    sceneCacheKey(localSceneTimeline(t, i), {}, "renderer-v1"),
  );
  t.scenes[0].layers[1].text = "Changed first scene";
  assert.notEqual(
    sceneCacheKey(localSceneTimeline(t, 0), {}, "renderer-v1"),
    keys[0],
  );
  assert.equal(
    sceneCacheKey(localSceneTimeline(t, 1), {}, "renderer-v1"),
    keys[1],
  );
  assert.notEqual(sceneCacheKey(local, {}, "renderer-v2"), keys[1]);
  local.scenes[0].layers[2].assetId = "test-asset";
  assert.notEqual(
    sceneCacheKey(local, { "test-asset": "data:a" }, "v1"),
    sceneCacheKey(local, { "test-asset": "data:b" }, "v1"),
  );
});
test("cached clip checksum rejects content changes even if the MP4 header remains parseable", async () => {
  const { cacheEntryValid } = await import("../src/lib/render-cache");
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-cache-test-"));
  const t = localSceneTimeline(
    mockPlan({ prompt: "Checksum", duration: 5, format: "landscape" }),
    0,
  );
  const video = path.join(dir, "video.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=1280x720:r=30:d=${t.scenes[0].durationFrames / 30}`,
    "-c:v",
    "libx264",
    video,
  ]);
  const bytes = await readFile(video);
  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      key: "test-key",
      frames: t.scenes[0].durationFrames,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  assert(await cacheEntryValid(dir, t, "test-key"));
  bytes[Math.floor(bytes.length / 2)] ^= 1;
  await writeFile(video, bytes);
  assert.equal(await cacheEntryValid(dir, t, "test-key"), false);
});
