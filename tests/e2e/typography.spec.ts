import { test, expect } from "./fixtures";
import sharp from "sharp";
test("canvas text styling autosaves, respects locks/undo and reaches a real MP4", async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Typography studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  p.timeline.scenes[0].layers[0].height = 0.5;
  await request.patch(`/api/projects/${p.id}`, {
    data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Typography studio", exact: false })
    .click();
  const controls = page.getByRole("group", {
    name: "Canvas title typography",
    exact: true,
  });
  await controls
    .getByLabel("Canvas title text", { exact: true })
    .fill("Words with character");
  await controls
    .getByLabel("Canvas title font", { exact: true })
    .selectOption("mono");
  await controls
    .getByLabel("Canvas title font size", { exact: true })
    .fill("60");
  await controls
    .getByLabel("Canvas title weight", { exact: true })
    .selectOption("regular");
  await controls
    .getByLabel("Canvas title alignment", { exact: true })
    .selectOption("center");
  await controls
    .getByLabel("Canvas title line spacing", { exact: true })
    .fill("1.8");
  await controls
    .getByLabel("Canvas title letter spacing", { exact: true })
    .fill("3");
  await controls.getByLabel("Canvas title italic", { exact: true }).check();
  await controls.getByLabel("Canvas title underline", { exact: true }).check();
  const text = page
    .locator(".player-wrap")
    .getByText("Words with character", { exact: true });
  await expect(text).toHaveCSS("font-weight", "400");
  await expect(text).toHaveCSS("font-style", "italic");
  await expect(text).toHaveCSS("letter-spacing", "3px");
  await expect(text).toHaveCSS("text-align", "center");
  await expect(text).toHaveCSS("line-height", "108px");
  await page
    .getByRole("button", { name: "Lock layer title", exact: true })
    .click();
  await expect(
    controls.getByLabel("Canvas title font", { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Unlock layer title", exact: true })
    .click();
  await controls
    .getByRole("button", { name: "Reset text style", exact: true })
    .click();
  await expect(text).toHaveCSS("font-weight", "700");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(text).toHaveCSS("font-weight", "400");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Typography studio", exact: false })
    .click();
  await expect(
    page.getByLabel("Canvas title font", { exact: true }),
  ).toHaveValue("mono");
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const job = (
    await (await request.get(`/api/projects/${p.id}/render`)).json()
  )[0];
  expect(job.report.timeline.scenes[0].layers[0]).toMatchObject({
    fontFamily: "mono",
    fontWeight: "regular",
    textAlign: "center",
    lineHeight: 1.8,
    letterSpacing: 3,
    italic: true,
    underline: true,
  });
  const image = await request.get(
    `/api/jobs/${job.id}/evidence/scene-1-middle.png`,
  );
  expect(
    (await sharp(await image.body()).stats()).channels[0].max,
  ).toBeGreaterThan(230);
});

test("mobile canvas exposes text controls without horizontal overflow", async ({
  page,
  request,
}) => {
  await request.post("/api/projects", {
    data: {
      prompt: "Mobile typography",
      duration: 5,
      format: "portrait",
      blank: true,
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Mobile typography", exact: false })
    .click();
  const controls = page.getByRole("group", {
    name: "Canvas title typography",
    exact: true,
  });
  await controls
    .getByLabel("Canvas title text", { exact: true })
    .fill("Make something worth sharing.");
  await controls
    .getByLabel("Canvas title font", { exact: true })
    .selectOption("serif");
  await controls
    .getByLabel("Canvas title weight", { exact: true })
    .selectOption("heavy");
  await expect(controls).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const path = await import("node:path");
  await page.locator(".canvas-editor").screenshot({
    path: path.join(
      process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
      "typography-mobile.png",
    ),
  });
});
