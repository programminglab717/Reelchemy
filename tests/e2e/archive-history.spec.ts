import { test, expect, openTool } from "./fixtures";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import type { Project } from "../../src/lib/schema";
import { ACCOUNT_HEADER } from "../../src/lib/account-session";

test("large-history editable ZIP errors and cancellation recover without downloads or lost versions, then import preserves media", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/projects", {
    data: {
      prompt: "Long archive review",
      blank: true,
      duration: 5,
      format: "landscape",
    },
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as Project;
  const upload = await request.post(`/api/projects/${source.id}/assets`, {
    multipart: {
      file: {
        name: "Portable-artwork.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 32, height: 24, channels: 3, background: "#27b4a9" },
        })
          .png()
          .toBuffer(),
      },
      license: "Synthetic archive artwork owned by this test",
    },
  });
  expect(upload.status()).toBe(201);
  source.assets = (await upload.json()).assets;
  source.timeline!.scenes[0].layers.push({
    ...source.timeline!.scenes[0].layers[0],
    id: "archive-picture",
    kind: "image",
    text: "",
    assetId: source.assets![0].id,
    x: 0.1,
    y: 0.1,
    width: 0.25,
    height: 0.25,
    rotation: 35,
  });
  source.revisions = Array.from({ length: 501 }, (_, index) => ({
    id: `archive-edit-${index}`,
    createdAt: source.createdAt,
    source: `Retained cut ${index + 1}`,
    timeline: structuredClone(source.timeline!),
  }));
  source.messages = Array.from({ length: 1001 }, (_, index) => ({
    role: "user",
    content: `Retained direction ${index + 1}`,
  }));
  const manifest = {
    format: "reelchemy",
    version: 3,
    requiredFeatures: ["large-history-v1", "layer-rotation-v1"],
    project: source,
  };
  const assetBytes = await (
    await request.get(
      `/api/projects/${source.id}/assets/${source.assets![0].id}`,
    )
  ).body();
  const imported = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/zip" },
    data: Buffer.from(
      zipSync({
        "project.json": strToU8(JSON.stringify(manifest)),
        [`assets/${source.assets![0].id}`]: assetBytes,
      }),
    ),
  });
  expect(imported.status()).toBe(201);
  const target = (await imported.json()) as Project;
  const before = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  const button = page.getByRole("button", {
    name: "Download editable project",
    exact: true,
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  let attempt = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/projects/${target.id}/archive`, async (route) => {
    expect(
      route.request().headers()[ACCOUNT_HEADER.toLowerCase()],
    ).toBeTruthy();
    attempt++;
    if (attempt === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic archive recovery required" }),
      });
    else if (attempt === 2) {
      await held;
      await route.continue().catch(() => {});
    } else await route.continue();
  });
  await openTool(page, "Project");
  await button.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic archive recovery required" }),
  ).toBeVisible();
  expect(downloads).toBe(0);
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toBeEnabled();
  await openTool(page, "Project");
  await button.click();
  await expect(
    page.getByText("Preparing your saved project. You can keep editing.", {
      exact: true,
    }),
  ).toBeVisible();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toBeEnabled();
  await page
    .getByRole("button", { name: "Cancel download", exact: true })
    .click();
  await expect(button).toBeEnabled();
  release!();
  expect(downloads).toBe(0);
  expect(
    await (await request.get(`/api/projects/${target.id}`)).json(),
  ).toEqual(before);
  const receiving = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/projects/${target.id}/archive`) &&
      response.status() === 200,
  );
  const downloading = page.waitForEvent("download");
  await openTool(page, "Project");
  await button.click();
  const response = await receiving;
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`reelchemy-${target.id}.zip`);
  const file = await download.path();
  expect(file).toBeTruthy();
  const files = unzipSync(await readFile(file!));
  const envelope = JSON.parse(strFromU8(files["project.json"]));
  expect(envelope.version).toBe(3);
  expect(envelope.requiredFeatures).toEqual([
    "large-history-v1",
    "layer-rotation-v1",
  ]);
  expect(envelope.project.revisions).toEqual(before.revisions);
  expect(envelope.project.messages).toEqual(before.messages);
  expect(files[`assets/${target.assets![0].id}`]).toBeTruthy();
  expect(
    (await sharp(files[`assets/${target.assets![0].id}`]).metadata()).width,
  ).toBe(32);
  await page.screenshot({ path: "artifacts/portable-history-download.png" });
  await page.getByRole("button", { name: "← Studio", exact: true }).click();
  await page
    .getByLabel("Import project archive", { exact: true })
    .setInputFiles(file!);
  const importedName = `${target.name} (imported)`;
  await expect(
    page.getByRole("heading", { name: importedName, exact: true }),
  ).toBeVisible();
  const list = (await (await request.get("/api/projects")).json()) as Project[];
  const restored = list.find((project) => project.name === importedName)!;
  expect(restored.id).not.toBe(target.id);
  const complete = (await (
    await request.get(`/api/projects/${restored.id}`)
  ).json()) as Project;
  expect(complete.revisions).toHaveLength(501);
  expect(complete.messages).toEqual(before.messages);
  expect(complete.assets).toHaveLength(1);
  expect(complete.assets![0].id).not.toBe(target.assets![0].id);
  expect(complete.timeline!.scenes[0].layers[1].assetId).toBe(
    complete.assets![0].id,
  );
  expect(complete.timeline!.scenes[0].layers[1].rotation).toBe(35);
  expect(
    await (await request.get(`/api/projects/${target.id}`)).json(),
  ).toEqual(before);
  expect(downloads).toBe(1);
});
