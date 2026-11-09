import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function blockSaves(page: Page) {
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic saving outage" }),
      });
    else await route.continue();
  });
}
async function draftCount(page: Page) {
  return page.evaluate(
    () =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("reelchemy:browser-draft:v1:"),
      ).length,
  );
}
test("failed saves survive reload and explicit recovery saves a version and clears the browser copy", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await blockSaves(page);
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Recover this unsaved story");
  await expect(
    page.getByText("Synthetic saving outage", { exact: true }),
  ).toBeVisible();
  await expect.poll(() => draftCount(page)).toBe(1);
  const [before] = await (await request.get("/api/projects")).json();
  expect(before.timeline.scenes[0].title).toBe("Scene 1");
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Untitled creation", exact: true })
    .click();
  const recovery = page.getByRole("region", {
    name: "Browser recovery drafts",
  });
  await expect(
    recovery.getByRole("heading", { name: "Recover this unsaved story" }),
  ).toBeVisible();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  const downloaded = page.waitForEvent("download");
  await recovery
    .getByRole("button", { name: "Download recovery copy" })
    .click();
  expect((await downloaded).suggestedFilename()).toContain(
    "reelchemy-recovery-",
  );
  await page.unroute("**/api/projects/*");
  await recovery
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Recover this unsaved story",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await expect(recovery).toHaveCount(0);
  await expect.poll(() => draftCount(page)).toBe(0);
  const after = await (await request.get(`/api/projects/${before.id}`)).json();
  expect(after.revisions).toHaveLength(2);
  expect(after.timeline.scenes[0].title).toBe("Recover this unsaved story");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
});

test("stale recovery requires a deliberate choice and preserves the intervening saved version", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await blockSaves(page);
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("My older unsaved edit");
  await expect(
    page.getByText("Synthetic saving outage", { exact: true }),
  ).toBeVisible();
  const [p] = await (await request.get("/api/projects")).json();
  const timeline = structuredClone(p.timeline);
  timeline.scenes[0].title = "Newer saved work from another tab";
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).ok(),
  ).toBeTruthy();
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Untitled creation", exact: true })
    .click();
  await page.unroute("**/api/projects/*");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Newer saved work from another tab",
  );
  const recovery = page.getByRole("region", {
    name: "Browser recovery drafts",
  });
  await expect(
    recovery.getByText("based on an earlier saved version", { exact: false }),
  ).toBeVisible();
  page.once("dialog", (d) => void d.dismiss());
  await recovery
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Newer saved work from another tab",
  );
  page.once("dialog", (d) => void d.accept());
  await recovery
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "My older unsaved edit",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const after = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(after.timeline.scenes[0].title).toBe("My older unsaved edit");
  expect(after.revisions[1].timeline.scenes[0].title).toBe(
    "Newer saved work from another tab",
  );
  expect(after.revisions).toHaveLength(3);
});

test("concurrent tabs keep distinct recovery copies and sign-out clears only this account's copies", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  const other = await context.newPage();
  await other.goto("/");
  await other
    .getByRole("button", { name: "Untitled creation", exact: true })
    .click();
  await blockSaves(page);
  await blockSaves(other);
  await page.getByLabel("Scene title", { exact: true }).fill("First tab copy");
  await other
    .getByLabel("Scene title", { exact: true })
    .fill("Second tab copy");
  await expect.poll(() => draftCount(page)).toBe(2);
  await other.close();
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Untitled creation", exact: true })
    .click();
  const recovery = page.getByRole("region", {
    name: "Browser recovery drafts",
  });
  await expect(
    recovery.getByRole("heading", { name: "First tab copy" }),
  ).toBeVisible();
  await expect(
    recovery.getByRole("heading", { name: "Second tab copy" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  page.once("dialog", (d) => void d.dismiss());
  await recovery
    .getByRole("button", { name: "Discard recovery copy" })
    .first()
    .click();
  await expect.poll(() => draftCount(page)).toBe(2);
  page.once("dialog", (d) => void d.accept());
  await recovery
    .getByRole("button", { name: "Discard recovery copy" })
    .first()
    .click();
  await expect.poll(() => draftCount(page)).toBe(1);
  await page.evaluate(() =>
    localStorage.setItem(
      "reelchemy:browser-draft:v1:unrelated-owner:keep",
      "synthetic-other-account-marker",
    ),
  );
  page.once("dialog", (d) => void d.dismiss());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(recovery).toBeVisible();
  await expect.poll(() => draftCount(page)).toBe(2);
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect.poll(() => draftCount(page)).toBe(1);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("reelchemy:browser-draft:v1:unrelated-owner:keep"),
    ),
  ).toBe("synthetic-other-account-marker");
});

test("unavailable browser recovery storage offers a download and never blocks saving manually", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name.startsWith("reelchemy:browser-draft:v1:"))
        throw new DOMException("Synthetic full store", "QuotaExceededError");
      return original.call(this, name, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await blockSaves(page);
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this work without local storage");
  await expect(
    page.getByText("This browser could not keep a recovery copy.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic saving outage", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download unsaved draft", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("reelchemy-draft-");
  await page.unroute("**/api/projects/*");
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect(
    (await (await request.get("/api/projects")).json())[0].timeline.scenes[0]
      .title,
  ).toBe("Keep this work without local storage");
});
