import { secureRoute, type Access } from "@/lib/access";
import { reuseOwnedMedia } from "@/lib/db";
import { readLimitedBody } from "@/lib/http";
import { z } from "zod";
import { libraryProjectId } from "@/lib/media-library";
export const runtime = "nodejs";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  let data: unknown;
  try {
    data = JSON.parse(
      new TextDecoder().decode(await readLimitedBody(req, 4096)),
    );
  } catch (error) {
    return Response.json(
      { error: "Send a valid, small media selection." },
      {
        status:
          error instanceof Error && error.message === "Request too large."
            ? 413
            : 400,
        headers,
      },
    );
  }
  const selected = z
    .object({ sourceProjectId: libraryProjectId, assetId: z.uuid() })
    .safeParse(data);
  if (!selected.success)
    return Response.json(
      { error: "Choose an upload from your media library." },
      { status: 400, headers },
    );
  try {
    const project = reuseOwnedMedia(
      (await params).id,
      selected.data.sourceProjectId,
      selected.data.assetId,
      access.workspace.id,
    );
    return project
      ? Response.json(project, { headers })
      : Response.json(
          {
            error:
              "That media or project is no longer available. Refresh the library.",
          },
          { status: 404, headers },
        );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Project limit is 30 assets."
    )
      return Response.json({ error: error.message }, { status: 409, headers });
    return Response.json(
      {
        error: "Media could not be reused. Refresh the library and try again.",
      },
      { status: 503, headers },
    );
  }
}
// Reusing a normalized file is an ordinary metadata write; it does not spend
// the much smaller upload/decoder allowance or copy any media bytes.
export const POST = secureRoute(POSTHandler, "project");
