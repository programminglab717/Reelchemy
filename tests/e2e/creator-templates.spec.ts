import { test, expect } from "./fixtures";
import {
  creatorTemplates,
  creatorTemplateTimeline,
} from "../../src/lib/creator-templates";
import { encodedFrame } from "./media-frame";

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
    await expect(
      page.getByLabel("Export resolution", { exact: true }),
    ).toHaveValue("1080p");
    await expect(page.getByLabel("Scene notes", { exact: true })).toHaveValue(
      original.scenes[0].intent,
    );
    const recorder = page.getByRole("region", {
      name: "Record narration",
      exact: true,
    });
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

test("scene notes and captions save as undoable edits while changing recording notes preserves a live microphone take", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(15000);
  const template = creatorTemplates[2];
  await page.goto("/");
  await page
    .getByRole("button", { name: `Use ${template.name} template`, exact: true })
    .click();
  await expect(page.getByLabel("Scene notes", { exact: true })).toBeVisible();
  const [project] = await (await request.get("/api/projects")).json();
  const saved = page.getByRole("status", { name: "Save status" });
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
  await page.getByLabel("Scene notes", { exact: true }).fill(secondNotes);
  await expect(saved).toHaveText("All changes saved");
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
    name: "Add audio: Narration",
    exact: true,
  });
  await expect(add).toBeVisible({ timeout: 120000 });
  await add.click();
  await expect(saved).toHaveText("All changes saved");
  await page.getByLabel("startFrame audio", { exact: true }).fill("450");
  await expect(saved).toHaveText("All changes saved");
  expect((await read()).timeline.audioTracks[0].startFrame).toBe(450);
  await page.reload();
  await page.getByRole("button", { name: template.name, exact: false }).click();
  await page
    .getByRole("button", {
      name: `Timeline scene 2: ${project.timeline.scenes[1].title}`,
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Scene notes", { exact: true })).toHaveValue(
    secondNotes,
  );
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
  await recorder.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await recorder.screenshot({
    path: testInfo.outputPath("recording-notes-mobile.png"),
  });
});
