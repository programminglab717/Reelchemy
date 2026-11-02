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

test("cached validation refuses symlinks, pipes and oversized metadata without reading external files or leaking descriptors", async () => {
  const { cacheEntryValid } = await import("../src/lib/render-cache");
  const fs = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const root = fs.mkdtempSync(
    path.join(tmpdir(), "reelchemy-cache-validation-"),
  );
  const timeline = localSceneTimeline(
    mockPlan({ prompt: "Safe cached clips", duration: 5, format: "landscape" }),
    0,
  );
  const key = "test-key";
  const outside = path.join(root, "private-canary"),
    bytes = Buffer.alloc(2048, 55);
  fs.writeFileSync(outside, bytes);
  const manifest = JSON.stringify({
    key,
    frames: timeline.scenes[0].durationFrames,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  const cases: string[] = [];
  try {
    for (const kind of [
      "video-link",
      "manifest-link",
      "video-pipe",
      "manifest-pipe",
      "large-manifest",
      "large-video",
    ]) {
      const directory = path.join(root, kind);
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "manifest.json"), manifest);
      if (kind === "video-link")
        fs.symlinkSync(outside, path.join(directory, "video.mp4"));
      if (kind === "manifest-link") {
        fs.unlinkSync(path.join(directory, "manifest.json"));
        fs.symlinkSync(outside, path.join(directory, "manifest.json"));
      }
      if (kind === "video-pipe")
        execFileSync("mkfifo", [path.join(directory, "video.mp4")]);
      if (kind === "manifest-pipe") {
        fs.unlinkSync(path.join(directory, "manifest.json"));
        execFileSync("mkfifo", [path.join(directory, "manifest.json")]);
      }
      if (kind === "large-manifest")
        fs.writeFileSync(
          path.join(directory, "manifest.json"),
          Buffer.alloc(8193, 32),
        );
      if (kind === "large-video") {
        const fd = fs.openSync(path.join(directory, "video.mp4"), "w");
        try {
          fs.ftruncateSync(fd, 2 * 1024 ** 3 + 1);
        } finally {
          fs.closeSync(fd);
        }
      }
      cases.push(directory);
    }
    fs.symlinkSync(cases[0], path.join(root, "directory-link"));
    cases.push(path.join(root, "directory-link"));
    fs.utimesSync(outside, 0, 0);
    for (const directory of cases)
      assert.equal(await cacheEntryValid(directory, timeline, key), false);
    assert.equal(
      fs.statSync(outside).atimeMs,
      0,
      "private symlink targets must not be read even when they could match a claimed digest",
    );
    const before = fs.readdirSync("/proc/self/fd").length;
    for (let i = 0; i < 20; i++)
      for (const directory of cases)
        assert.equal(await cacheEntryValid(directory, timeline, key), false);
    assert(fs.readdirSync("/proc/self/fd").length <= before + 2);
    assert.deepEqual(fs.readFileSync(outside), bytes);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
