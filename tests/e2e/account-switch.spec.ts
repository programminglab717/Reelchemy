import { browserTest as test, expect, account } from "./fixtures";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { ACCOUNT_HEADER } from "../../src/lib/account-session";

async function holdDraft(page: Page, title: string) {
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic saving outage" }),
      });
    else await route.continue();
  });
  await page.getByLabel("Scene title", { exact: true }).fill(title);
  await expect(
    page.getByText("Synthetic saving outage", { exact: true }),
  ).toBeVisible();
}
test("switching accounts stops stale studio requests, preserves the original draft and reloads into the new studio", async ({
  page,
  request,
}) => {
  const original = await account(request, "Original creator");
  const firstSession = await (
    await request.get("/api/auth/get-session")
  ).json();
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText("Original creator");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await holdDraft(page, "Only the original creator's draft");
  const [firstProject] = await (await request.get("/api/projects")).json();
  await page.unroute("**/api/projects/*");
  await account(request, "Next creator");
  const nextSession = await (await request.get("/api/auth/get-session")).json();
  expect(nextSession.user.id).not.toBe(firstSession.user.id);
  const oldActor = { [ACCOUNT_HEADER]: firstSession.user.id };
  const staleSession = await request.get("/api/auth/get-session", {
    headers: oldActor,
  });
  expect(staleSession.status()).toBe(409);
  expect(staleSession.headers()["cache-control"]).toBe("private, no-store");
  expect(staleSession.headers()["set-cookie"]).toBeUndefined();
  const staleDetails = await staleSession.text();
  expect(staleDetails).not.toContain(nextSession.user.id);
  expect(JSON.parse(staleDetails).code).toBe("ACCOUNT_CHANGED");
  const staleUpdate = await request.post("/api/auth/update-user", {
    headers: oldActor,
    data: { name: "A stale tab must not rename the next account" },
  });
  expect(staleUpdate.status()).toBe(409);
  expect(staleUpdate.headers()["set-cookie"]).toBeUndefined();
  expect(
    (await (await request.get("/api/auth/get-session")).json()).user.name,
  ).toBe("Next creator");
  const nextProject = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Private next creator's story",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await page.getByLabel("Search projects").fill("Private next");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "The account in this browser changed." })
    .first();
  await expect(notice).toBeVisible();
  await expect(
    page.getByRole("button", { name: nextProject.name, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download unsaved draft", exact: true })
    .click();
  const savedDraft = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(savedDraft.userId).toBe(firstSession.user.id);
  expect(savedDraft.projectId).toBe(firstProject.id);
  expect(savedDraft.timeline.scenes[0].title).toBe(
    "Only the original creator's draft",
  );
  const copies = await page.evaluate(() =>
    Object.entries(localStorage)
      .filter(([key]) => key.startsWith("reelchemy:browser-draft:v1:"))
      .map(([, value]) => JSON.parse(value)),
  );
  expect(copies).toHaveLength(1);
  expect(copies[0].userId).toBe(firstSession.user.id);
  expect(
    (await (await request.get(`/api/projects/${nextProject.id}`)).json())
      .timeline.scenes[0].title,
  ).toBe("Scene 1");
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Reload studio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: nextProject.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText("Next creator");
  await page
    .getByRole("button", { name: nextProject.name, exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Browser recovery drafts" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  expect(
    (await request.post("/api/auth/sign-out", { data: {} })).ok(),
  ).toBeTruthy();
  expect(
    (await request.post("/api/auth/sign-in/email", { data: original })).ok(),
  ).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: firstProject.name, exact: true })
    .click();
  const recovery = page.getByRole("region", {
    name: "Browser recovery drafts",
  });
  await expect(
    recovery.getByRole("heading", {
      name: "Only the original creator's draft",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  await recovery
    .getByRole("button", { name: "Recover draft", exact: true })
    .click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect(
    (await (await request.get(`/api/projects/${firstProject.id}`)).json())
      .timeline.scenes[0].title,
  ).toBe("Only the original creator's draft");
});

test("stale Trash cannot delete after an account switch or clear its browser copies", async ({
  page,
  request,
}) => {
  await account(request, "Trash original");
  const session = await (await request.get("/api/auth/get-session")).json();
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Original trash story",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await request.delete(`/api/projects/${p.id}/trash`);
  await page.goto("/trash");
  await page.evaluate(
    ({ userId, project }) => {
      const id = crypto.randomUUID();
      localStorage.setItem(
        `reelchemy:browser-draft:v1:${encodeURIComponent(userId)}:${project.id}:${id}`,
        JSON.stringify({
          version: 1,
          id,
          userId,
          projectId: project.id,
          timeline: project.timeline,
          baseRevisionId: project.revisions.at(-1)?.id ?? null,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    { userId: session.user.id, project: p },
  );
  await page
    .getByRole("button", { name: `Permanently delete ${p.name}`, exact: true })
    .click();
  await account(request, "Trash next");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Confirm permanent project deletion").fill("DELETE");
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "The account in this browser changed.",
  );
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("reelchemy:browser-draft:v1:"),
        ).length,
    ),
  ).toBe(1);
  expect(
    (await (await request.get("/api/workspace/deletions")).json()).total,
  ).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Reload studio", exact: true })
    .click();
  await expect(
    page.getByText("Trash is empty.", { exact: true }),
  ).toBeVisible();
});

test("an expired session leaves unsaved work downloadable and does not silently sign out a different account", async ({
  page,
  request,
}) => {
  await account(request, "Expiring creator");
  await page.goto("/");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await holdDraft(page, "Keep this after session expiry");
  await page.unroute("**/api/projects/*");
  expect(
    (await request.post("/api/auth/sign-out", { data: {} })).ok(),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Your session ended." }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download unsaved draft", exact: true })
    .click();
  expect((await download).suggestedFilename()).toContain("reelchemy-draft-");
  await account(request, "Replacement creator");
  const replacement = await (await request.get("/api/auth/get-session")).json();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  expect(
    (await (await request.get("/api/auth/get-session")).json()).user.id,
  ).toBe(replacement.user.id);
  page.once("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Reload studio", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start from a blank canvas" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Browser recovery drafts" }),
  ).toHaveCount(0);
});
