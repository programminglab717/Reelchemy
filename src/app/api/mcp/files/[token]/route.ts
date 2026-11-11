import { internalRequest, type Access } from "@/lib/access";
import { mcpLinks, ownedWorkspace } from "@/lib/db";
import { readLimitedBody, RequestBodyError } from "@/lib/http";
import type { McpLinkKind } from "@/lib/mcp-links";
import {
  addProjectImage,
  imageExtension,
  MAX_IMAGE_BYTES,
  MediaRefused,
} from "@/mcp/media";
import * as downloadRoute from "@/app/api/jobs/[id]/download/route";

// The two links an assistant gets from the MCP tools: GET downloads one
// finished export, PUT (or POST) adds one image to one project. The token in
// the path is the whole permission (see mcp-links), so nothing here reads a
// session, and every answer is uncacheable and leaks no referrer.
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const gone = () =>
  Response.json(
    {
      error:
        "This link is not valid, was already used or has expired. Ask the assistant for a new one.",
    },
    { status: 404, headers },
  );
type Context = { params: Promise<{ token: string }> };
function linked(token: string, kind: McpLinkKind) {
  const link = mcpLinks.resolve(token, kind);
  if (!link) return undefined;
  // The studio must still belong to the person the link was made for.
  const workspace = ownedWorkspace(link.userId);
  if (!workspace || workspace.id !== link.workspaceId) return undefined;
  const access: Access = {
    workspace,
    user: { id: link.userId, name: "", email: "" },
  };
  return { link, access };
}
async function download(request: Request, { params }: Context) {
  const found = linked((await params).token, "download");
  if (!found) return gone();
  const range = request.headers.get("range");
  const response = await downloadRoute.GET(
    internalRequest(
      new Request(
        new URL(`/api/jobs/${found.link.target}/download`, request.url),
        { method: request.method, headers: range ? { range } : {} },
      ),
      found.access,
    ),
    { params: Promise.resolve({ id: found.link.target }) },
  );
  for (const [name, value] of Object.entries(headers))
    response.headers.set(name, value);
  return response;
}
async function upload(request: Request, { params }: Context) {
  const token = (await params).token;
  const found = linked(token, "upload");
  if (!found) return gone();
  try {
    const bytes = await readLimitedBody(request, MAX_IMAGE_BYTES);
    if (!bytes.length)
      throw new MediaRefused(
        "Send the image file as the request body (for example: curl -T logo.png <link>).",
      );
    if (!imageExtension(bytes))
      throw new MediaRefused("Send a PNG, JPEG or WebP image.", 415);
    // One file per link: a second request with the same link finds it gone.
    if (!mcpLinks.consume(token)) return gone();
    const result = await addProjectImage(
      found.access,
      new URL(request.url).origin,
      found.link.target,
      {
        name: found.link.meta.name || "image",
        license: found.link.meta.license || "Provided by the studio's owner",
        bytes,
      },
    );
    return Response.json(result, {
      status: result.status === "added" ? 201 : 202,
      headers,
    });
  } catch (error) {
    const refused = error instanceof MediaRefused;
    const body = error instanceof RequestBodyError;
    if (!refused && !body) console.error("MCP_UPLOAD_FAILED");
    return Response.json(
      {
        error:
          refused || body
            ? error.message
            : "The image could not be added. Try again.",
      },
      { status: refused ? error.status : body ? error.status : 500, headers },
    );
  }
}
export const GET = download;
export const HEAD = download;
export const PUT = upload;
export const POST = upload;
