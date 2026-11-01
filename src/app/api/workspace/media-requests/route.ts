import { secureRoute } from "@/lib/access";
import { mediaProcessing } from "@/lib/db";
import {
  privateMediaHeaders,
  safeMediaFailure,
} from "@/lib/media-processing-http";
import { z } from "zod";
export const GET = secureRoute(async (req, _ctx, access) => {
  try {
    const offset = new URL(req.url).searchParams.get("offset") ?? "0";
    const value = z
      .string()
      .regex(/^\d{1,9}$/)
      .transform(Number)
      .parse(offset);
    return Response.json(mediaProcessing.list(access.workspace.id, value), {
      headers: privateMediaHeaders,
    });
  } catch (error) {
    return safeMediaFailure(error);
  }
}, "user");
