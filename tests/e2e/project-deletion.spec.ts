import { test, expect, account } from "./fixtures";
import sharp from "sharp";
import type { APIRequestContext } from "@playwright/test";
import type { Project } from "../../src/lib/schema";

async function project(request: APIRequestContext, prompt: string) {
  const response = await request.post("/api/projects", {
    data: { prompt, blank: true, duration: 5, format: "landscape" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Project;
}
async function upload(request: APIRequestContext, id: string) {
  const response = await request.post(`/api/projects/${id}/assets`, {
    multipart: {
      license: "Generated private test fixture",
      file: {
        name: "private.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 64, height: 64, channels: 3, background: "#00b6a3" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Project;
}
test("typed permanent removal reclaims storage, preserves other projects and clears only its browser copies", async ({
  page,
  request,
  browser,
}) => {
  let removing = await project(request, "Permanently remove this story");
  removing = await upload(request, removing.id);
  let keeping = await project(request, "Keep this story");
  keeping = await upload(request, keeping.id);
  const keptBytes = await (
    await request.get(
      `/api/projects/${keeping.id}/assets/${keeping.assets![0].id}`,
    )
  ).body();
  const before = await (await request.get("/api/workspace/storage")).json();
  expect(
    (await request.delete(`/api/projects/${removing.id}/trash`)).ok(),
  ).toBeTruthy();
  await page.goto("/trash");
  const session = await (await request.get("/api/auth/get-session")).json();
  await page.evaluate(
    ({ userId, projects }) => {
      for (const p of projects) {
        const id = crypto.randomUUID();
        const timeline = structuredClone(p.timeline!);
        timeline.scenes[0].title =
          p.id === projects[0].id
            ? "Delete this browser copy"
            : "Keep this local draft";
        localStorage.setItem(
          `reelchemy:browser-draft:v1:${encodeURIComponent(userId)}:${p.id}:${id}`,
          JSON.stringify({
            version: 1,
            id,
            userId,
            projectId: p.id,
            baseRevisionId: p.revisions.at(-1)?.id ?? null,
            updatedAt: new Date().toISOString(),
            timeline,
          }),
        );
      }
    },
    { userId: session.user.id, projects: [removing, keeping] },
  );
  const open = page.getByRole("button", {
    name: `Permanently delete ${removing.name}`,
    exact: true,
  });
  await open.click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Confirm permanent project deletion").fill("delete");
  await expect(
    dialog.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await request.get(`/api/projects/${removing.id}/deletion`)).status(),
  ).toBe(404);
  expect(
    (await (await request.get("/api/workspace/storage")).json()).usedBytes,
  ).toBe(before.usedBytes);
  const outsider = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    await account(outsider.request, "Outside deletion");
    expect(
      (
        await outsider.request.post(`/api/projects/${removing.id}/deletion`, {
          data: { confirmation: "DELETE" },
        })
      ).status(),
    ).toBe(404);
    expect(
      (await (await outsider.request.get("/api/workspace/deletions")).json())
        .total,
    ).toBe(0);
  } finally {
    await outsider.close();
  }
  await open.click();
  dialog = page.getByRole("dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel("Confirm permanent project deletion").fill("DELETE");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/projects/${removing.id}/deletion`)
          ).json()
        ).state,
    )
    .toBe("completed");
  expect((await request.get(`/api/projects/${removing.id}`)).status()).toBe(
    404,
  );
  expect(
    (await request.post(`/api/projects/${removing.id}/trash`)).status(),
  ).toBe(404);
  expect(
    (await (await request.get("/api/workspace/storage")).json()).usedBytes,
  ).toBe(keeping.assets![0].bytes);
  expect(
    await (
      await request.get(
        `/api/projects/${keeping.id}/assets/${keeping.assets![0].id}`,
      )
    ).body(),
  ).toEqual(keptBytes);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("reelchemy:browser-draft:v1:"),
        ).length,
    ),
  ).toBe(1);
  await page
    .getByRole("link", { name: "← Back to studio", exact: true })
    .click();
  await page.getByRole("button", { name: keeping.name, exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Browser recovery drafts" })
      .getByRole("heading", { name: "Keep this local draft" }),
  ).toBeVisible();
});

test("an uncertain removal response can be safely retried from the open confirmation dialog", async ({
  page,
  request,
}) => {
  const p = await project(request, "Retry this removal");
  await request.delete(`/api/projects/${p.id}/trash`);
  await page.goto("/trash");
  let first = true;
  let requestedAt = "";
  await page.route(`**/api/projects/${p.id}/deletion`, async (route) => {
    if (route.request().method() === "POST" && first) {
      first = false;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      requestedAt = (await response.json()).requestedAt;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic response loss; retry is safe",
        }),
      });
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: `Permanently delete ${p.name}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Confirm permanent project deletion").fill("DELETE");
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Synthetic response loss; retry is safe",
  );
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/projects/${p.id}/deletion`)).json())
          .state,
    )
    .toBe("completed");
  expect(
    (await (await request.get(`/api/projects/${p.id}/deletion`)).json())
      .requestedAt,
  ).toBe(requestedAt);
});

test("unavailable removal status offers recovery while ordinary Trash restore stays usable", async ({
  page,
  request,
}) => {
  const p = await project(request, "Restore during status outage");
  await request.delete(`/api/projects/${p.id}/trash`);
  await page.route("**/api/workspace/deletions*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic cleanup status outage" }),
    }),
  );
  await page.goto("/trash");
  const status = page.getByRole("region", { name: "Project removals" });
  await expect(status.getByRole("alert")).toContainText(
    "Synthetic cleanup status outage",
  );
  await page
    .getByRole("button", { name: `Restore ${p.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: p.name, exact: true }),
  ).toHaveCount(0);
  expect((await request.get(`/api/projects/${p.id}`)).ok()).toBeTruthy();
  await page.unroute("**/api/workspace/deletions*");
  await status
    .getByRole("button", { name: "Refresh removals", exact: true })
    .click();
  await expect(
    status.getByRole("status", { name: "Project removal status" }),
  ).toHaveText("No pending project removals.");
});
