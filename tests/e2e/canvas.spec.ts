import { test, expect, openTool } from "./fixtures";

test("canvas gestures, locks, visibility, stacking and timeline work without JSON", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  const stage = page.locator(".canvas-stage");
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  const title = page.getByRole("button", {
    name: "Select layer title",
    exact: true,
  });
  const layerBounds = (await title.boundingBox())!;
  await page.mouse.move(
    layerBounds.x + layerBounds.width / 2,
    layerBounds.y + layerBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    layerBounds.x + layerBounds.width / 2 + bounds.width * 0.06,
    layerBounds.y + layerBounds.height / 2 + bounds.height * 0.08,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const [p] = await (await request.get("/api/projects")).json();
  const saved = async () =>
    (await (await request.get(`/api/projects/${p.id}`)).json()).timeline;
  expect((await saved()).scenes[0].layers[0].x).toBeCloseTo(0.16, 2);
  expect((await saved()).scenes[0].layers[0].y).toBeCloseTo(0.43, 2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect((await saved()).scenes[0].layers[0].x).toBe(0.1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(stage).toHaveCount(1);
  await page
    .getByRole("button", { name: "Resize layer title" })
    .scrollIntoViewIfNeeded();
  const resize = await page
    .getByRole("button", { name: "Resize layer title" })
    .boundingBox();
  await page.mouse.move(
    resize!.x + resize!.width / 2,
    resize!.y + resize!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    resize!.x + resize!.width / 2 - bounds.width * 0.2,
    resize!.y + resize!.height / 2 - bounds.height * 0.05,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect((await saved()).scenes[0].layers[0].width).toBeCloseTo(0.6, 2);
  const before = (await saved()).scenes[0].layers[0].x;
  await page
    .getByRole("button", { name: "Lock layer title", exact: true })
    .click();
  await title.focus();
  await title.press("ArrowRight");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect((await saved()).scenes[0].layers[0].x).toBe(before);
  await page.getByRole("button", { name: "Unlock layer title" }).click();
  await title.focus();
  await title.press("Shift+ArrowRight");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect((await saved()).scenes[0].layers[0].x).toBeCloseTo(
    before + 10 / 1280,
    3,
  );
  await page.getByRole("button", { name: "Hide layer title" }).click();
  await expect(
    stage.getByText("Your story starts here", { exact: true }),
  ).toHaveCount(0);
  await openTool(page, "Scene & layers");
  await page
    .getByRole("button", { name: "Add rectangle", exact: true })
    .click();
  await openTool(page, "Design");
  await page
    .getByRole("button", { name: "Choose title in layer stack" })
    .click();
  await page.getByRole("button", { name: "Bring forward" }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect((await saved()).scenes[0].layers.at(-1).id).toBe("title");
  await page.getByLabel("Timeline playhead").fill("90");
  await expect(page.getByLabel("Playhead time")).toContainText("3.00s");
  await page.getByLabel("Timeline zoom").fill("2");
  await expect(page.locator(".timeline-content")).toHaveAttribute(
    "style",
    /width: 200%/,
  );
  await page.screenshot({
    path: `${process.env.REELCHEMY_ARTIFACT_DIR}/canvas-editor-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(stage).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${process.env.REELCHEMY_ARTIFACT_DIR}/canvas-editor-mobile.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 180000,
  });
  const jobs = await (await request.get(`/api/projects/${p.id}/render`)).json();
  const job = jobs.find((j: { status: string }) => j.status === "completed");
  expect(job).toBeTruthy();
  const report = await (
    await request.get(`/api/jobs/${job.id}/evidence/report.json`)
  ).json();
  expect(
    report.timeline.scenes[0].layers.find(
      (l: { id: string }) => l.id === "title",
    ).hidden,
  ).toBe(true);
  expect((await request.get(`/api/jobs/${job.id}/download`)).status()).toBe(
    200,
  );
});
