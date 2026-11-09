import { test, expect, openTool } from "./fixtures";

test("blank canvas autosaves, undo/redo survives saves, and navigation reopens current data", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  const input = page.getByLabel("Scene title", { exact: true });
  await input.fill("A manually edited story");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(input).toHaveValue("Scene 1");
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(input).toHaveValue("A manually edited story");
  await page.getByRole("button", { name: "← Studio", exact: true }).click();
  await page.getByRole("button", { name: "Untitled creation" }).click();
  await expect(input).toHaveValue("A manually edited story");
  const projects = await (await request.get("/api/projects")).json();
  expect(projects[0].timeline.scenes[0].title).toBe("A manually edited story");
  await page.reload();
  await page.getByRole("button", { name: "Untitled creation" }).click();
  await expect(input).toHaveValue("A manually edited story");
});

test("edits made while a save is in flight are kept and saved in order", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  let delayed = false;
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PATCH" && !delayed) {
      delayed = true;
      started();
      await gate;
    }
    await route.continue();
  });
  const title = page.getByLabel("Scene title", { exact: true });
  await openTool(page, "Scene & layers");
  await title.fill("First draft");
  await began;
  await title.fill("Newer edit during save");
  release();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await expect(title).toHaveValue("Newer edit during save");
  const projects = await (await request.get("/api/projects")).json();
  expect(projects[0].timeline.scenes[0].title).toBe("Newer edit during save");
  expect(projects[0].revisions).toHaveLength(3);
});

test("a stale tab gets a conflict without overwriting the newer saved project", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toBeVisible();
  const [p] = await (await request.get("/api/projects")).json();
  const timeline = structuredClone(p.timeline);
  timeline.scenes[0].title = "Saved in another tab";
  const write = await request.patch(`/api/projects/${p.id}`, {
    data: { timeline, baseRevisionId: p.revisions.at(-1).id },
  });
  expect(write.status()).toBe(200);
  await page.getByLabel("Scene title", { exact: true }).fill("My unsaved work");
  await expect(
    page.getByText("This project has a newer saved version.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "My unsaved work",
  );
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).timeline
      .scenes[0].title,
  ).toBe("Saved in another tab");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download unsaved draft" }).click();
  expect((await downloadEvent).suggestedFilename()).toContain(
    "reelchemy-draft-",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Open latest saved version" }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Saved in another tab",
  );
});
