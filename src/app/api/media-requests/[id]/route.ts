import { secureRoute } from "@/lib/access";
import { mediaProcessing } from "@/lib/db";
import { privateMediaHeaders } from "@/lib/media-processing-http";
import { z } from "zod";
export const GET = secureRoute(async (_req, { params }, access) => {
  const { id } = await params;
  const receipt = z.uuid().safeParse(id).success
    ? mediaProcessing.get(id, access.workspace.id)
    : undefined;
  return receipt
    ? Response.json({ request: receipt }, { headers: privateMediaHeaders })
    : Response.json(
        { error: "Media request not found." },
        { status: 404, headers: privateMediaHeaders },
      );
}, "user");
