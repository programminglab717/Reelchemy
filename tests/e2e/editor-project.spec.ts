import { test, expect, openTool } from "./fixtures";
import { zipSync, strToU8 } from "fflate";
import type { Project } from "../../src/lib/schema";
import {
  PROJECT_VIEW_HEADER,
  EDITOR_PROJECT_VIEW,
} from "../../src/lib/project-view";

test("a large editor transfers bounded summaries while earlier directions retry without losing an unsaved film", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Compact editing review",
      blank: true,
      duration: 5,
      format: "landscape",
    },
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as Project;
  const historical = structuredClone(source.timeline!);
  historical.scenes[0].layers = Array.from({ length: 20 }, (_, index) => ({
    ...historical.scenes[0].layers[0],
    id: `old-layer-${index}`,
    text: "PRIVATE_OLD_FRAME ".repeat(6),
  }));
  source.revisions = Array.from({ length: 600 }, (_, index) => ({
    id: `editor-version-${index}`,
    createdAt: source.createdAt,
    source: `Manual edit ${index + 1}`,
    timeline: index === 599 ? source.timeline! : historical,
  }));
  source.messages = Array.from({ length: 125 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `Saved direction ${index}`,
  }));
  source.messages[124].content += `\n${"LongUnbrokenDirection".repeat(100)}`;
  const manifest = JSON.stringify({
    format: "reelchemy",
    version: 3,
    requiredFeatures: ["large-history-v1"],
    project: source,
  });
  expect(Buffer.byteLength(manifest)).toBeGreaterThan(1024 * 1024);
  const importing = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: Buffer.from(zipSync({ "project.json": strToU8(manifest) })),
  });
  expect(importing.status()).toBe(201);
  const target = (await importing.json()) as Project;
  await page.goto("/");
  const opening = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${target.id}`) &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: target.name, exact: true }).click();
  const response = await opening;
  expect(response.request().headers()[PROJECT_VIEW_HEADER.toLowerCase()]).toBe(
    EDITOR_PROJECT_VIEW,
  );
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const bytes = await response.body();
  expect(bytes.length).toBeLessThan(20000);
  expect(bytes.toString()).not.toContain("PRIVATE_OLD_FRAME");
  const view = JSON.parse(bytes.toString());
  expect(view.revisionCount).toBe(600);
  expect(view.revisions).toHaveLength(20);
  expect(
    view.revisions.every((revision: object) => !("timeline" in revision)),
  ).toBe(true);
  expect(view.messageCount).toBe(125);
  expect(view.messages).toHaveLength(50);
  await expect(
    page.getByText("1 scenes · 5s · landscape · 600 saved versions", {
      exact: true,
    }),
  ).toBeVisible();
  await openTool(page, "Project");
  await expect(
    page
      .getByRole("combobox", { name: "Restore saved version", exact: true })
      .locator("option"),
  ).toHaveCount(22);
  await openTool(page, "Director");
  const conversation = page.getByRole("region", {
    name: "Creative conversation",
    exact: true,
  });
  await expect(
    conversation.getByText("Directions 76–125 of 125", { exact: true }),
  ).toBeVisible();
  await page.route(`**/api/projects/${target.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic compact save outage" }),
      });
    else await route.continue();
  });
  await openTool(page, "Scene & layers");
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this compact unsaved edit");
  await expect(
    page.getByText("Synthetic compact save outage", { exact: true }),
  ).toBeVisible();
  let fail = true;
  await page.route(
    `**/api/projects/${target.id}/conversation?**`,
    async (route) => {
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic earlier direction outage" }),
        });
      } else await route.continue();
    },
  );
  await openTool(page, "Director");
  await conversation
    .getByRole("button", { name: "Earlier directions", exact: true })
    .click();
  await expect(conversation.getByRole("alert")).toContainText(
    "Synthetic earlier direction outage",
  );
  await conversation
    .getByRole("button", { name: "Retry directions", exact: true })
    .click();
  await expect(
    conversation.getByText("Directions 26–75 of 125", { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByText("Saved direction 25", { exact: true }),
  ).toBeVisible();
  await conversation
    .getByRole("button", { name: "Earlier directions", exact: true })
    .click();
  await expect(
    conversation.getByText("Directions 1–25 of 125", { exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", {
      name: "Earlier directions",
      exact: true,
    }),
  ).toBeDisabled();
  await conversation
    .getByRole("button", { name: "Newer directions", exact: true })
    .click();
  await expect(
    conversation.getByText("Directions 26–75 of 125", { exact: true }),
  ).toBeVisible();
  await conversation
    .getByRole("button", { name: "Latest directions", exact: true })
    .click();
  await expect(
    conversation.getByText("Directions 76–125 of 125", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep this compact unsaved edit",
  );
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).revisions,
  ).toHaveLength(600);
  await page.unroute(`**/api/projects/${target.id}`);
  const saving = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${target.id}`) &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(200);
  const savedBytes = await saved.body();
  expect(savedBytes.length).toBeLessThan(20000);
  expect(JSON.parse(savedBytes.toString()).revisionCount).toBe(601);
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  const complete = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  expect(complete.revisions).toHaveLength(601);
  expect(complete.messages).toEqual(source.messages);
  expect(complete.revisions[0].timeline.scenes[0].layers[0].text).toContain(
    "PRIVATE_OLD_FRAME",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await conversation.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/compact-editor-mobile.png" });
});
