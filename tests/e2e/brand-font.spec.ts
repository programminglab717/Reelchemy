import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

test("an uploaded brand font previews, applies to scene text and reaches the export", async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const require = createRequire(import.meta.url);
  const font = await readFile(
    path.join(
      path.dirname(require.resolve("next/package.json")),
      "dist/next-devtools/server/font/geist-mono-latin.woff2",
    ),
  );
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Brand font studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  p.timeline.scenes[0].layers[0].height = 0.5;
  await request.patch(`/api/projects/${p.id}`, {
    data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Brand font studio", exact: false })
    .click();
  // A disguised file is refused without creating an asset.
  const fontForm = page
    .locator("form")
    .filter({ has: page.getByLabel("Upload font", { exact: true }) });
  await page.getByLabel("Upload font", { exact: true }).setInputFiles({
    name: "logo.woff2",
    mimeType: "font/woff2",
    buffer: Buffer.from("definitely not a font file"),
  });
  await fontForm.locator('input[name="license"]').fill("OFL 1.1");
  await fontForm
    .getByRole("button", { name: "Upload brand font", exact: true })
    .click();
  await expect(page.getByRole("alert").first()).toBeVisible({
    timeout: 60000,
  });
  await page.getByLabel("Upload font", { exact: true }).setInputFiles({
    name: "Geist Mono.woff2",
    mimeType: "font/woff2",
    buffer: font,
  });
  await fontForm.locator('input[name="license"]').fill("OFL 1.1");
  await fontForm
    .getByRole("button", { name: "Upload brand font", exact: true })
    .click();
  await expect(page.getByLabel("Geist Mono preview")).toHaveText(
    "Aa Bb Cc 123",
    { timeout: 60000 },
  );
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(saved.assets).toHaveLength(1);
  const asset = saved.assets[0];
  expect(asset).toMatchObject({ mime: "font/woff2", name: "Geist Mono" });
  await page
    .getByRole("button", { name: "Use for text in selected scene" })
    .click();
  await expect(
    page.getByLabel("Canvas title brand font", { exact: true }),
  ).toHaveValue(asset.id);
  const title = page
    .locator(".player-wrap")
    .getByText(saved.timeline.scenes[0].layers[0].text, { exact: true });
  await expect(title).toHaveCSS(
    "font-family",
    new RegExp(`reelchemy-font-${asset.id}`),
  );
  await expect
    .poll(() =>
      page.evaluate(
        (family) => document.fonts.check(`16px "${family}"`),
        `reelchemy-font-${asset.id}`,
      ),
    )
    .toBe(true);
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const job = (
    await (await request.get(`/api/projects/${p.id}/render`)).json()
  )[0];
  expect(job.report.timeline.scenes[0].layers[0].fontAssetId).toBe(asset.id);
});
