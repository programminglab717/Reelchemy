import { test, expect, openTool } from "./fixtures";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("a file larger than one request uploads in pieces from the browser and becomes a usable asset", async ({
  page,
  request,
}) => {
  test.setTimeout(240000);
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-chunked-e2e-"));
  try {
    // About 44 MB of real audio: more than one 32 MiB upload piece.
    const source = path.join(dir, "long-narration.wav");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=230",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        "pcm_s16le",
        "-y",
        source,
      ],
      { timeout: 60000 },
    );
    const bytes = await readFile(source);
    const project = await (
      await request.post("/api/projects", {
        data: {
          prompt: "Chunked upload studio",
          duration: 5,
          format: "landscape",
          blank: true,
        },
      })
    ).json();
    const pieces: string[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (req.method() === "PUT" && url.pathname.startsWith("/api/uploads/"))
        pieces.push(req.headers()["upload-offset"]);
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Chunked upload studio", exact: false })
      .click();
    await openTool(page, "Media & voice");
    await page.getByLabel("Upload audio", { exact: true }).setInputFiles({
      name: "long-narration.wav",
      mimeType: "audio/wav",
      buffer: bytes,
    });
    await page
      .getByPlaceholder("I own this audio", { exact: true })
      .fill("Generated narration fixture");
    await page
      .getByRole("button", { name: "Upload audio asset", exact: true })
      .click();
    await openTool(page, "Sound & captions");
    await expect(
      page.getByRole("button", {
        name: "Add audio: long-narration.wav",
        exact: true,
      }),
    ).toBeVisible({ timeout: 180000 });
    expect(pieces).toEqual(["0", String(32 * 1024 * 1024)]);
    const saved = await (
      await request.get(`/api/projects/${project.id}`)
    ).json();
    expect(saved.assets).toHaveLength(1);
    expect(saved.assets[0]).toMatchObject({
      mime: "audio/wav",
      name: "long-narration.wav",
    });
    expect(
      Math.abs(saved.assets[0].durationFrames - 230 * 30),
    ).toBeLessThanOrEqual(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
