import { test, expect } from "./fixtures";
// A project opens as an overview; the editor is one button away.
test.use({ overviewFirst: true });
test("a project opens as an overview, Edit video opens the editor, and the choice can be made permanent", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.getByLabel("Video idea").fill(`Tides explained ${Date.now()}`);
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "Create storyboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your storyboard" }),
  ).toBeVisible();
  // The overview: player, scenes, director and the export button. No
  // timeline, tool tabs or history buttons.
  const edit = page.getByRole("button", { name: "Edit video", exact: true });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Creative conversation")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve & export MP4", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Editing tools" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeHidden();
  await expect(page.getByLabel("On-screen text")).toBeHidden();
  await expect(page.locator(".workspace-timeline")).toBeHidden();
  await page.screenshot({
    path: process.env.UI_SHOTS
      ? `${process.env.UI_SHOTS}/overview.png`
      : "artifacts/ui-overview.png",
  });
  // The editor: timeline, every tool as a tab, history and saving.
  await edit.click();
  const done = page.getByRole("button", { name: "Done editing", exact: true });
  await expect(done).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".workspace-timeline")).toBeVisible();
  await page.screenshot({
    path: process.env.UI_SHOTS
      ? `${process.env.UI_SHOTS}/editor-top.png`
      : "artifacts/ui-editor-top.png",
  });
  const tabs = page.getByRole("tablist", { name: "Editing tools" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "Director",
    "Scene & layers",
    "Design",
    "Media & voice",
    "Sound & captions",
    "Export",
    "Project",
  ]);
  await expect(
    tabs.getByRole("tab", { name: "Scene & layers" }),
  ).toHaveAttribute("aria-selected", "true");
  // On a laptop screen the player, the scenes and the start of the timeline
  // share the first screen.
  expect(
    (await page.locator(".workspace-timeline").boundingBox())!.y,
  ).toBeLessThan(700);
  await expect(page.getByLabel("On-screen text")).toBeVisible();
  await expect(page.getByLabel("Creative conversation")).toBeHidden();
  await tabs.getByRole("tab", { name: "Director" }).click();
  await expect(page.getByLabel("Creative conversation")).toBeVisible();
  await page.screenshot({
    path: process.env.UI_SHOTS
      ? `${process.env.UI_SHOTS}/editor.png`
      : "artifacts/ui-editor.png",
  });
  await tabs.getByRole("tab", { name: "Scene & layers" }).click();
  await page.screenshot({
    path: process.env.UI_SHOTS
      ? `${process.env.UI_SHOTS}/editor-scene.png`
      : "artifacts/ui-editor-scene.png",
    fullPage: true,
  });
  // An edit made in the editor stays when the editor is closed.
  await page.getByLabel("On-screen text").fill("The moon pulls the sea.");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await done.click();
  await expect(tabs).toBeHidden();
  await expect(page.getByLabel("Creative conversation")).toBeVisible();
  await expect(page.locator(".scene-card").first()).toContainText(
    "The moon pulls the sea.",
  );
  // Neither view is wider than a phone.
  for (const editing of [false, true]) {
    await page.setViewportSize({ width: 390, height: 844 });
    if (editing) await edit.click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: process.env.UI_SHOTS
        ? `${process.env.UI_SHOTS}/phone-${editing ? "editor" : "overview"}.png`
        : `artifacts/ui-phone-${editing ? "editor" : "overview"}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  // "Always open projects in the editor" is remembered in this browser.
  await tabs.getByRole("tab", { name: "Project" }).click();
  await page.getByLabel("Always open projects in the editor").check();
  await page.getByRole("button", { name: "← Studio" }).click();
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: /Tides explained/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Done editing", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace-timeline")).toBeVisible();
});
test("a link can open a project straight at one of the editor's tools", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Linked to media",
      duration: 5,
      format: "landscape",
      blank: true,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  await page.goto(`/?project=${id}&open=media`);
  await expect(
    page.getByRole("tab", { name: "Media & voice" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/$/);
});
test("on a wide screen the editor's tools are an inspector beside the film", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Inspector layout",
      duration: 10,
      format: "landscape",
      blank: true,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${id}&open=scene`);
  const tabs = page.getByRole("tablist", { name: "Editing tools" });
  await expect(tabs).toBeVisible();
  const side = page.locator(".workspace-side");
  const box = async (selector: string) =>
    (await page.locator(selector).boundingBox())!;
  // The tools stand to the right of the player and the timeline, on the
  // first screen, and the sidebar has made room for them.
  const timeline = await box(".workspace-timeline");
  const inspector = await box(".workspace-side");
  expect(inspector.x).toBeGreaterThanOrEqual(timeline.x + timeline.width);
  expect(inspector.y).toBeLessThan(400);
  expect(timeline.y).toBeLessThan(900);
  await expect(page.locator(".sidebar")).toBeHidden();
  const shots = process.env.UI_SHOTS;
  for (const name of [
    "Director",
    "Scene & layers",
    "Design",
    "Media & voice",
    "Sound & captions",
    "Export",
    "Project",
  ]) {
    await tabs.getByRole("tab", { name, exact: true }).click();
    await expect(tabs.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // Nothing in a tool is wider than the inspector or the page.
    expect(
      await side.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      `${name} fits the inspector`,
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (shots)
      await page.screenshot({
        path: `${shots}/inspector-${name.replace(/\W+/g, "-").toLowerCase()}.png`,
      });
  }
  // The film stays in view while a long tool scrolls.
  await tabs.getByRole("tab", { name: "Scene & layers", exact: true }).click();
  await side.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.locator(".preview-panel")).toBeInViewport();
  // An edit made in the inspector reaches the film.
  await page.getByLabel("Scene title", { exact: true }).fill("Inspector edit");
  await expect(page.locator(".scene-card").first()).toContainText(
    "Inspector edit",
  );
  // On a very wide screen the sidebar stays.
  await page.setViewportSize({ width: 1760, height: 1000 });
  await expect(page.locator(".sidebar")).toBeVisible();
  // Below the inspector's width the tools go back under the timeline.
  await page.setViewportSize({ width: 1280, height: 720 });
  const stacked = await box(".workspace-side");
  const below = await box(".workspace-timeline");
  expect(stacked.y).toBeGreaterThan(below.y + below.height - 1);
});
