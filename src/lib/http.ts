import { ZodError } from "zod";
export function failure(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "Request failed";
  return Response.json({ error: message }, { status: 400 });
}
export function localMutation(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    throw new Error("Cross-origin writes are not allowed.");
}
export async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 100000)
    throw new Error("Request too large.");
  const text = await req.text();
  if (text.length > 100000) throw new Error("Request too large.");
  return JSON.parse(text);
}
