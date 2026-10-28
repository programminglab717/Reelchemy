import { test, expect, account } from "./fixtures";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import sharp from "sharp";
test("idea → varied storyboard → saved edit → approval → actual MP4 download", async ({
  page,
  browser,
}) => {
  test.setTimeout(360000);
  const idea = `A mountain sunrise ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-studio.png", fullPage: true });
  await page.getByLabel("Video idea").fill(idea);
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "Create storyboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your storyboard" }),
  ).toBeVisible();
  await expect(page.locator(".scene-card")).toHaveCount(3);
  await page.getByLabel("On-screen text").fill("Every story starts somewhere.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved ✓" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/ui-storyboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/e2e-export.mp4");
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "artifacts/e2e-export.mp4",
      ],
      { encoding: "utf8" },
    ),
  );
  const video = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  expect(video.codec_name).toBe("h264");
  expect(video.width).toBe(1280);
  expect(video.height).toBe(720);
  expect(video.r_frame_rate).toBe("30/1");
  expect(Number(probe.format.duration)).toBeCloseTo(5, 1);
  expect((await fs.stat("artifacts/e2e-export.mp4")).size).toBeGreaterThan(
    10000,
  );
  await page.reload();
  await page.getByRole("button", { name: new RegExp(idea) }).click();
  await expect(page.getByLabel("On-screen text")).toHaveValue(
    "Every story starts somewhere.",
  );
  await page.getByLabel("On-screen text").fill("A revised opening.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const projects = await (await page.request.get("/api/projects")).json();
  const p = projects.find((p: { name: string }) => p.name === idea);
  const jobs = await (
    await page.request.get(`/api/projects/${p.id}/render`)
  ).json();
  expect(
    jobs[0].report.sceneCache.map((c: { reused: boolean }) => c.reused),
  ).toEqual([false, true, true]);
  const outsider = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    extraHTTPHeaders: {
      origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    },
  });
  await account(outsider.request, "Isolated viewer");
  for (const suffix of [
    "",
    "/download",
    "/thumbnail",
    "/evidence/report.json",
    "/evidence/scene-1-middle.png",
    "/evidence/scene-1-motion.mp4",
  ]) {
    const url = `/api/jobs/${jobs[0].id}${suffix}`;
    expect((await page.request.get(url)).status()).toBe(200);
    expect((await outsider.request.get(url)).status()).toBe(404);
  }
  await outsider.close();
});
test("mobile composer is usable and does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Video idea")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "artifacts/ui-mobile.png", fullPage: true });
});
test("scene revision preserves other scenes and history can be restored", async ({
  request,
  page,
}) => {
  const response = await request.post("/api/projects", {
    data: {
      prompt: `Revision test ${Date.now()}`,
      duration: 5,
      format: "landscape",
    },
  });
  expect(response.status()).toBe(201);
  const created = await response.json();
  const base = await (
    await request.post(`/api/projects/${created.id}/plan`, { data: {} })
  ).json();
  const edited = await (
    await request.post(`/api/projects/${created.id}/plan`, {
      data: { revision: "A new dawn over the valley", sceneId: "scene-2" },
    })
  ).json();
  expect(edited.timeline.scenes[0]).toEqual(base.timeline.scenes[0]);
  expect(edited.timeline.scenes[2]).toEqual(base.timeline.scenes[2]);
  expect(edited.brief.prompt).toBe(base.brief.prompt);
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(created.name) }).click();
  await page
    .getByLabel("Restore saved version")
    .selectOption(base.revisions[0].id);
  await expect(page.getByText(/3 saved versions/)).toBeVisible();
  const restored = await (
    await request.get(`/api/projects/${created.id}`)
  ).json();
  expect(restored.timeline).toEqual(base.timeline);
  expect(restored.revisions).toHaveLength(3);
});
test("uploaded PNG, keyframe editing and export history survive refresh", async ({
  page,
  request,
}) => {
  const name = `Asset editor ${Date.now()}`;
  const p = await (
    await request.post("/api/projects", {
      data: { prompt: name, duration: 5, format: "square" },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("Upload image").setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#88AA44" },
    })
      .png()
      .toBuffer(),
  });
  await page.getByPlaceholder("I own this image").fill("Original test asset");
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(page.getByText("test.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add to selected scene" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page
    .locator(".layer-row")
    .filter({ hasText: "text · title" })
    .locator("summary")
    .first()
    .click();
  await page.getByLabel("fontSize title", { exact: true }).fill("44");
  await page
    .locator(".layer-row")
    .filter({ hasText: "text · title" })
    .getByText("Custom keyframes", { exact: true })
    .click();
  await page
    .locator(".layer-row")
    .filter({ hasText: "text · title" })
    .getByLabel("Keyframe JSON")
    .fill(
      JSON.stringify([
        { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
        { frame: 20, x: 0.02, y: 0, scale: 1, opacity: 1 },
      ]),
    );
  await page
    .locator(".layer-row")
    .filter({ hasText: "text · title" })
    .getByRole("button", { name: "Apply keyframes", exact: true })
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved ✓" })).toBeVisible();
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(
    saved.timeline.scenes[0].layers.some(
      (l: { kind: string }) => l.kind === "image",
    ),
  ).toBeTruthy();
  expect(saved.assets).toHaveLength(1);
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  await page.getByText("Quality report & scene evidence").click();
  await expect(
    page.getByRole("link", { name: "Open QC report" }),
  ).toBeVisible();
  await expect(page.locator(".evidence-grid img")).toHaveCount(11);
  const jobs = await (await request.get(`/api/projects/${p.id}/render`)).json();
  const image = await request.get(
    `/api/jobs/${jobs[0].id}/evidence/scene-1-middle.png`,
  );
  const pixel = await sharp(await image.body())
    .extract({ left: 540, top: 729, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(Math.abs(pixel[0] - 136)).toBeLessThan(5);
  expect(Math.abs(pixel[1] - 170)).toBeLessThan(5);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page
    .getByRole("button", { name: new RegExp(jobs[0].id.slice(0, 6)) })
    .click();
  await expect(page.getByText("Your film is ready.")).toBeVisible();
});
test("cancelled exports stay cancelled and evidence cannot traverse directories", async ({
  request,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: { prompt: "Cancel me", duration: 5, format: "landscape" },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  const job = await (await request.post(`/api/projects/${p.id}/render`)).json();
  expect((await request.delete(`/api/jobs/${job.id}`)).ok()).toBeTruthy();
  expect((await (await request.get(`/api/jobs/${job.id}`)).json()).status).toBe(
    "cancelled",
  );
  expect(
    (await request.get(`/api/jobs/${job.id}/evidence/studio.sqlite`)).status(),
  ).toBe(404);
});
test("audio upload, timed mix and captions produce AAC and downloadable subtitles", async ({
  page,
  request,
}) => {
  const name = `Sound studio ${Date.now()}`;
  const p = await (
    await request.post("/api/projects", {
      data: { prompt: name, duration: 5, format: "landscape" },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  const tone = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=523:duration=4",
      "-f",
      "wav",
      "pipe:1",
    ],
    { maxBuffer: 1000000 },
  );
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page
    .getByLabel("Upload audio", { exact: true })
    .setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: tone });
  await page.getByPlaceholder("I own this audio").fill("Generated test tone");
  await page
    .getByRole("button", { name: "Upload audio asset", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Add audio: tone.wav" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add audio: tone.wav" }).click();
  await page.getByLabel("durationFrames audio", { exact: true }).fill("60");
  await page.getByLabel("startFrame audio", { exact: true }).fill("30");
  await page.getByRole("button", { name: "Add caption", exact: true }).click();
  await page.getByLabel("Caption 1 text").fill("A story with sound.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const jobs = await (await request.get(`/api/projects/${p.id}/render`)).json(),
    job = jobs[0];
  expect(job.report.qc.audio.codec).toBe("aac");
  expect(job.report.qc.audio.tracks).toBe(1);
  expect(job.report.qc.audio.peakDb).toBeLessThan(0);
  const srt = await request.get(`/api/jobs/${job.id}/evidence/captions.srt`);
  expect(await srt.text()).toContain(
    "00:00:00,000 --> 00:00:02,000\nA story with sound.",
  );
  const image = await request.get(
    `/api/jobs/${job.id}/evidence/scene-1-middle.png`,
  );
  const stats = await sharp(await image.body())
    .extract({ left: 120, top: 590, width: 1040, height: 110 })
    .stats();
  expect(stats.channels[0].max).toBeGreaterThan(230);
  await page.getByRole("link", { name: "SRT captions" }).click();
});
test("editable project download and import preserve revisions in a separate project", async ({
  page,
  request,
}) => {
  const name = `Portable studio ${Date.now()}`;
  const p = await (
    await request.post("/api/projects", {
      data: { prompt: name, duration: 5, format: "landscape" },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download editable project" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  await page.getByRole("button", { name: "← Studio" }).click();
  await page.getByLabel("Import project archive").setInputFiles(file!);
  await expect(
    page.getByRole("heading", { name: `${name} (imported)` }),
  ).toBeVisible();
  const projects = await (await request.get("/api/projects")).json();
  const imported = projects.find(
    (project: { name: string }) => project.name === `${name} (imported)`,
  );
  expect(imported.id).not.toBe(p.id);
  expect(imported.revisions).toHaveLength(1);
  expect((await request.get(`/api/projects/${p.id}`)).ok()).toBeTruthy();
});
test("scene-only preview and generic character/arrow/camera primitives render together", async ({
  page,
  request,
}) => {
  const name = `Motion studio ${Date.now()}`;
  const p = await (
    await request.post("/api/projects", {
      data: { prompt: name, duration: 5, format: "landscape" },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByLabel("Preview selected scene only").check();
  await page.locator(".scene-card").nth(1).click();
  await expect(page.getByLabel("Preview selected scene only")).toBeChecked();
  await page
    .getByRole("button", { name: "Add character", exact: true })
    .click();
  await page.getByRole("button", { name: "Add arrow", exact: true }).click();
  await page.getByText("Scene camera keyframes", { exact: true }).click();
  await page.getByLabel("Camera keyframe JSON").fill(
    JSON.stringify([
      { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
      { frame: 20, x: -0.01, y: 0, scale: 1.03, opacity: 1 },
    ]),
  );
  await page.getByRole("button", { name: "Apply camera motion" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(
    saved.timeline.scenes[1].layers.some(
      (l: { kind: string }) => l.kind === "character",
    ),
  ).toBeTruthy();
  expect(saved.timeline.scenes[1].camera).toHaveLength(2);
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  await page.getByText("Export activity").click();
  await expect(page.getByText(/Preparing scene previews/)).toBeVisible();
});
