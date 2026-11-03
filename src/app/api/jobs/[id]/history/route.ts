import { z, ZodError } from "zod";
import { secureRoute, type Access } from "@/lib/access";
import {
  previewOwnedJobHistory,
  retireOwnedJobHistory,
  downloadOwnedJobHistory,
  acquireExportReview,
  releaseExportReview,
} from "@/lib/db";
import { failure, readLimitedBody, RequestBodyError } from "@/lib/http";
import {
  JobHistoryLimit,
  JobHistoryUnavailable,
  JobHistoryConflict,
  JobHistoryBusy,
} from "@/lib/job-history-policy";
import { privateFileRoute } from "@/lib/private-file";
import { privateJsonDownload } from "@/lib/private-json-download";
import { ExportFileCapacity } from "@/lib/export-file-policy";
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z
    .object({
      action: z.literal("retire"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      confirmation: z.literal("RETIRE EXPORT DETAILS"),
    })
    .strict(),
]);
type Context = { params: Promise<{ id: string }> };
async function handler(
  request: Request,
  { params }: Context,
  { workspace }: Access,
) {
  try {
    const input = command.parse(
      JSON.parse(
        new TextDecoder().decode(
          await readLimitedBody(request, 1024, { timeoutMs: 5000 }),
        ),
      ),
    );
    const id = (await params).id;
    const result =
      input.action === "preview"
        ? previewOwnedJobHistory(id, workspace.id)
        : retireOwnedJobHistory(id, workspace.id, input.digest);
    return result
      ? Response.json(
          input.action === "preview" ? result : { retirement: result },
        )
      : Response.json({ error: "Export not found." }, { status: 404 });
  } catch (error) {
    if (
      error instanceof JobHistoryLimit ||
      error instanceof JobHistoryUnavailable ||
      error instanceof JobHistoryConflict ||
      error instanceof JobHistoryBusy ||
      error instanceof RequestBodyError ||
      error instanceof ZodError
    )
      return failure(error);
    if (error instanceof SyntaxError)
      return Response.json(
        { error: "Invalid export activity request." },
        { status: 400 },
      );
    return Response.json(
      {
        error:
          "Export activity review is unavailable. Your film and original media are kept. Retry shortly.",
      },
      { status: 503 },
    );
  }
}
export const POST = privateFileRoute(secureRoute(handler, "job"));
async function download(
  request: Request,
  { params }: Context,
  { workspace }: Access,
) {
  let token: string | undefined;
  try {
    if (request.signal.aborted) return new Response(null, { status: 408 });
    token = acquireExportReview(workspace.id);
    const id = (await params).id,
      record = downloadOwnedJobHistory(id, workspace.id);
    if (record === undefined)
      return Response.json({ error: "Export not found." }, { status: 404 });
    const filename = `reelchemy-export-${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)}-activity.json`;
    if (request.method === "HEAD")
      return new Response(null, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": String(Buffer.byteLength(record)),
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    const ownedToken = token,
      response = privateJsonDownload(
        record,
        filename,
        () => {
          try {
            releaseExportReview(ownedToken);
          } catch {}
        },
        request.signal,
      );
    token = undefined;
    return response;
  } catch (error) {
    if (error instanceof ExportFileCapacity)
      return Response.json(
        {
          error:
            "Export activity download is busy. Keep editing and retry shortly.",
        },
        {
          status: error.scope === "studio" ? 429 : 503,
          headers: { "Retry-After": "30" },
        },
      );
    return Response.json(
      {
        error:
          "Export activity could not be downloaded. Your saved film and originals are kept.",
      },
      { status: 503 },
    );
  } finally {
    if (token) releaseExportReview(token);
  }
}
export const GET = privateFileRoute(secureRoute(download, "job"));
export const HEAD = GET;
