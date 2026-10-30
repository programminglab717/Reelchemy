import { test, expect } from "./fixtures";
import { encodedFrame } from "./media-frame";
test("rotation previews/cancels as one gesture, resizes in local axes and survives history, reload, archive and encoded MP4", async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Rotatable artwork",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  p.timeline.scenes[0] = {
    ...p.timeline.scenes[0],
    background: "#000000",
    accent: "#000000",
    transition: "cut",
    layers: [
      {
        ...p.timeline.scenes[0].layers[0],
        id: "graphic",
        kind: "rectangle",
        text: "",
        color: "#00ffff",
        x: 0.35,
        y: 0.4,
        width: 0.3,
        height: 0.1,
        animation: "none",
      },
    ],
  };
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: p.name, exact: false }).click();
  const controls = page.getByRole("group", {
    name: "Canvas rotation graphic controls",
    exact: true,
  });
  const slider = controls.getByLabel("Canvas rotation graphic slider", {
    exact: true,
  });
  const degrees = controls.getByLabel("Canvas rotation graphic degrees", {
    exact: true,
  });
  await expect(slider).toHaveValue("0");
  async function drag() {
    await slider.scrollIntoViewIfNeeded();
    const b = (await slider.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width, b.y + b.height / 2, { steps: 8 });
  }
  await drag();
  await expect(slider).toHaveValue("180");
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).timeline
      .scenes[0].layers[0].rotation,
  ).toBeUndefined();
  await slider.press("Escape");
  await page.mouse.up();
  await expect(slider).toHaveValue("0");
  await drag();
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(slider).toHaveValue("0");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(slider).toHaveValue("180");
  await degrees.fill("90");
  await degrees.press("Enter");
  await expect(slider).toHaveValue("90");
  await page
    .getByRole("button", { name: "Lock layer graphic", exact: true })
    .click();
  await expect(slider).toBeDisabled();
  await expect(degrees).toBeDisabled();
  await page
    .getByRole("button", { name: "Unlock layer graphic", exact: true })
    .click();
  const handle = page.getByRole("button", {
    name: "Resize layer graphic",
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 15, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const resized = (await (await request.get(`/api/projects/${p.id}`)).json())
    .timeline.scenes[0].layers[0];
  expect(resized.width).toBeGreaterThan(0.3);
  expect(resized.height).toBeLessThan(0.1);
  // At 90 degrees the opposite corner is center+(height/2,-width/2)
  // in physical pixels, independently of the implementation's geometry helper.
  expect(
    Math.abs(
      (resized.x + resized.width / 2) * 1280 + (resized.height * 720) / 2 - 676,
    ),
  ).toBeLessThan(0.3);
  expect(
    Math.abs(
      (resized.y + resized.height / 2) * 720 - (resized.width * 1280) / 2 - 132,
    ),
  ).toBeLessThan(0.3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.reload();
  await page.getByRole("button", { name: p.name, exact: false }).click();
  await expect(slider).toHaveValue("90");
  const archive = await (
    await request.get(`/api/projects/${p.id}/archive`)
  ).body();
  const imported = await request.post("/api/projects/import", {
    data: archive,
    headers: { "content-type": "application/zip" },
  });
  expect(imported.status()).toBe(201);
  const copy = await imported.json();
  expect(copy.timeline.scenes[0].layers[0].rotation).toBe(90);
  expect(copy.revisions.at(-1).timeline.scenes[0].layers[0].rotation).toBe(90);
  async function exportVideo() {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${p.id}/render`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    const job = await (await response).json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${job.id}`)).json()).status,
        { timeout: 200000, intervals: [1000] },
      )
      .toBe("completed");
    await expect(page.getByText("Your film is ready.")).toBeVisible();
    return (await request.get(`/api/jobs/${job.id}`)).json();
  }
  const vertical = await exportVideo();
  const frame = await encodedFrame(request, vertical.id, 2.5);
  const cyan = (x: number, y: number) => {
    const i = (y * frame.width + x) * 3;
    return (
      frame.data[i] < 30 && frame.data[i + 1] > 220 && frame.data[i + 2] > 220
    );
  };
  expect(cyan(640, 180)).toBeTruthy();
  expect(cyan(800, 324)).toBeFalsy();
  await controls
    .getByRole("button", { name: "Reset rotation", exact: true })
    .click();
  const horizontal = await exportVideo();
  expect(horizontal.id).not.toBe(vertical.id);
  expect(horizontal.report.sceneCache[0].reused).toBe(false);
  const after = await encodedFrame(request, horizontal.id, 2.5);
  const i = (324 * after.width + 800) * 3;
  expect(after.data[i]).toBeLessThan(30);
  expect(after.data[i + 1]).toBeGreaterThan(220);
  expect(after.data[i + 2]).toBeGreaterThan(220);
});

test("mobile rotation uses keyboard/numeric controls and invalid or cancelled input preserves the layer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  const controls = page.getByRole("group", {
    name: "Canvas rotation title controls",
    exact: true,
  });
  const number = controls.getByLabel("Canvas rotation title degrees", {
    exact: true,
  });
  const slider = controls.getByLabel("Canvas rotation title slider", {
    exact: true,
  });
  await slider.focus();
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("1");
  await number.fill("45");
  await number.press("Escape");
  await expect(slider).toHaveValue("1");
  await number.fill("181");
  await number.press("Tab");
  await expect(controls.getByRole("alert")).toContainText("−180° to 180°");
  await expect(slider).toHaveValue("1");
  await controls
    .getByRole("button", {
      name: "Canvas rotation title rotate right",
      exact: true,
    })
    .click();
  await expect(slider).toHaveValue("91");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
