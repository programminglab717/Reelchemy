import { secureRoute } from "@/lib/access";
import { mediaProcessing } from "@/lib/db";
import {
  privateMediaHeaders,
  safeMediaFailure,
} from "@/lib/media-processing-http";
import { readLimitedBody } from "@/lib/http";
import { z } from "zod";
export const POST = secureRoute(async (req, { params }, access) => {
  try {
    await readLimitedBody(req, 1024, { timeoutMs: 5000 });
    const { id } = await params;
    const receipt = z.uuid().safeParse(id).success
      ? mediaProcessing.cancel(id, access.workspace.id)
      : undefined;
    return receipt
      ? Response.json({ request: receipt }, { headers: privateMediaHeaders })
      : Response.json(
          { error: "Media request not found." },
          { status: 404, headers: privateMediaHeaders },
        );
  } catch (error) {
    return safeMediaFailure(error);
  }
}, "user");
