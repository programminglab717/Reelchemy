import { test, expect, openTool } from "./fixtures";
import {
  creatorTemplates,
  creatorTemplateTimeline,
} from "../../src/lib/creator-templates";
import { encodedFrame } from "./media-frame";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

for (const template of creatorTemplates)
  test(`${template.id} opens an editable authored film without planning and exports its full native-HD duration and captions`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(600000);
    page.setDefaultTimeout(15000);
    const plans: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/plan")) plans.push(r.url());
    });
    await page.goto("/");
    await page
      .getByRole("button", {
        name: `Use ${template.name} template`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: template.name, exact: true }),
    ).toBeVisible();
    const [project] = await (await request.get("/api/projects")).json(),
      original = creatorTemplateTimeline(template.id);
    expect(project.timeline).toEqual(original);
    expect(project.revisions).toHaveLength(1);
    expect(plans).toHaveLength(0);
    await openTool(page, "Export");
    await expect(
      page.getByLabel("Export resolution", { exact: true }),
    ).toHaveValue("1080p");
    await openTool(page, "Scene & layers");
    await expect(page.getByLabel("Scene notes", { exact: true })).toHaveValue(
      original.scenes[0].intent,
    );
    const recorder = page.getByRole("region", {
      name: "Record narration",
      exact: true,
    });
    await openTool(page, "Media & voice");
    await recorder
      .getByText("Scene notes to read while recording", { exact: true })
      .click();
    await expect(
      recorder.getByLabel("Recording notes text", { exact: true }),
    ).toHaveText(original.scenes[0].intent);
    await recorder
      .getByRole("button", { name: "Next scene notes", exact: true })
      .click();
    await expect(
      recorder.getByLabel("Recording notes text", { exact: true }),
    ).toHaveText(original.scenes[1].intent);
    const archive = await request.get(`/api/projects/${project.id}/archive`);
    const imported = await request.post("/api/projects/import", {
      headers: { "content-type": "application/zip" },
      data: await archive.body(),
    });
    expect(imported.status()).toBe(201);
    const restored = await imported.json();
    expect(restored.timeline).toEqual(original);
    const admission = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/render`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Approve & export MP4", exact: true })
      .click();
    const job = await (await admission).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 540000,
    });
    const report = await (
      await request.get(`/api/jobs/${job.id}/evidence/report.json`)
    ).json();
    expect(report.export.duration).toBeCloseTo(template.duration, 2);
    expect(report.export.fps).toBe(30);
    expect(report.qc.layout.before).toEqual([]);
    expect(report.qc.layout.after).toEqual([]);
    expect(report.qc.layout.changes).toEqual([]);
    expect(report.sceneCache).toHaveLength(original.scenes.length);
    const frame = await encodedFrame(request, job.id, 2);
    expect([frame.width, frame.height]).toEqual(
      template.format === "portrait" ? [1080, 1920] : [1920, 1080],
    );
    const subtitles = await (
      await request.get(`/api/jobs/${job.id}/evidence/captions.srt`)
    ).text();
    expect(subtitles).toContain(original.captions![0].text);
    expect(
      report.timeline.scenes.map((s: { intent: string }) => s.intent),
    ).toEqual(original.scenes.map((s) => s.intent));
    const proof = await request.get(
      `/api/jobs/${job.id}/evidence/scene-1-middle.png`,
    );
    expect(proof.status()).toBe(200);
    await testInfo.attach(`${template.id}-encoded.png`, {
      body: await proof.body(),
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page, "Media & voice");
    await recorder.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await recorder.screenshot({
      path: testInfo.outputPath(`${template.id}-recording-notes-mobile.png`),
    });
  });

test("scene notes and captions save as undoable edits while a live microphone take survives note changes and exports in a mixed-media story", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(540000);
  page.setDefaultTimeout(15000);
  const template = creatorTemplates[2];
  await page.goto("/");
  await page
    .getByRole("button", { name: `Use ${template.name} template`, exact: true })
    .click();
  await expect(page.getByLabel("Scene notes", { exact: true })).toBeVisible();
  const [project] = await (await request.get("/api/projects")).json();
  const saved = page.getByRole("status", { name: "Save status" });
  await openTool(page, "Scene & layers");
  const firstNotes = "A clear voice makes a useful story easier to follow.";
  await page.getByLabel("Scene notes", { exact: true }).fill(firstNotes);
  await expect(saved).toHaveText("All changes saved");
  await page
    .getByRole("button", {
      name: "Use notes as captions for this scene",
      exact: true,
    })
    .click();
  await expect(saved).toHaveText("All changes saved");
  const read = async () =>
    await (await request.get(`/api/projects/${project.id}`)).json();
  const next = await read();
  expect(next.timeline.captions[0].text).toBe(firstNotes);
  expect(
    next.timeline.captions.filter(
      (c: { startFrame: number }) => c.startFrame >= 450,
    ),
  ).toEqual(
    project.timeline.captions.filter(
      (c: { startFrame: number }) => c.startFrame >= 450,
    ),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(saved).toHaveText("All changes saved");
  expect((await read()).timeline.captions).toEqual(project.timeline.captions);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(saved).toHaveText("All changes saved");
  expect((await read()).timeline.captions[0].text).toBe(firstNotes);
  const recorder = page.getByRole("region", {
    name: "Record narration",
    exact: true,
  });
  await openTool(page, "Media & voice");
  await recorder
    .getByText("Scene notes to read while recording", { exact: true })
    .click();
  await recorder
    .getByRole("button", { name: "Start microphone recording", exact: true })
    .click();
  const stop = recorder.getByRole("button", {
    name: "Stop recording",
    exact: true,
  });
  await expect(stop).toBeVisible();
  const duration = async () =>
    Number(
      (
        await recorder
          .getByRole("status", { name: "Recorded duration" })
          .textContent()
      )?.split("s")[0],
    );
  await expect.poll(duration).toBeGreaterThan(0.8);
  await recorder
    .getByRole("button", { name: "Next scene notes", exact: true })
    .click();
  await expect(
    recorder.getByLabel("Recording scene notes", { exact: true }),
  ).toHaveValue(project.timeline.scenes[1].id);
  await page
    .getByRole("button", {
      name: `Timeline scene 2: ${project.timeline.scenes[1].title}`,
      exact: true,
    })
    .click();
  const secondNotes =
    "Read this scene at a calm pace and leave room for the example.";
  await openTool(page, "Scene & layers");
  await page.getByLabel("Scene notes", { exact: true }).fill(secondNotes);
  await expect(saved).toHaveText("All changes saved");
  await openTool(page, "Media & voice");
  await expect(
    recorder.getByLabel("Recording notes text", { exact: true }),
  ).toHaveText(secondNotes);
  await expect(stop).toBeVisible();
  await expect.poll(duration).toBeGreaterThan(1.8);
  await stop.click();
  const preview = recorder.getByLabel("Recorded narration preview", {
    exact: true,
  });
  await expect(preview).toBeVisible();
  const url = await preview.getAttribute("src");
  await recorder
    .getByRole("button", { name: "Next scene notes", exact: true })
    .click();
  await expect(preview).toHaveAttribute("src", url!);
  await recorder
    .getByRole("button", { name: "Save recording to assets", exact: true })
    .click();
  const add = page.getByRole("button", {
    name: "Add audio: Narration.wav",
    exact: true,
  });
  await openTool(page, "Sound & captions");
  await expect(add).toBeVisible({ timeout: 120000 });
  await add.click();
  await expect(saved).toHaveText("All changes saved");
  await openTool(page, "Sound & captions");
  await page.getByLabel("startFrame audio", { exact: true }).fill("450");
  await expect(saved).toHaveText("All changes saved");
  expect((await read()).timeline.audioTracks[0].startFrame).toBe(450);
  await page.reload();
  await page.getByRole("button", { name: template.name, exact: true }).click();
  await page
    .getByRole("button", {
      name: `Timeline scene 2: ${project.timeline.scenes[1].title}`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Scene notes", { exact: true })).toHaveValue(
    secondNotes,
  );
  await openTool(page, "Media & voice");
  await recorder
    .getByText("Scene notes to read while recording", { exact: true })
    .click();
  await recorder
    .getByLabel("Recording scene notes", { exact: true })
    .selectOption(project.timeline.scenes[1].id);
  await expect(
    recorder.getByLabel("Recording notes text", { exact: true }),
  ).toHaveText(secondNotes);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTool(page, "Media & voice");
  await expect(page.locator("#studio-tool-media")).toBeVisible();
  await recorder.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await recorder.screenshot({
    path: testInfo.outputPath("recording-notes-mobile.png"),
  });
  // Complete this real take into the authored story using only maker controls.
  // The camera/microphone devices remain synthetic; this is functional evidence.
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-creator-story-"));
  try {
    const image = path.join(root, "owned-picture.png");
    await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 3,
        background: { r: 250, g: 180, b: 40 },
      },
    })
      .png()
      .toFile(image);
    const footage = path.join(root, "owned-footage.mp4");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x90:rate=30:duration=2,drawbox=x=0:y=0:w=60:h=90:color=0x2080e0:t=fill",
        "-an",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        footage,
      ],
      { timeout: 15000 },
    );
    await page.getByLabel("Upload image", { exact: true }).setInputFiles(image);
    await page
      .getByPlaceholder("I own this image", { exact: true })
      .fill("Original synthetic artwork owned by this test");
    await page
      .getByRole("button", { name: "Upload asset", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add to selected scene", exact: true })
      .click();
    await expect(saved).toHaveText("All changes saved");
    const place = async (kind: string, x: number, width: number) => {
      const current = await read(),
        layer = current.timeline.scenes[1].layers.find(
          (l: { kind: string }) => l.kind === kind,
        );
      expect(layer).toBeTruthy();
      const row = page.locator(".layer-row").filter({
        has: page.locator("summary", { hasText: `${kind} · ${layer.id}` }),
      });
      await openTool(page, "Scene & layers");
      await row.locator("summary").first().click();
      for (const [field, value] of [
        ["width", width],
        ["height", 0.14],
        ["x", x],
        ["y", 0.02],
      ] as const)
        await row
          .getByLabel(`${field} ${layer.id}`, { exact: true })
          .fill(String(value));
      await expect(saved).toHaveText("All changes saved");
      await row
        .getByRole("combobox", { name: "Motion", exact: true })
        .selectOption("none");
      await expect(saved).toHaveText("All changes saved");
      return layer.assetId;
    };
    const imageId = await place("image", 0.5, 0.18);
    await openTool(page, "Media & voice");
    await page
      .getByLabel("Upload video", { exact: true })
      .setInputFiles(footage);
    await page
      .getByPlaceholder("I own this footage", { exact: true })
      .fill("Original synthetic footage owned by this test");
    await page
      .getByRole("button", { name: "Upload video asset", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add video to selected scene", exact: true })
      .click();
    await expect(saved).toHaveText("All changes saved");
    const videoId = await place("video", 0.72, 0.2);
    const edited = await read();
    expect(edited.timeline.audioTracks[0].startFrame).toBe(450);
    expect(edited.timeline.scenes[1].intent).toBe(secondNotes);
    expect(edited.assets.map((a: { id: string }) => a.id)).toEqual(
      expect.arrayContaining([imageId, videoId]),
    );
    const admission = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/render`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Approve & export MP4", exact: true })
      .click();
    const job = await (await admission).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 480000,
    });
    const report = await (
      await request.get(`/api/jobs/${job.id}/evidence/report.json`)
    ).json();
    expect([report.export.width, report.export.height]).toEqual([1920, 1080]);
    expect(report.export.duration).toBeCloseTo(60, 2);
    expect(report.qc.layout.before).toEqual([]);
    expect(report.qc.layout.after).toEqual([]);
    expect(report.qc.layout.changes).toEqual([]);
    expect(report.qc.audio.codec).toBe("aac");
    expect(report.qc.audio.duration).toBeCloseTo(60, 2);
    const movie = path.join(root, "story.mp4"),
      download = await request.get(`/api/jobs/${job.id}/download`);
    expect(download.status()).toBe(200);
    await writeFile(movie, await download.body());
    for (const [second, audible] of [
      [0, false],
      [15.1, true],
    ] as const) {
      const samples = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(second),
          "-i",
          movie,
          "-t",
          "1.5",
          "-vn",
          "-f",
          "f32le",
          "-ac",
          "1",
          "-ar",
          "48000",
          "pipe:1",
        ],
        { timeout: 15000 },
      );
      let maximum = 0;
      for (let offset = 0; offset < samples.length; offset += 4)
        maximum = Math.max(maximum, Math.abs(samples.readFloatLE(offset)));
      expect(samples.length).toBeGreaterThan(0);
      if (audible) expect(maximum).toBeGreaterThan(0.01);
      else expect(maximum).toBeLessThan(0.0001);
    }
    // Independently decode the actual download, and prove both owned media
    // elements appear in the second scene rather than just in the report.
    const frame = await encodedFrame(request, job.id, 15.5);
    const pixels = (x: number, y: number) => [
      ...frame.data.subarray(
        (y * frame.width + x) * 3,
        (y * frame.width + x) * 3 + 3,
      ),
    ];
    const [red, green, blue] = pixels(1100, 90);
    expect(red).toBeGreaterThan(220);
    expect(green).toBeGreaterThan(130);
    expect(blue).toBeLessThan(80);
    const [videoRed, videoGreen, videoBlue] = pixels(1500, 90);
    expect(videoRed).toBeLessThan(70);
    expect(videoGreen).toBeGreaterThan(80);
    expect(videoGreen).toBeLessThan(165);
    expect(videoBlue).toBeGreaterThan(180);
    const picture = await request.get(
      `/api/jobs/${job.id}/evidence/scene-2-begin.png`,
    );
    expect(picture.status()).toBe(200);
    await testInfo.attach("mixed-story-encoded.png", {
      body: await picture.body(),
      contentType: "image/png",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
