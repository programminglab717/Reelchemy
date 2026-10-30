import { test, expect, account } from "./fixtures";
import sharp from "sharp";
test("private media allowance refreshes after uploads/imports and a failed check can be retried on mobile", async ({
  page,
  request,
  browser,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Media allowance studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  let unavailable = true;
  await page.route("**/api/workspace/storage", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary media allowance outage" }),
        })
      : route.continue(),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Media allowance studio", exact: false })
    .click();
  await expect(
    page.getByRole("alert", { name: "Media storage error" }),
  ).toContainText("Temporary media allowance outage");
  unavailable = false;
  await page.getByRole("button", { name: "Refresh media storage" }).click();
  await expect(
    page.getByRole("status", { name: "Media storage usage" }),
  ).toContainText("0 B of 512.0 MB");
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "allowance.png",
    mimeType: "image/png",
    buffer: png,
  });
  const imageForm = page
    .locator("form")
    .filter({ has: page.getByLabel("Upload image", { exact: true }) });
  await imageForm.locator('input[name="license"]').fill("Owned test media");
  await imageForm
    .getByRole("button", { name: "Upload asset", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Media storage usage" }),
  ).toContainText("1 file");
  const saved = await (await request.get(`/api/projects/${project.id}`)).json();
  const first = saved.assets[0];
  expect(first.bytes).toBe(
    (
      await (
        await request.get(`/api/projects/${project.id}/assets/${first.id}`)
      ).body()
    ).length,
  );
  await expect(
    page.getByRole("progressbar", { name: "Uploaded media allowance" }),
  ).toHaveAttribute("value", String(first.bytes));
  const zip = await (
    await request.get(`/api/projects/${project.id}/archive`)
  ).body();
  const imported = await request.post("/api/projects/import", {
    data: zip,
    headers: { "content-type": "application/zip" },
  });
  expect(imported.status()).toBe(201);
  const copy = await imported.json();
  await page.getByRole("button", { name: "Refresh media storage" }).click();
  await expect(
    page.getByRole("progressbar", { name: "Uploaded media allowance" }),
  ).toHaveAttribute("value", String(first.bytes + copy.assets[0].bytes));
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  const other = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    await account(other.request, "Other allowance");
    const own = await other.request.get(
      `/api/workspace/storage?workspaceId=${project.id}`,
    );
    expect(own.status()).toBe(200);
    expect((await own.json()).usedBytes).toBe(0);
    expect(
      (await (await request.get("/api/workspace/storage")).json()).usedBytes,
    ).toBe(first.bytes + copy.assets[0].bytes);
  } finally {
    await other.close();
  }
});
