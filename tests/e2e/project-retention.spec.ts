import { test, expect, openTool } from "./fixtures";
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import type { Project } from "../../src/lib/schema";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
async function archive(source: Project, count: number, messages = 24) {
  const historical = {
    ...structuredClone(source.timeline!),
    scenes: source.timeline!.scenes.map((scene) => ({ ...scene, layers: [] })),
  };
  return Buffer.from(
    zipSync({
      "project.json": strToU8(
        JSON.stringify({
          format: "reelchemy",
          version: 3,
          requiredFeatures: ["large-history-v1"],
          project: {
            ...source,
            revisions: Array.from({ length: count }, (_, i) => ({
              id: `retention-version-${i}`,
              source: "Saved edit",
              createdAt: source.createdAt,
              timeline: i === count - 1 ? source.timeline : historical,
            })),
            messages: Array.from({ length: messages }, (_, i) => ({
              role: i % 2 ? "assistant" : "user",
              content: `Saved retention direction ${i}`,
            })),
          },
        }),
      ),
    }),
  );
}
test("reviewed history cleanup rejects a stale preview, retries a lost response exactly once, and preserves unsaved film/undo on desktop and mobile", async ({
  page,
  request,
}) => {
  const source = (await (
    await request.post("/api/projects", {
      data: {
        prompt: "History cleanup review",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json()) as Project;
  const importing = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: await archive(source, 8),
  });
  expect(importing.status()).toBe(201);
  const target = (await importing.json()) as Project;
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  await page.route(`**/api/projects/${target.id}`, async (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic cleanup save outage" }),
        })
      : route.continue(),
  );
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Unsaved film stays with me");
  await expect(
    page.getByText("Synthetic cleanup save outage", { exact: true }),
  ).toBeVisible();
  await openTool(page, "Project");
  await page
    .getByRole("button", { name: "Manage saved history", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage saved history",
    exact: true,
  });
  await dialog.getByLabel("Saved versions to keep", { exact: true }).fill("2");
  await dialog.getByLabel("Directions to keep", { exact: true }).fill("3");
  await dialog
    .getByRole("button", { name: "Preview history cleanup", exact: true })
    .click();
  await expect(dialog.getByLabel("History cleanup preview")).toContainText(
    "Remove 6 earlier saved versions and 21 directions",
  );
  const renamed = await request.patch(`/api/projects/${target.id}/name`, {
    data: { name: "Changed after cleanup preview", baseName: target.name },
  });
  expect(renamed.ok()).toBe(true);
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Remove earlier history", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "changed after the preview",
  );
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).revisions,
  ).toHaveLength(8);
  await dialog
    .getByRole("button", { name: "Preview history cleanup", exact: true })
    .click();
  await dialog.getByRole("checkbox").check();
  const receipts: string[] = [];
  let lose = true;
  await page.route(`**/api/projects/${target.id}/retention`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    receipts.push(route.request().postDataJSON().requestId);
    if (lose) {
      lose = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog
    .getByRole("button", { name: "Remove earlier history", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same cleanup", exact: true }),
  ).toBeEnabled();
  const applied = await (
    await request.get(`/api/projects/${target.id}`)
  ).json();
  expect(applied.revisions).toHaveLength(2);
  expect(applied.messages).toHaveLength(3);
  expect(applied.timeline).toEqual(target.timeline);
  await dialog
    .getByRole("button", { name: "Retry same cleanup", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Removed 6 saved versions and 21 directions",
  );
  expect(receipts).toHaveLength(2);
  expect(receipts[1]).toBe(receipts[0]);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Unsaved film stays with me",
  );
  await openTool(page, "Project");
  await expect(
    page
      .getByRole("combobox", { name: "Restore saved version", exact: true })
      .locator("option"),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    target.timeline!.scenes[0].title,
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Unsaved film stays with me",
  );
  await page.unroute(`**/api/projects/${target.id}`);
  // Redo can schedule autosave before the button is clicked. The save shortcut
  // safely joins that same in-flight save or starts the explicit retry.
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  const saved = await (await request.get(`/api/projects/${target.id}`)).json();
  expect(saved.revisions).toHaveLength(3);
  expect(saved.messages).toHaveLength(3);
  expect(saved.timeline.scenes[0].title).toBe("Unsaved film stays with me");
  expect(
    (await (await request.get(`/api/projects/${source.id}`)).json()).revisions,
  ).toHaveLength(source.revisions.length);
  await page.setViewportSize({ width: 390, height: 844 });
  await openTool(page, "Project");
  await page
    .getByRole("button", { name: "Manage saved history", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Preview history cleanup",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `${process.env.REELCHEMY_ARTIFACT_DIR}/history-cleanup-mobile.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});
test("a full retained-version allowance preserves an unsaved film, frees reviewed history and saves/exports owned artwork without changing an earlier MP4", async ({
  page,
  request,
}) => {
  const source = (await (
    await request.post("/api/projects", {
      data: {
        prompt: "Full history recovery",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json()) as Project;
  const importing = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: await archive(source, 10000, 10),
  });
  expect(importing.status()).toBe(201);
  const target = (await importing.json()) as Project;
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 200000 });
  const first = (
      await (await request.get(`/api/projects/${target.id}/render`)).json()
    )[0],
    before = await (await request.get(`/api/jobs/${first.id}/download`)).body(),
    beforeHash = hash(before);
  await openTool(page, "Media & voice");
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "retained-owned.png",
    mimeType: "image/png",
    buffer: await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#2eb0a6" },
    })
      .png()
      .toBuffer(),
  });
  await page
    .getByPlaceholder("I own this image")
    .fill("Synthetic artwork owned by this fixture");
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByText("retained-owned.png", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Add to selected scene", exact: true })
    .click();
  await openTool(page, "Scene & layers");
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Save this artwork after cleanup");
  await expect(
    page.getByText(/This change exceeds the retained project allowance/),
  ).toBeVisible();
  const retained = await (
      await request.get(`/api/projects/${target.id}`)
    ).json(),
    asset = retained.assets[0],
    assetBytes = await (
      await request.get(`/api/projects/${target.id}/assets/${asset.id}`)
    ).body(),
    assetHash = hash(assetBytes);
  expect(retained.revisions).toHaveLength(10000);
  expect(retained.timeline.scenes[0].title).not.toBe(
    "Save this artwork after cleanup",
  );
  await openTool(page, "Project");
  await page
    .getByRole("button", { name: "Manage saved history", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Manage saved history",
    exact: true,
  });
  await dialog.getByLabel("Saved versions to keep", { exact: true }).fill("2");
  await dialog
    .getByRole("button", { name: "Preview history cleanup", exact: true })
    .click();
  await expect(dialog.getByLabel("History cleanup preview")).toContainText(
    "Remove 9998 earlier saved versions",
  );
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Remove earlier history", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Removed 9998 saved versions",
  );
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Save this artwork after cleanup",
  );
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  expect(
    hash(await (await request.get(`/api/jobs/${first.id}/download`)).body()),
  ).toBe(beforeHash);
  expect(
    hash(
      await (
        await request.get(`/api/projects/${target.id}/assets/${asset.id}`)
      ).body(),
    ),
  ).toBe(assetHash);
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 200000 });
  const jobs = await (
    await request.get(`/api/projects/${target.id}/render`)
  ).json();
  expect(jobs).toHaveLength(2);
  expect(jobs[0].status).toBe("completed");
  expect(jobs[1].id).toBe(first.id);
  const saved = await (await request.get(`/api/projects/${target.id}`)).json();
  expect(saved.revisions).toHaveLength(3);
  expect(
    saved.timeline.scenes[0].layers.some(
      (layer: { assetId?: string }) => layer.assetId === asset.id,
    ),
  ).toBe(true);
  const film = await (
    await request.get(`/api/jobs/${jobs[0].id}/download`)
  ).body();
  const png = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      "pipe:0",
      "-ss",
      "2",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ],
    { input: film, maxBuffer: 10 * 1024 ** 2, timeout: 30000 },
  );
  const layer = saved.timeline.scenes[0].layers.find(
    (item: { assetId?: string }) => item.assetId === asset.id,
  );
  const pixel = await sharp(png)
    .extract({
      left: Math.floor((layer.x + layer.width / 2) * 1280),
      top: Math.floor((layer.y + layer.height / 2) * 720),
      width: 1,
      height: 1,
    })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect(Math.abs(pixel[0] - 46)).toBeLessThan(15);
  expect(Math.abs(pixel[1] - 176)).toBeLessThan(15);
  expect(Math.abs(pixel[2] - 166)).toBeLessThan(15);
});
