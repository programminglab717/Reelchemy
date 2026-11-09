import { test, expect } from "./fixtures";
test("layer and camera motion can be authored and reset with visual controls", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  const row = page.locator(".layer-row").filter({ hasText: "text · title" });
  await row.locator("summary").first().click();
  await row.getByText("Custom keyframes", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add Layer title keyframe", exact: true })
    .click();
  await page.getByLabel("Layer title motion frame", { exact: true }).fill("60");
  await page
    .getByLabel("Layer title horizontal offset", { exact: true })
    .fill("0.05");
  await page.getByLabel("Layer title scale", { exact: true }).fill("1.1");
  await page
    .getByRole("button", { name: "Select Layer title key at frame 60" })
    .click();
  await expect(
    page.getByLabel("Layer title scale", { exact: true }),
  ).toHaveValue("1.1");
  await page.getByText("Scene camera keyframes", { exact: true }).click();
  await page
    .getByRole("button", { name: "Add Camera keyframe", exact: true })
    .click();
  await page.getByLabel("Camera motion frame", { exact: true }).fill("90");
  await page.getByLabel("Camera scale", { exact: true }).fill("1.15");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const [p] = await (await request.get("/api/projects")).json();
  const layer = p.timeline.scenes[0].layers[0];
  expect(layer.keyframes).toEqual([
    { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
    { frame: 60, x: 0.05, y: 0, scale: 1.1, opacity: 1 },
  ]);
  expect(p.timeline.scenes[0].camera).toEqual([
    { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
    { frame: 90, x: 0, y: 0, scale: 1.15, opacity: 1 },
  ]);
  await page
    .getByRole("button", { name: "Reset Camera motion", exact: true })
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Camera scale", { exact: true })).toHaveValue(
    "1.15",
  );
  await page.getByLabel("Camera motion frame", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Remove Camera keyframe", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Camera key at frame 0" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select Camera key at frame 90" })
    .click();
  await expect(page.getByLabel("Camera scale", { exact: true })).toHaveValue(
    "1.15",
  );
  // The advanced editor reflects the visual state and rejects invalid frames.
  await page.getByText("Advanced camera JSON", { exact: true }).click();
  expect(
    JSON.parse(await page.getByLabel("Camera keyframe JSON").inputValue()),
  ).toHaveLength(1);
  await page
    .getByLabel("Camera keyframe JSON")
    .fill('[{"frame":999,"x":0,"y":0,"scale":1,"opacity":1}]');
  await page.getByRole("button", { name: "Apply camera motion" }).click();
  await expect(
    page.getByText("Keys must be valid, increase strictly, and fit the scene."),
  ).toBeVisible();
});
