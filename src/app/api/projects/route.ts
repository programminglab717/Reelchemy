import { z } from "zod";
import { createProject, listProjects } from "@/lib/db";
import { failure, body, localMutation } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  return Response.json(listProjects());
}
export async function POST(req: Request) {
  try {
    localMutation(req);
    const brief = z
      .object({
        prompt: z.string().trim().min(3).max(1200),
        duration: z.number().int().min(5).max(60),
        format: z.enum(["landscape", "portrait", "square"]),
      })
      .parse(await body(req));
    return Response.json(createProject(brief), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
