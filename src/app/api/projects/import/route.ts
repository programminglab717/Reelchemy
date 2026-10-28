import { saveProject } from "@/lib/db";
import { importArchive } from "@/lib/archive";
import { localMutation, readLimitedBody, failure } from "@/lib/http";
export async function POST(req: Request) {
  try {
    localMutation(req);
    const p = await importArchive(await readLimitedBody(req, 50 * 1024 * 1024));
    return Response.json(saveProject(p), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}
