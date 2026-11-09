import { test, expect, openTool } from "./fixtures";
import { encodedFrame } from "./media-frame";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { subtitles } from "../../src/lib/captions";

test("a five-minute film survives editing and archive transfer and exports its last scene, subtitle and late narration", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(660000);
  page.setDefaultTimeout(15000);
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-long-maker-"));
  try {
    await page.goto("/");
    await page.getByLabel("Duration", { exact: true }).selectOption("300");
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/projects") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Start from a blank canvas" })
      .click();
    const project = await (await created).json();
    expect(project.timeline.scenes).toHaveLength(15);
    const saved = page.getByRole("status", { name: "Save status" });
    await expect(
      page.getByRole("button", { name: "Duplicate scene", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByLabel("Timeline playhead", { exact: true }),
    ).toHaveAttribute("max", "8999");
    await page
      .getByRole("button", { name: "Timeline scene 15: Scene 15", exact: true })
      .click();
    await page
      .getByLabel("Scene title", { exact: true })
      .fill("The closing scene");
    await expect(saved).toHaveText("All changes saved");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "Scene 15",
    );
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(saved).toHaveText("All changes saved");
    const source = path.join(root, "closing.wav");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:duration=5",
        "-ar",
        "48000",
        "-ac",
        "2",
        source,
      ],
      { timeout: 15000 },
    );
    const uploaded = await request.post(`/api/projects/${project.id}/assets`, {
      multipart: {
        kind: "audio",
        license: "Generated owned narration fixture",
        file: {
          name: "closing.wav",
          mimeType: "audio/wav",
          buffer: await readFile(source),
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    const current = await uploaded.json(),
      asset = current.assets.find(
        (a: { mime: string }) => a.mime === "audio/wav",
      );
    current.timeline.audioTracks = [
      {
        id: "closing",
        assetId: asset.id,
        startFrame: 8850,
        offsetFrames: 0,
        durationFrames: 150,
        fadeFrames: 6,
        volume: 0.8,
      },
    ];
    current.timeline.captions = [
      {
        id: "closing",
        startFrame: 8940,
        endFrame: 9000,
        text: "A complete story, made here.",
      },
    ];
    expect(
      (
        await request.patch(`/api/projects/${project.id}`, {
          data: {
            timeline: current.timeline,
            baseRevisionId: current.revisions.at(-1).id,
          },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await page
      .getByRole("button", { name: project.name, exact: false })
      .click();
    await openTool(page, "Sound & captions");
    await expect(
      page.getByLabel("startFrame audio", { exact: true }),
    ).toHaveValue("8850");
    const archive = await request.get(`/api/projects/${project.id}/archive`);
    const imported = await request.post("/api/projects/import", {
      headers: { "content-type": "application/zip" },
      data: await archive.body(),
    });
    expect(imported.status()).toBe(201);
    const restored = await imported.json();
    expect(restored.timeline.scenes.at(-1).title).toBe("The closing scene");
    expect(restored.timeline.audioTracks[0].startFrame).toBe(8850);
    expect(restored.timeline.captions[0].endFrame).toBe(9000);
    const admitted = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/render`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    const job = await (await admitted).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 600000,
    });
    const report = await (
      await request.get(`/api/jobs/${job.id}/evidence/report.json`)
    ).json();
    expect(report.export.duration).toBeCloseTo(300, 2);
    expect(report.sceneCache).toHaveLength(15);
    expect(report.qc.audio.codec).toBe("aac");
    const frame = await encodedFrame(request, job.id, 299);
    expect([frame.width, frame.height]).toEqual([1280, 720]);
    expect(
      (
        await request.get(`/api/jobs/${job.id}/evidence/scene-15-end.png`)
      ).status(),
    ).toBe(200);
    expect(
      await (
        await request.get(`/api/jobs/${job.id}/evidence/captions.srt`)
      ).text(),
    ).toContain("00:05:00,000");
    const movie = path.join(root, "export.mp4");
    await writeFile(
      movie,
      await (await request.get(`/api/jobs/${job.id}/download`)).body(),
    );
    // Independently decode both the quiet opening and late narration from the download.
    for (const [second, audible] of [
      [0, false],
      [298, true],
    ] as const) {
      const audio = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(second),
          "-i",
          movie,
          "-t",
          "1",
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
      for (let offset = 0; offset < audio.length; offset += 4)
        maximum = Math.max(maximum, Math.abs(audio.readFloatLE(offset)));
      expect(audio.length).toBeGreaterThan(0);
      if (audible) expect(maximum).toBeGreaterThan(0.01);
      else expect(maximum).toBeLessThan(0.0001);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("five-minute-mobile.png"),
      fullPage: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("500 imported caption cues stay searchable and paged through undo, reload and project changes", async ({
  page,
  request,
}, testInfo) => {
  page.setDefaultTimeout(15000);
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Long caption collection",
      duration: 300,
      format: "landscape",
      blank: true,
    },
  });
  expect(created.status()).toBe(201);
  const project = await created.json(),
    timeline = project.timeline;
  timeline.captions = Array.from({ length: 500 }, (_, i) => ({
    id: `cue-${i}`,
    startFrame: i * 18,
    endFrame: (i + 1) * 18,
    text: `Narration cue ${i + 1}`,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: false }).click();
  await openTool(page, "Sound & captions");
  await page.getByLabel("Import subtitles", { exact: true }).setInputFiles({
    name: "long.srt",
    mimeType: "text/plain",
    buffer: Buffer.from(subtitles(timeline, "srt")),
  });
  await expect(
    page.getByRole("region", { name: "Subtitle import preview" }),
  ).toContainText("500 cues");
  await page
    .getByRole("button", { name: "Replace all captions (0)", exact: true })
    .click();
  const saved = page.getByRole("status", { name: "Save status" });
  await expect(saved).toHaveText("All changes saved");
  await expect(page.getByLabel(/^Caption \d+ text$/)).toHaveCount(25);
  await expect(
    page.getByRole("button", { name: /^Move Caption / }),
  ).toHaveCount(34);
  await page.getByLabel("Caption page", { exact: true }).selectOption("19");
  await expect(
    page.getByLabel("Caption 500 text", { exact: true }),
  ).toHaveValue("Narration cue 500");
  await page
    .getByLabel("Caption 500 text", { exact: true })
    .fill("The final words");
  await expect(saved).toHaveText("All changes saved");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByLabel("Caption 500 text", { exact: true }),
  ).toHaveValue("Narration cue 500");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("Find caption", { exact: true }).fill("final words");
  await expect(page.getByLabel(/^Caption \d+ text$/)).toHaveCount(1);
  await expect(
    page.getByLabel("Caption 500 text", { exact: true }),
  ).toHaveValue("The final words");
  await expect(saved).toHaveText("All changes saved");
  await page.reload();
  await page.getByRole("button", { name: project.name, exact: false }).click();
  await openTool(page, "Sound & captions");
  await page.getByLabel("Find caption", { exact: true }).fill("final words");
  await expect(
    page.getByLabel("Caption 500 text", { exact: true }),
  ).toHaveValue("The final words");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("Caption 500 text", { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("caption-search-mobile.png"),
    fullPage: true,
  });
  const short = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Another caption studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.getByRole("button", { name: short.name, exact: false }).click();
  await openTool(page, "Sound & captions");
  await page.getByRole("button", { name: "Add caption", exact: true }).click();
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "Your caption",
  );
  await expect(page.getByLabel("Find caption", { exact: true })).toHaveCount(0);
});
