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
