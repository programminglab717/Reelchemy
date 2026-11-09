import { test, expect, openTool } from "./fixtures";
import { encodedFrame } from "./media-frame";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("native-HD footage, fixed title and caption gaps use compositing and yield actual encoded review evidence", async ({
  page,
  request,
}) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "reelchemy-composite-browser-"),
  );
  try {
    const source = path.join(root, "native-footage.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=160x90:rate=30:duration=5",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=5",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-c:a",
        "aac",
        source,
      ],
      { timeout: 15000 },
    );
    await page.goto("/");
    await page.getByLabel("Duration", { exact: true }).selectOption("5");
    await page
      .getByRole("button", { name: "Start from a blank canvas" })
      .click();
    await openTool(page, "Media & voice");
    await expect(
      page.getByRole("heading", { name: "Project assets", exact: true }),
    ).toHaveCount(1);
    await page.getByLabel("Upload video").setInputFiles(source);
    await expect(
      page.getByRole("heading", { name: "Project assets", exact: true }),
    ).toHaveCount(1);
    await page
      .getByPlaceholder("I own this footage")
      .fill("Generated owned source fixture");
    await page
      .getByRole("button", { name: "Upload video asset", exact: true })
      .click();
    await expect(
      page.getByText("native-footage.mp4", { exact: true }),
    ).toBeVisible({ timeout: 120000 });
    await page
      .getByRole("button", { name: "Add video to selected scene" })
      .click();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    const [project] = await (await request.get("/api/projects")).json();
    const timeline = project.timeline,
      scene = timeline.scenes[0];
    const video = scene.layers.find(
      (layer: { kind: string }) => layer.kind === "video",
    );
    const title = scene.layers.find(
      (layer: { kind: string }) => layer.kind === "text",
    );
    Object.assign(video, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      animation: "none",
    });
    Object.assign(video.video, {
      startFrame: 0,
      offsetFrames: 0,
      durationFrames: 150,
      fit: "cover",
      audio: true,
      volume: 0.2,
    });
    scene.layers = [
      video,
      {
        ...title,
        id: "backing",
        kind: "rectangle",
        text: "",
        x: 0.04,
        y: 0.04,
        width: 0.92,
        height: 0.14,
        color: "#101D31",
        animation: "none",
      },
      {
        ...title,
        text: "Made in the studio",
        x: 0.08,
        y: 0.05,
        width: 0.84,
        height: 0.12,
        fontSize: 40,
        animation: "none",
      },
    ];
    timeline.exportResolution = "1080p";
    timeline.captions = [
      { id: "first", text: "First section", startFrame: 0, endFrame: 60 },
      { id: "second", text: "Second section", startFrame: 90, endFrame: 149 },
    ];
    expect(
      (
        await request.patch(`/api/projects/${project.id}`, {
          data: { timeline, baseRevisionId: project.revisions.at(-1).id },
        })
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await page
      .getByRole("button", { name: project.name, exact: false })
      .click();
    await openTool(page, "Export");
    await expect(
      page.getByLabel("Export resolution", { exact: true }),
    ).toHaveValue("1080p");
    const admission = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${project.id}/render`) &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    const job = await (await admission).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 180000,
    });
    const report = await (
      await request.get(`/api/jobs/${job.id}/evidence/report.json`)
    ).json();
    expect(report.sceneCache[0].reused).toBe(false);
    expect(report.sceneCache[0].compositeReuse).toEqual({
      captured: 5,
      total: 150,
    });
    expect(report.qc.audio.codec).toBe("aac");
    expect(report.qc.audio.peakDb).toBeGreaterThan(-80);
    const frame = await encodedFrame(request, job.id, 1);
    expect([frame.width, frame.height]).toEqual([1920, 1080]);
    const center =
      (Math.floor(frame.height / 2) * frame.width +
        Math.floor(frame.width / 2)) *
      3;
    expect(frame.data[center + 2]).toBeGreaterThan(230);
    expect(frame.data[center]).toBeLessThan(20);
    expect(
      (
        await request.get(`/api/jobs/${job.id}/evidence/verification-tail.png`)
      ).ok(),
    ).toBeTruthy();
    expect(
      (
        await request.get(`/api/jobs/${job.id}/evidence/encoded-frame-0001.png`)
      ).status(),
    ).toBe(404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
