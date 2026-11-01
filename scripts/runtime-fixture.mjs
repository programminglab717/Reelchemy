// Synthetic, private runtime fixture. Invoked through docker exec by check-runtime.
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  access,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProject,
  reviseProject,
  createJob,
  ensureWorkspace,
  getJob,
  getProject,
  saveProject,
  listJobs,
  appendOwnedAsset,
  mediaStorage,
  setProjectTrashed,
  requestOwnedProjectDeletion,
  ownedProjectDeletion,
  projectInWorkspace,
  mediaProcessing,
  mediaInputs,
} from "../src/lib/db.ts";
import { blankTimeline } from "../src/lib/editor.ts";
import { cachedWaveform } from "../src/lib/waveform-cache.ts";
import { storeImage } from "../src/lib/assets.ts";
import { storeAudio } from "../src/lib/audio.ts";
import sharp from "sharp";
import { HEARTBEAT_NAME } from "../src/lib/worker-heartbeat.ts";

const operation = process.env.RUNTIME_CHECK_OPERATION;
const staticMinute = process.env.RUNTIME_CHECK_BENCHMARK === "static-minute";
const benchmark =
  staticMinute || process.env.RUNTIME_CHECK_BENCHMARK === "square-minute";
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
if (operation === "seed") {
  const temporary = await mkdtemp(
    path.join(tmpdir(), "reelchemy-runtime-media-"),
  );
  try {
    const file = path.join(temporary, "source.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        benchmark
          ? "testsrc2=size=320x180:rate=30:duration=20"
          : "color=c=blue:s=320x180:r=30:d=5",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:sample_rate=48000:duration=${benchmark ? 20 : 5}`,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        file,
      ],
      { timeout: 30000 },
    );
    const brief = {
      prompt: "Private container runtime check",
      duration: benchmark ? 60 : 5,
      format: benchmark ? "square" : "landscape",
    };
    const workspace = ensureWorkspace(
      "runtime-check-only",
      "Synthetic runtime",
    );
    const project = createProject(brief, workspace.id);
    const bytes = await readFile(file);
    const input = {
      operation: "upload",
      kind: "video",
      name: "Synthetic blue footage.mp4",
      license: "Generated acceptance fixture",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const reservation = mediaProcessing.reserve({
      workspaceId: workspace.id,
      projectId: project.id,
      operation: "upload",
      requestKey: randomUUID(),
    });
    if (!reservation.created)
      throw new Error("Synthetic ingestion reservation was not created.");
    mediaProcessing.enqueue(
      reservation.receipt.id,
      reservation.token,
      input,
      () =>
        mediaInputs.write(
          reservation.receipt.id,
          bytes,
          26 * 1024 * 1024,
          input.sha256,
        ),
    );
    const deadline = Date.now() + 180000;
    let complete = false;
    while (Date.now() < deadline) {
      const receipt = mediaProcessing.get(reservation.receipt.id, workspace.id);
      if (["failed", "cancelled"].includes(receipt?.state))
        throw new Error("Isolated media ingestion did not finish.");
      if (receipt?.state === "completed") {
        complete = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!complete)
      throw new Error(
        "Isolated media ingestion exceeded the fixture deadline.",
      );
    const asset = getProject(project.id)?.assets?.[0];
    if (!asset || !cachedWaveform(asset.id))
      throw new Error(
        "Isolated media ingestion did not publish footage and its waveform.",
      );
    project.assets = [asset];
    const timeline = blankTimeline(brief);
    timeline.scenes[0].layers = [
      {
        ...timeline.scenes[0].layers[0],
        kind: "video",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        animation: "none",
        assetId: asset.id,
        video: {
          startFrame: 0,
          offsetFrames: 0,
          durationFrames: 150,
          volume: 0.4,
          audio: true,
          fit: "cover",
        },
      },
    ];
    timeline.captions = [
      {
        id: "runtime-caption",
        text: "Container export check",
        startFrame: 15,
        endFrame: 135,
      },
    ];
    if (benchmark) {
      const image = await storeImage(
        await sharp({
          create: {
            width: 256,
            height: 256,
            channels: 3,
            background: "#00b6a3",
          },
        })
          .png()
          .toBuffer(),
        "Synthetic badge.png",
        "Generated benchmark fixture",
      );
      const audioFile = path.join(temporary, "voice.wav");
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=220:sample_rate=48000:duration=60",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          audioFile,
        ],
        { timeout: 30000 },
      );
      const audio = await storeAudio(
        await readFile(audioFile),
        "Synthetic voice.wav",
        "Generated benchmark fixture",
      );
      project.assets.push(image, audio);
      for (const [index, scene] of timeline.scenes.entries()) {
        const video = {
          ...structuredClone(timeline.scenes[0].layers[0]),
          id: "footage",
          y: 0.25,
          height: 0.55,
          video: {
            startFrame: 0,
            offsetFrames: 0,
            durationFrames: 600,
            volume: 0.15,
            audio: true,
            fit: "contain",
          },
        };
        scene.title = `Mixed media section ${index + 1}`;
        scene.layers = [
          video,
          {
            ...video,
            id: "heading",
            kind: "text",
            assetId: undefined,
            video: undefined,
            x: 0.05,
            y: 0.05,
            width: 0.62,
            height: 0.14,
            color: "#ffffff",
            fontSize: 42,
            text: `Mixed-media minute / ${index + 1}`,
            rotation: 0,
          },
          {
            ...video,
            id: "badge",
            kind: "image",
            video: undefined,
            assetId: image.id,
            x: 0.78,
            y: 0.05,
            width: 0.14,
            height: 0.14,
            rotation: 15,
          },
          {
            ...video,
            id: "accent",
            kind: "circle",
            assetId: undefined,
            video: undefined,
            x: 0.82,
            y: 0.82,
            width: 0.08,
            height: 0.08,
            color: "#ffd085",
          },
        ];
        if (staticMinute) {
          scene.title = `Static title card ${index + 1}`;
          scene.transition = "cut";
          scene.camera = [];
          scene.layers[0] = {
            ...scene.layers[0],
            kind: "rectangle",
            assetId: undefined,
            video: undefined,
            color: "#2854a5",
          };
          scene.layers[1].text = `Static title card / ${index + 1}`;
          scene.layers[3].kind = "rectangle";
        }
      }
      timeline.audioTracks = [
        {
          id: "narration",
          assetId: audio.id,
          startFrame: 0,
          offsetFrames: 0,
          durationFrames: 1800,
          volume: 0.15,
          fadeFrames: 15,
        },
      ];
      timeline.captions = Array.from({ length: 30 }, (_, i) => ({
        id: `cue-${i}`,
        text: `Mixed media sample ${i + 1}`,
        startFrame: i * 60,
        endFrame: i * 60 + 54,
      }));
      if (staticMinute)
        timeline.captions = Array.from({ length: 6 }, (_, i) => ({
          id: `static-cue-${i}`,
          text: `Static title-card sample ${i + 1}`,
          startFrame: i * 300,
          endFrame: i * 300 + 180,
        }));
    }
    saveProject(project);
    reviseProject(project, timeline, "Synthetic runtime fixture");
    const job = createJob(project);
    console.log(
      JSON.stringify({
        jobId: job.id,
        projectId: project.id,
        createdAt: job.createdAt,
      }),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} else if (operation === "job") {
  const job = getJob(process.env.RUNTIME_CHECK_JOB_ID);
  console.log(
    JSON.stringify({
      status: job?.status,
      stage: job?.stage,
      retryCount: job?.retryCount,
      createdAt: job?.createdAt,
      error: job?.error || null,
    }),
  );
} else if (operation === "decode") {
  const file = path.join(
    process.env.REELCHEMY_ARTIFACT_DIR,
    process.env.RUNTIME_CHECK_JOB_ID,
    "video.mp4",
  );
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8", timeout: 15000 },
    ),
  );
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  if (
    video?.codec_name !== "h264" ||
    video.width !== (benchmark ? 1080 : 1280) ||
    video.height !== (benchmark ? 1080 : 720) ||
    video.r_frame_rate !== "30/1" ||
    Math.abs(Number(probe.format.duration) - (benchmark ? 60 : 5)) > 0.034 ||
    Number(video.nb_frames) !== (benchmark ? 1800 : 150) ||
    !probe.streams.some(
      (stream) => stream.codec_type === "audio" && stream.codec_name === "aac",
    )
  )
    throw new Error("Runtime export failed stream verification.");
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
    { timeout: benchmark ? 90000 : 30000 },
  );
  const sceneCache = getJob(process.env.RUNTIME_CHECK_JOB_ID)?.report
    ?.sceneCache;
  const staticFrameReuse =
    Array.isArray(sceneCache) &&
    sceneCache.every((entry) => entry.frameReuse && !entry.reused)
      ? {
          captured: sceneCache.reduce(
            (sum, entry) => sum + entry.frameReuse.captured,
            0,
          ),
          total: sceneCache.reduce(
            (sum, entry) => sum + entry.frameReuse.total,
            0,
          ),
        }
      : null;
  console.log(
    JSON.stringify({
      decoded: true,
      width: video.width,
      height: video.height,
      frames: Number(video.nb_frames),
      duration: Number(probe.format.duration),
      bytes: Number(probe.format.size),
      ...(staticMinute ? { staticFrameReuse } : {}),
    }),
  );
} else if (operation === "heartbeat") {
  console.log(
    JSON.stringify(
      JSON.parse(
        await readFile(
          path.join(process.env.REELCHEMY_DATA_DIR, HEARTBEAT_NAME),
          "utf8",
        ),
      ),
    ),
  );
} else if (operation === "retry") {
  const project = getProject(process.env.RUNTIME_CHECK_PROJECT_ID);
  const timeline = structuredClone(project.timeline);
  timeline.captions[0].text = "Recovered container export";
  reviseProject(project, timeline, "Synthetic restart fixture");
  console.log(JSON.stringify({ jobId: createJob(project).id }));
} else if (operation === "delete-request") {
  const workspace = ensureWorkspace("runtime-check-only", "Synthetic runtime");
  const project = getProject(process.env.RUNTIME_CHECK_PROJECT_ID);
  if (!project || !projectInWorkspace(project.id, workspace.id))
    throw new Error("Runtime cleanup requires its synthetic project's owner.");
  // The completed source exports are deliberately removed; a separate project
  // retains the same footage, then renders successfully after worker cleanup.
  const keeping = createProject(project.brief, workspace.id);
  keeping.assets = structuredClone(project.assets);
  saveProject(keeping);
  reviseProject(
    keeping,
    structuredClone(project.timeline),
    "Retained synthetic footage",
  );
  const shared = project.assets.find((asset) => asset.mime === "video/mp4");
  if (!shared)
    throw new Error("Runtime cleanup has no shared footage fixture.");
  const sharedHash = await hashFile(
    path.join(process.env.REELCHEMY_DATA_DIR, "assets", shared.id),
  );
  const exclusive = await storeImage(
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#ffd085" },
    })
      .png()
      .toBuffer(),
    "Exclusive synthetic cleanup image.png",
    "Generated acceptance fixture",
  );
  if (!appendOwnedAsset(project.id, workspace.id, exclusive))
    throw new Error("Runtime cleanup fixture could not attach private media.");
  const jobs = listJobs(project.id).map((job) => job.id);
  setProjectTrashed(project.id, true);
  const receipt = requestOwnedProjectDeletion(project.id, workspace.id);
  if (!receipt || !["queued", "working", "completed"].includes(receipt.state))
    throw new Error("Runtime cleanup did not admit its synthetic request.");
  const next = createJob(keeping);
  console.log(
    JSON.stringify({
      keepProjectId: keeping.id,
      keepJobId: next.id,
      sharedAssetId: shared.id,
      sharedHash,
      exclusiveAssetId: exclusive.id,
      removedJobs: jobs,
    }),
  );
} else if (operation === "delete-status") {
  const workspace = ensureWorkspace("runtime-check-only", "Synthetic runtime");
  const receipt = ownedProjectDeletion(
    process.env.RUNTIME_CHECK_PROJECT_ID,
    workspace.id,
  );
  console.log(JSON.stringify({ state: receipt?.state, error: receipt?.error }));
} else if (operation === "delete-verify") {
  const workspace = ensureWorkspace("runtime-check-only", "Synthetic runtime");
  const projectId = process.env.RUNTIME_CHECK_PROJECT_ID;
  const receipt = ownedProjectDeletion(projectId, workspace.id);
  if (
    receipt?.state !== "completed" ||
    receipt.name !== null ||
    getProject(projectId) ||
    listJobs(projectId).length
  )
    throw new Error(
      "Runtime cleanup retained source metadata or did not complete.",
    );
  if (
    !projectInWorkspace(process.env.RUNTIME_CHECK_KEEP_PROJECT_ID, workspace.id)
  )
    throw new Error(
      "Runtime cleanup removed the retained project's ownership.",
    );
  for (const file of [
    path.join(
      process.env.REELCHEMY_DATA_DIR,
      "assets",
      process.env.RUNTIME_CHECK_EXCLUSIVE_ASSET_ID,
    ),
    ...JSON.parse(process.env.RUNTIME_CHECK_REMOVED_JOBS).map((id) =>
      path.join(process.env.REELCHEMY_ARTIFACT_DIR, id),
    ),
  ]) {
    try {
      await access(file);
      throw new Error(
        "Runtime cleanup retained exclusive media or export files.",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const sharedFile = path.join(
    process.env.REELCHEMY_DATA_DIR,
    "assets",
    process.env.RUNTIME_CHECK_SHARED_ASSET_ID,
  );
  if ((await hashFile(sharedFile)) !== process.env.RUNTIME_CHECK_SHARED_HASH)
    throw new Error("Runtime cleanup changed shared footage.");
  const usage = mediaStorage(workspace.id);
  if (usage.usedBytes !== (await stat(sharedFile)).size)
    throw new Error(
      "Runtime cleanup did not reclaim exclusive media accounting.",
    );
  console.log(
    JSON.stringify({
      projectCleanup: true,
      sharedMediaPreserved: true,
      quotaReclaimed: true,
    }),
  );
} else if (operation === "auth-owner") {
  const { authStorageDirectory } = await import("../src/lib/auth-storage.ts");
  const directory = authStorageDirectory();
  if (directory !== "/app/private-auth")
    throw new Error("Unexpected private authentication mount.");
  const account = await stat(path.join(directory, "auth.sqlite"));
  if (!account.isFile() || (account.mode & 0o777) !== 0o600)
    throw new Error("Private account database is unavailable or not private.");
  await writeFile(
    path.join(directory, "auth-secret"),
    "synthetic-isolation-canary",
    { mode: 0o600, flag: "wx" },
  );
  await mkdir(path.join(directory, "mail"), { mode: 0o700 });
  await writeFile(path.join(directory, "mail", "isolation-canary.json"), "{}", {
    mode: 0o600,
    flag: "wx",
  });
  await writeFile(
    path.join(process.env.REELCHEMY_ARTIFACT_DIR, "ingest-artifact-canary"),
    "private-render-output",
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify({ privateAccountStorage: true }));
} else if (operation === "auth-isolation") {
  const names = ["auth.sqlite", "auth-secret", "mail/isolation-canary.json"];
  for (const root of ["/app/private-auth", process.env.REELCHEMY_DATA_DIR])
    for (const name of names) {
      try {
        await access(path.join(root, name));
        throw new Error(
          "Render process can access private authentication material.",
        );
      } catch (error) {
        if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
      }
    }
  try {
    await writeFile("/app/private-auth/renderer-write-canary", "unexpected", {
      flag: "wx",
    });
    throw new Error("Render process can write account storage.");
  } catch (error) {
    if (!["EROFS", "EACCES"].includes(error.code)) throw error;
  }
  console.log(JSON.stringify({ authenticationFilesystemIsolated: true }));
} else if (operation === "artifact-isolation") {
  try {
    await access("/app/artifacts/ingest-artifact-canary");
    throw new Error("Ingestion process can access render artifacts.");
  } catch (error) {
    if (!["ENOENT", "EACCES"].includes(error.code)) throw error;
  }
  try {
    await writeFile("/app/artifacts/ingest-write-canary", "unexpected", {
      flag: "wx",
    });
    throw new Error("Ingestion process can write render artifacts.");
  } catch (error) {
    if (!["EROFS", "EACCES"].includes(error.code)) throw error;
  }
  console.log(JSON.stringify({ artifactFilesystemIsolated: true }));
} else if (operation === "readonly") {
  try {
    await writeFile("/app/runtime-must-be-readonly", "unexpected write");
    throw new Error("Application root unexpectedly writable.");
  } catch (error) {
    if (!["EROFS", "EACCES"].includes(error.code)) throw error;
    console.log(JSON.stringify({ readonly: true }));
  }
} else throw new Error("Unknown runtime check operation.");
