import { randomUUID } from "node:crypto";
import {
  mediaProcessing,
  mediaInputs,
  appendOwnedAsset,
  saveImportedProject,
  getProject,
  projectInWorkspace,
  cleanupMediaRequest,
  cleanupUnreferencedMediaOutputs,
} from "./db";
import { MEDIA_INPUT_BYTES } from "./media-processing-policy";
import type { MediaTask, MediaFailure } from "./media-processing-store";
import { storeImage } from "./assets";
import { storeAudio } from "./audio";
import { storeVideo } from "./video";
import { storeFont } from "./fonts";
import { MAX_MEDIA_UPLOAD_BYTES } from "./timeline-limits";
import { importArchive } from "./archive";
import { readWaveform } from "./waveform";
import { cacheWaveform } from "./waveform-cache";
import { MediaStorageLimitError } from "./media-storage-policy";
import { ProjectStorageLimit } from "./project-storage-policy";
import { CommandTimeoutError } from "./process";
import type { Asset } from "./schema";

async function waveform(asset: Asset, cancelled: () => boolean) {
  if (
    asset.mime === "audio/wav" ||
    (asset.mime === "video/mp4" && asset.hasAudio)
  )
    cacheWaveform(asset.id, await readWaveform(asset.id, { cancelled }));
}
export function recoverMediaProcessing() {
  for (const task of mediaProcessing.interrupted()) {
    if (
      !mediaProcessing.retryInterrupted(task, cleanupUnreferencedMediaOutputs)
    )
      mediaProcessing.fail(task, "INTERRUPTED");
  }
}
export function cleanMediaProcessing() {
  for (const entry of mediaProcessing.cleanupCandidates())
    cleanupMediaRequest(entry.id);
  mediaProcessing.prune();
}
export async function processMediaTask(
  task: MediaTask,
  stopping: () => boolean = () => false,
  deadlineMs = 600000,
) {
  const deadline = Date.now() + deadlineMs;
  const cancelled = () =>
    stopping() || Date.now() >= deadline || mediaProcessing.isCancelled(task);
  try {
    if (!task.input || cancelled()) {
      mediaProcessing.fail(task, "PROJECT_UNAVAILABLE");
      return;
    }
    const input = task.input;
    if (input.operation === "upload") {
      const bytes = mediaInputs.read(
        task.id,
        MEDIA_INPUT_BYTES.upload,
        input.bytes,
        input.sha256,
      );
      const id = randomUUID();
      mediaProcessing.recordOutputs(task, [id]);
      const options = { id, cancelled };
      const asset =
        input.kind === "video"
          ? await storeVideo(bytes, input.name, input.license, options)
          : input.kind === "font"
            ? await storeFont(
                bytes,
                input.name,
                input.license,
                MAX_MEDIA_UPLOAD_BYTES.font,
                options,
              )
            : await (input.kind === "audio" ? storeAudio : storeImage)(
                bytes,
                input.name,
                input.license,
                10 * 1024 * 1024,
                options,
              );
      await waveform(asset, cancelled);
      mediaProcessing.finish(task, () => {
        if (
          !appendOwnedAsset(
            task.projectId!,
            task.workspaceId,
            asset,
            task.storageLimitBytes ?? undefined,
            task.sharedStorageLimitBytes,
          )
        )
          throw new Error("Media target unavailable.");
        return asset.id;
      });
    } else if (input.operation === "import") {
      const bytes = mediaInputs.read(
        task.id,
        MEDIA_INPUT_BYTES.import,
        input.bytes,
        input.sha256,
      );
      const project = await importArchive(bytes, {
        cancelled,
        registerOutputs: (ids) => mediaProcessing.recordOutputs(task, ids),
      });
      for (const asset of project.assets || [])
        await waveform(asset, cancelled);
      mediaProcessing.finish(
        task,
        () =>
          saveImportedProject(
            project,
            task.workspaceId,
            task.storageLimitBytes ?? undefined,
            task.sharedStorageLimitBytes,
          ).id,
      );
    } else {
      if (!projectInWorkspace(task.projectId!, task.workspaceId))
        throw new Error("Media target unavailable.");
      const asset = getProject(task.projectId!)?.assets?.find(
        (a) => a.id === input.assetId,
      );
      if (
        !asset ||
        (asset.mime !== "audio/wav" &&
          !(asset.mime === "video/mp4" && asset.hasAudio))
      )
        throw new Error("Waveform asset unavailable.");
      await waveform(asset, cancelled);
      mediaProcessing.finish(task, () => asset.id);
    }
    console.log(
      JSON.stringify({
        event: "media.complete",
        requestId: task.id,
        operation: task.operation,
      }),
    );
  } catch (error) {
    if (
      stopping() &&
      mediaProcessing.retryInterrupted(task, cleanupUnreferencedMediaOutputs)
    )
      return;
    const code: MediaFailure =
      Date.now() >= deadline || error instanceof CommandTimeoutError
        ? "PROCESSING_TIMEOUT"
        : error instanceof MediaStorageLimitError
          ? error.scope === "service"
            ? "SERVICE_STORAGE_LIMIT"
            : "STORAGE_LIMIT"
          : error instanceof ProjectStorageLimit
            ? "PROJECT_DATA_LIMIT"
            : mediaProcessing.isCancelled(task)
              ? "PROJECT_UNAVAILABLE"
              : "INVALID_MEDIA";
    mediaProcessing.fail(
      task,
      code,
      error instanceof MediaStorageLimitError && error.scope === "studio"
        ? {
            usedBytes: error.usedBytes,
            limitBytes: error.limitBytes,
            requiredBytes: error.requiredBytes,
          }
        : undefined,
    );
    console.error(
      JSON.stringify({ event: "media.failed", requestId: task.id, code }),
    );
  } finally {
    cleanupMediaRequest(task.id);
  }
}
