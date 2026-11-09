import { test, expect, openTool } from "./fixtures";
import { zipSync, strToU8 } from "fflate";
import sharp from "sharp";
import type { Project } from "../../src/lib/schema";

test("upload completion refreshes only media while a 400-version project keeps its unsaved timeline", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Large history upload",
      blank: true,
      duration: 5,
      format: "landscape",
    },
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as Project;
  const history = structuredClone(source.timeline!);
  history.scenes[0].layers = Array.from({ length: 20 }, (_, index) => ({
    ...history.scenes[0].layers[0],
    id: `retained-${index}`,
    text: "Retained private history ".repeat(5),
  }));
  source.revisions = Array.from({ length: 400 }, (_, index) => ({
    id: `retained-revision-${index}`,
    createdAt: new Date().toISOString(),
    source: "Simulated retained edit",
    timeline: index === 399 ? source.timeline! : history,
  }));
  const manifest = JSON.stringify({
    format: "reelchemy",
    version: 1,
    project: source,
  });
  expect(Buffer.byteLength(manifest)).toBeGreaterThan(1024 * 1024);
  const imported = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: Buffer.from(zipSync({ "project.json": strToU8(manifest) })),
  });
  expect(imported.status()).toBe(201);
  const target = (await imported.json()) as Project;
  expect(target.revisions).toHaveLength(400);
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  await page.route(`**/api/projects/${target.id}`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error:
          route.request().method() === "PATCH"
            ? "Synthetic save outage in a large project"
            : "Unexpected full-history refresh during upload",
      }),
    });
  });
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this unsaved large-project edit");
  await expect(
    page.getByText("Synthetic save outage in a large project", { exact: true }),
  ).toBeVisible();
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Upload image", { exact: true }) });
  await openTool(page, "Media & voice");
  await form.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "Compact result.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 48, height: 24, channels: 3, background: "#eab33c" },
    })
      .png()
      .toBuffer(),
  });
  await form
    .locator('[name="license"]')
    .fill("Generated private catalogue fixture");
  const received = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${target.id}/assets`) &&
      response.request().method() === "GET",
  );
  await form.getByRole("button", { name: "Upload asset", exact: true }).click();
  const response = await received;
  expect(response.status()).toBe(200);
  const bytes = await response.body(),
    catalogue = JSON.parse(bytes.toString());
  expect(bytes.length).toBeLessThan(4000);
  expect(Object.keys(catalogue).sort()).toEqual(["assets", "id"]);
  expect(catalogue.id).toBe(target.id);
  expect(catalogue.assets).toHaveLength(1);
  expect(bytes.toString()).not.toContain("Retained private history");
  await expect(
    page.getByAltText("Compact result.png", { exact: true }),
  ).toBeVisible();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep this unsaved large-project edit",
  );
  const saved = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  expect(saved.revisions).toHaveLength(400);
  expect(saved.timeline!.scenes[0].title).toBe("Scene 1");
  expect(saved.assets).toHaveLength(1);
  await page.unroute(`**/api/projects/${target.id}`);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const updated = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  expect(updated.revisions).toHaveLength(401);
  expect(updated.timeline!.scenes[0].title).toBe(
    "Keep this unsaved large-project edit",
  );
});
