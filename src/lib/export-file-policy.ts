import { z } from "zod";
export type ExportFileState = "queued" | "working" | "failed" | "completed";
export type ExportFileRemoval = {
  jobId: string;
  projectId: string;
  state: ExportFileState;
  requestedAt: string;
  completedAt: string | null;
  error: string | null;
};
export type ExportFilePreview = {
  jobId: string;
  projectId: string;
  digest: string;
  files: number;
  bytes: number;
};
export class ExportFileUnavailable extends Error {
  constructor() {
    super(
      "These export files need operator review before they can be removed safely.",
    );
  }
}
export class ExportFileConflict extends Error {
  constructor() {
    super(
      "The export changed after this review. Review its current files before confirming removal again.",
    );
  }
}
export class ExportFileBusy extends Error {
  constructor() {
    super(
      "Wait for rendering or cancellation to finish, then review these export files again.",
    );
  }
}
export class ExportFileCapacity extends Error {
  constructor(readonly scope: "studio" | "service") {
    super(
      scope === "studio"
        ? "Your export cleanup queue is busy. Wait for a removal to finish and retry."
        : "Export cleanup is busy. Keep this review and retry shortly.",
    );
  }
}
export const maximumExportReviewBytes = 1024 ** 3;
const integer = z.string().regex(/^\d{1,30}$/);
export const exportFileIdentity = z
  .object({ dev: integer, ino: integer })
  .strict();
// Inventory supports the bounded experimental longer-render fixture as well as
// public jobs. Public scene admission remains enforced separately by the DSL.
const numbered = "(?:[1-9]|[1-5][0-9]|60)";
const filename = new RegExp(
  `^(?:video\\.mp4|muxed\\.mp4|thumbnail\\.png|verification-tail\\.png|encoded-frame-[0-9]{4}\\.png|report\\.json|captions\\.(?:srt|vtt)|concat-scenes\\.txt|scene-${numbered}-(?:begin\\.png|middle\\.png|end\\.png|event-[0-9]{1,3}\\.png|motion\\.mp4)|layout-${numbered}-(?:before|after)\\.png)$`,
);
export const validExportFilename = (name: string) => filename.test(name);
export const exportFileEntry = exportFileIdentity
  .extend({
    name: z.string().max(120).regex(filename),
    bytes: z.number().int().min(0).max(maximumExportReviewBytes),
    mtime: integer,
    ctime: integer,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const exportFileManifest = z
  .object({
    format: z.literal("reelchemy-export-files-v1"),
    jobId: z.uuid(),
    projectId: z.string().min(1).max(160),
    workspaceId: z.string().min(1).max(80),
    root: exportFileIdentity.nullable(),
    directory: exportFileIdentity.nullable(),
    files: z.array(exportFileEntry).max(2048),
  })
  .strict()
  .refine(
    (v) =>
      v.files.reduce((n, f) => n + f.bytes, 0) <= maximumExportReviewBytes &&
      new Set(v.files.map((f) => f.name)).size === v.files.length &&
      (v.directory !== null || v.files.length === 0) &&
      (v.root !== null || v.directory === null),
    "Invalid export file inventory.",
  );
export type ExportFileManifest = z.infer<typeof exportFileManifest>;
