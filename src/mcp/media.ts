import { randomUUID } from "node:crypto";
import { internalRequest, type Access } from "@/lib/access";
import { mediaUploadName } from "@/lib/media-upload-intent";
import type { Project } from "@/lib/schema";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/timeline-limits";
import * as assetsRoute from "@/app/api/projects/[id]/assets/route";
import * as projectRoute from "@/app/api/projects/[id]/route";

// Adds an image to a project for an assistant, through the studio's own
// upload handler: the same checks, storage limits, normalisation and queue
// as a file dropped into the studio.
export class MediaRefused extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const MAX_IMAGE_BYTES = MAX_MEDIA_UPLOAD_BYTES.image;
const ascii = (bytes: Uint8Array, at: number, value: string) =>
  [...value].every((char, i) => bytes[at + i] === char.charCodeAt(0));
// The picture formats the studio accepts, told from the file's first bytes.
export function imageExtension(bytes: Uint8Array) {
  if (bytes[0] === 0x89 && ascii(bytes, 1, "PNG")) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "webp";
  return undefined;
}
export type AddedImage =
  | {
      status: "added";
      image: { id: string; name: string; width?: number; height?: number };
    }
  | { status: "processing"; note: string };
type Route = (
  req: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response> | Response;
export async function addProjectImage(
  access: Access,
  origin: string,
  projectId: string,
  input: { name: string; license: string; bytes: Uint8Array },
): Promise<AddedImage> {
  const extension = imageExtension(input.bytes);
  if (!extension)
    throw new MediaRefused("Send a PNG, JPEG or WebP image.", 415);
  if (input.bytes.length > MAX_IMAGE_BYTES)
    throw new MediaRefused("Images must be 25 MB or smaller.", 413);
  const stem = input.name.replace(/\.(png|jpe?g|webp)$/i, "").trim() || "image";
  const name = mediaUploadName(`${stem}.${extension}`, "image");
  const params = { params: Promise.resolve({ id: projectId }) };
  const url = new URL(`/api/projects/${projectId}`, origin);
  const current = await (projectRoute.GET as Route)(
    internalRequest(new Request(url), access),
    params,
  );
  if (!current.ok) throw new MediaRefused("Project not found.", 404);
  const before = new Set(
    ((await current.json()) as Project).assets?.map((a) => a.id),
  );
  const form = new FormData();
  form.set("kind", "image");
  form.set("license", input.license);
  form.set(
    "file",
    new File([Buffer.from(input.bytes)], name, {
      type: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
    }),
  );
  const response = await (assetsRoute.POST as Route)(
    internalRequest(
      new Request(new URL(`/api/projects/${projectId}/assets`, origin), {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: form,
      }),
      access,
    ),
    params,
  );
  const data = (await response.json().catch(() => null)) as
    (Project & { error?: string }) | null;
  if (response.status === 202)
    return {
      status: "processing",
      note: "The image was received and is still being prepared. Call get_project in a few seconds; it appears under images.",
    };
  if (!response.ok || !data)
    throw new MediaRefused(
      (data && typeof data.error === "string" && data.error) ||
        `The studio refused the image (HTTP ${response.status}).`,
      response.status >= 400 && response.status < 600 ? response.status : 400,
    );
  const images = (data.assets ?? []).filter((a) => a.mime === "image/png");
  const added =
    images.find((a) => !before.has(a.id)) ??
    images.findLast((a) => a.name === name) ??
    images.at(-1);
  if (!added) throw new MediaRefused("The image could not be added.", 500);
  return {
    status: "added",
    image: {
      id: added.id,
      name: added.name,
      width: added.width,
      height: added.height,
    },
  };
}
