import { z, ZodError } from "zod";
import { secureRoute, type Access } from "@/lib/access";
import {
  artifactDir,
  ownedExportFileSource,
  exportFileRemoval,
  requestExportFiles,
  acquireExportReview,
  releaseExportReview,
} from "@/lib/db";
import {
  inspectExportFiles,
  exportFilesPreview,
  exportFilesDigest,
} from "@/lib/export-file-tree";
import {
  ExportFileBusy,
  ExportFileCapacity,
  ExportFileConflict,
  ExportFileUnavailable,
} from "@/lib/export-file-policy";
import { failure, readLimitedBody, RequestBodyError } from "@/lib/http";
import { privateFileRoute } from "@/lib/private-file";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z
    .object({
      action: z.literal("remove"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      confirmation: z.literal("REMOVE EXPORT"),
    })
    .strict(),
]);
type Context = { params: Promise<{ id: string }> };
async function read(_req: Request, { params }: Context, { workspace }: Access) {
  return Response.json({
    removal: exportFileRemoval((await params).id, workspace.id) ?? null,
  });
}
async function write(req: Request, { params }: Context, { workspace }: Access) {
  let token: string | undefined;
  try {
    const input = command.parse(
      JSON.parse(
        new TextDecoder().decode(
          await readLimitedBody(req, 1024, { timeoutMs: 5000 }),
        ),
      ),
    );
    const id = (await params).id,
      source = ownedExportFileSource(id, workspace.id);
    if (!source)
      return Response.json({ error: "Export not found." }, { status: 404 });
    const previous = exportFileRemoval(id, workspace.id);
    if (previous && previous.state !== "failed")
      return Response.json({ removal: previous });
    token = acquireExportReview(workspace.id);
    const manifest = await inspectExportFiles(
      artifactDir,
      { jobId: id, projectId: source.projectId, workspaceId: workspace.id },
      req.signal,
    );
    if (req.signal.aborted) throw new ExportFileUnavailable();
    if (!ownedExportFileSource(id, workspace.id))
      return Response.json({ error: "Export not found." }, { status: 404 });
    if (input.action === "preview")
      return Response.json({
        preview: exportFilesPreview(manifest),
        removal: previous ?? null,
      });
    if (exportFilesDigest(manifest) !== input.digest)
      throw new ExportFileConflict();
    const removal = requestExportFiles(manifest);
    return removal
      ? Response.json({ removal }, { status: 202 })
      : Response.json({ error: "Export not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof ExportFileCapacity)
      return Response.json(
        { error: error.message },
        {
          status: error.scope === "studio" ? 429 : 503,
          headers: { "Retry-After": "30" },
        },
      );
    if (error instanceof ExportFileConflict || error instanceof ExportFileBusy)
      return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof ExportFileUnavailable)
      return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "Invalid export cleanup request." },
        { status: 400 },
      );
    if (error instanceof ZodError || error instanceof RequestBodyError)
      return failure(error);
    return Response.json(
      {
        error:
          "Export file review is unavailable. Keep your film and retry shortly.",
      },
      { status: 503 },
    );
  } finally {
    if (token) releaseExportReview(token);
  }
}
export const GET = privateFileRoute(secureRoute(read, "job"));
export const POST = privateFileRoute(secureRoute(write, "job"));
