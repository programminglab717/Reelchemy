import { test, expect, openTool } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import type { Project } from "../../src/lib/schema";

async function fixture(request: APIRequestContext, count: number) {
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Review saved edits",
      blank: true,
      duration: 5,
      format: "landscape",
    },
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as Project;
  source.revisions = Array.from({ length: count }, (_, index) => {
    const timeline = structuredClone(source.timeline!);
    timeline.scenes[0].title = `Cut ${index + 1}`;
    timeline.scenes[0].layers[0].text = `Frame ${index + 1}`;
    return {
      id: `retained-version-${index}`,
      createdAt: new Date().toISOString(),
      source:
        index === count - 1
          ? "Saved version description that wraps on a narrow screen. ".repeat(
              7,
            )
          : `Editor cut ${index + 1}`,
      timeline,
    };
  });
  source.timeline = structuredClone(source.revisions.at(-1)!.timeline);
  const imported = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: Buffer.from(
      zipSync({
        "project.json": strToU8(
          JSON.stringify({ format: "reelchemy", version: 1, project: source }),
        ),
      }),
    ),
  });
  expect(imported.status()).toBe(201);
  return (await imported.json()) as Project;
}
async function open(page: Page, project: Project) {
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    project.timeline!.scenes[0].title,
  );
}

test("saved versions page and preview without edits, then an uncertain restore recovers exactly one new version", async ({
  page,
  request,
}) => {
  const project = await fixture(request, 45);
  await open(page, project);
  const browse = page.getByRole("button", {
    name: "Browse saved versions",
    exact: true,
  });
  await openTool(page, "Project");
  await browse.click();
  const dialog = page.getByRole("dialog", {
    name: "Saved versions",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Versions 1–20 of 45", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Older versions", exact: true })
    .click();
  await expect(
    dialog.getByText("Versions 21–40 of 45", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preview saved version 25", exact: true })
    .click();
  const preview = dialog.getByRole("region", {
    name: "Saved version preview",
    exact: true,
  });
  await expect(
    preview.getByRole("heading", { name: "Version 25", exact: true }),
  ).toBeVisible();
  await expect(preview.getByText("Frame 25", { exact: true })).toBeVisible();
  let current = (await (
    await request.get(`/api/projects/${project.id}`)
  ).json()) as Project;
  expect(current.revisions).toHaveLength(45);
  expect(current.timeline!.scenes[0].title).toBe("Cut 45");
  await page.screenshot({ path: "artifacts/version-history-desktop.png" });
  let requests = 0;
  await page.route(`**/api/projects/${project.id}/restore`, async (route) => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) {
      expect(response.status()).toBe(200);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic response lost after restore committed",
        }),
      });
    } else await route.fulfill({ response });
  });
  await dialog
    .getByRole("button", { name: "Restore this version", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Synthetic response lost after restore committed",
  );
  await dialog
    .getByRole("button", { name: "Retry restore", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("newer saved version");
  await dialog
    .getByRole("button", { name: "Reload current saved film", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Cut 25",
  );
  await expect(browse).toBeFocused();
  current = (await (
    await request.get(`/api/projects/${project.id}`)
  ).json()) as Project;
  expect(requests).toBe(2);
  expect(current.revisions).toHaveLength(46);
  expect(current.timeline!.scenes[0].title).toBe("Cut 25");
  expect(current.revisions[44].timeline.scenes[0].title).toBe("Cut 45");
});

test("mobile history read failures retry while preview and keyboard commands preserve an unsaved current cut", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const project = await fixture(request, 3);
  await open(page, project);
  await page.route(`**/api/projects/${project.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic save outage while browsing history",
        }),
      });
    else await route.continue();
  });
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this unsaved cut");
  await expect(
    page.getByText("Synthetic save outage while browsing history", {
      exact: true,
    }),
  ).toBeVisible();
  let fail = true;
  await page.route(
    `**/api/projects/${project.id}/history?**`,
    async (route) => {
      if (
        fail &&
        new URL(route.request().url()).searchParams.has("revisionId")
      ) {
        fail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic saved preview outage" }),
        });
      } else await route.continue();
    },
  );
  await openTool(page, "Project");
  await page
    .getByRole("button", { name: "Browse saved versions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Saved versions",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toHaveText(
    "Synthetic saved preview outage",
  );
  await dialog
    .getByRole("button", { name: "Retry preview", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("region", { name: "Saved version preview" })
      .getByText("Frame 3", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Preview saved version 1", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("region", { name: "Saved version preview" })
      .getByText("Frame 1", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Restore this version", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Finish saving your current edits before restoring.", {
      exact: true,
    }),
  ).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll("body *")]
      .filter(
        (element) => element.getBoundingClientRect().right > window.innerWidth,
      )
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(
    overflow.width,
  );
  const box = await dialog.boundingBox();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "artifacts/version-history-mobile.png" });
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep this unsaved cut",
  );
  let current = (await (
    await request.get(`/api/projects/${project.id}`)
  ).json()) as Project;
  expect(current.revisions).toHaveLength(3);
  expect(current.timeline!.scenes[0].title).toBe("Cut 3");
  await page.unroute(`**/api/projects/${project.id}`);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  current = (await (
    await request.get(`/api/projects/${project.id}`)
  ).json()) as Project;
  expect(current.revisions).toHaveLength(4);
  expect(current.timeline!.scenes[0].title).toBe("Keep this unsaved cut");
});
