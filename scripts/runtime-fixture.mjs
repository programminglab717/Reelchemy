// Synthetic, private runtime fixture. Invoked through docker exec by check-runtime.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
} from "../src/lib/db.ts";
import { blankTimeline } from "../src/lib/editor.ts";
import { storeVideo } from "../src/lib/video.ts";
import { HEARTBEAT_NAME } from "../src/lib/worker-heartbeat.ts";

const operation = process.env.RUNTIME_CHECK_OPERATION;
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
        "color=c=blue:s=320x180:r=30:d=5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=5",
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
    const asset = await storeVideo(
      await readFile(file),
      "Synthetic blue footage.mp4",
      "Generated acceptance fixture",
    );
    const brief = {
      prompt: "Private container runtime check",
      duration: 5,
      format: "landscape",
    };
    const workspace = ensureWorkspace(
      "runtime-check-only",
      "Synthetic runtime",
    );
    const project = createProject(brief, workspace.id);
    project.assets = [asset];
    saveProject(project);
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
    reviseProject(project, timeline, "Synthetic runtime fixture");
    console.log(
      JSON.stringify({ jobId: createJob(project).id, projectId: project.id }),
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
    video.width !== 1280 ||
    video.height !== 720 ||
    video.r_frame_rate !== "30/1" ||
    Math.abs(Number(probe.format.duration) - 5) > 0.034 ||
    !probe.streams.some(
      (stream) => stream.codec_type === "audio" && stream.codec_name === "aac",
    )
  )
    throw new Error("Runtime export failed stream verification.");
  execFileSync(
    "ffmpeg",
    ["-v", "error", "-xerror", "-i", file, "-f", "null", "-"],
    { timeout: 30000 },
  );
  console.log(JSON.stringify({ decoded: true }));
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
} else if (operation === "readonly") {
  try {
    await writeFile("/app/runtime-must-be-readonly", "unexpected write");
    throw new Error("Application root unexpectedly writable.");
  } catch (error) {
    if (!["EROFS", "EACCES"].includes(error.code)) throw error;
    console.log(JSON.stringify({ readonly: true }));
  }
} else throw new Error("Unknown runtime check operation.");
