import { test, expect } from "./fixtures";
import sharp from "sharp";

test("subtitle import is atomic, undoable and styled consistently in preview, archives and MP4", async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Caption studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Caption studio", exact: false })
    .click();
  await page.getByLabel("Import subtitles", { exact: true }).setInputFiles({
    name: "story.srt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1\n00:00:00,000 --> 00:00:02,000\n<b>Styled story</b> &amp; sound\n\n2\n00:00:02,000 --> 00:00:04,000\nNext cue",
    ),
  });
  await expect(
    page.getByRole("region", { name: "Subtitle import preview" }),
  ).toContainText("2 cues");
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Replace all captions (0)", exact: true })
    .click();
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "Styled story & sound",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page
    .getByLabel("Caption position", { exact: true })
    .selectOption("top");
  await page.getByLabel("Caption font size", { exact: true }).fill("40");
  await page.getByLabel("Caption text color", { exact: true }).fill("#ffff00");
  await page.getByLabel("Bold captions", { exact: true }).check();
  const preview = page.locator(".player-wrap [data-caption-id]");
  await expect(preview).toHaveText("Styled story & sound");
  await expect(preview).toHaveCSS("color", "rgb(255, 255, 0)");
  await expect(preview).toHaveCSS("font-size", "40px");
  const previous = await preview.boundingBox();
  const player = await page.locator(".player-wrap").boundingBox();
  expect(previous!.y - player!.y).toBeLessThan(player!.height * 0.2);
  await page.getByLabel("Import subtitles", { exact: true }).setInputFiles({
    name: "overlap.vtt",
    mimeType: "text/vtt",
    buffer: Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nOverlap"),
  });
  await page
    .getByRole("button", { name: "Merge imported cues", exact: true })
    .click();
  await expect(
    page.getByRole("alert", { name: "Subtitle import error" }),
  ).toContainText("not overlap");
  await expect(page.getByLabel("Caption 1 text", { exact: true })).toHaveValue(
    "Styled story & sound",
  );
  await page
    .getByRole("button", { name: "Cancel subtitle import", exact: true })
    .click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download current VTT", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("captions.vtt");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Caption studio", exact: false })
    .click();
  await expect(
    page.getByLabel("Caption position", { exact: true }),
  ).toHaveValue("top");
  const archive = await request.get(`/api/projects/${p.id}/archive`);
  const imported = await request.post("/api/projects/import", {
    headers: { "content-type": "application/zip" },
    data: await archive.body(),
  });
  expect(imported.status()).toBe(201);
  expect((await imported.json()).timeline.captionStyle).toMatchObject({
    position: "top",
    fontSize: 40,
    color: "#ffff00",
    bold: true,
  });
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const job = (
    await (await request.get(`/api/projects/${p.id}/render`)).json()
  )[0];
  const screenshot = await request.get(
    `/api/jobs/${job.id}/evidence/scene-1-middle.png`,
  );
  // Middle scene snapshot falls in cue 2; actual pixels must reflect custom top/yellow style.
  const { data, info } = await sharp(await screenshot.body())
    .raw()
    .toBuffer({ resolveWithObject: true });
  let topYellow = 0,
    bottomYellow = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] < 100) {
        if (y < 180) topYellow++;
        if (y > 500) bottomYellow++;
      }
    }
  expect(topYellow).toBeGreaterThan(100);
  expect(bottomYellow).toBe(0);
  const srt = await request.get(`/api/jobs/${job.id}/evidence/captions.srt`);
  expect(await srt.text()).toContain("Styled story &amp; sound");
});
