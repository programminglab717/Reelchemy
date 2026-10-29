import { test, expect, account } from "./fixtures";
import sharp from "sharp";
test("Trash hides private routes/cancels jobs and restores the saved editor, media and revisions", async ({
  page,
  request,
  browser,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Recoverable story",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  const upload = await request.post(`/api/projects/${p.id}/assets`, {
    multipart: {
      license: "Owned test",
      file: {
        name: "logo.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#123456" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  const asset = (await upload.json()).assets[0];
  // Terminal exports survive; any export still active when trashed is cancelled.
  const job = await (await request.post(`/api/projects/${p.id}/render`)).json();
  await page.goto("/");
  await page
    .getByRole("button", { name: "Recoverable story", exact: false })
    .click();
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Saved before Trash");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Move project to Trash", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recoverable story", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Move project to Trash", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Start from a blank canvas",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/projects")).json()).some(
      (row: { id: string }) => row.id === p.id,
    ),
  ).toBeFalsy();
  for (const url of [
    `/api/projects/${p.id}`,
    `/api/projects/${p.id}/archive`,
    `/api/projects/${p.id}/render`,
    `/api/projects/${p.id}/assets/${asset.id}`,
    `/api/jobs/${job.id}`,
    `/api/jobs/${job.id}/download`,
    `/api/jobs/${job.id}/evidence/report.json`,
  ])
    expect((await request.get(url)).status()).toBe(404);
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(404);
  const outsider = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    await account(outsider.request, "Outside Trash");
    expect(
      (await outsider.request.post(`/api/projects/${p.id}/trash`)).status(),
    ).toBe(404);
    expect(
      await (await outsider.request.get("/api/projects?trashed=true")).json(),
    ).toEqual([]);
  } finally {
    await outsider.close();
  }
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);
  await page.getByLabel("Search Trash", { exact: true }).fill("Recoverable");
  await expect(
    page.getByRole("heading", { name: "Recoverable story", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Restore Recoverable story", exact: true })
    .click();
  await expect(
    page.getByText("0 projects in Trash", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "← Back to studio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recoverable story", exact: false })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Saved before Trash",
  );
  expect(
    (await request.get(`/api/projects/${p.id}/assets/${asset.id}`)).status(),
  ).toBe(200);
  const restored = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(restored.revisions.length).toBeGreaterThan(1);
  const status = (await (await request.get(`/api/jobs/${job.id}`)).json())
    .status;
  expect(["cancelled", "completed"]).toContain(status);
  if (status === "completed")
    expect((await request.get(`/api/jobs/${job.id}/download`)).status()).toBe(
      200,
    );
});

test("Trash list failures offer recovery and anonymous visits require sign-in", async ({
  page,
  browser,
}) => {
  await page.route(
    "**/api/projects?trashed=true**",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Temporary Trash outage" }),
      }),
    { times: 1 },
  );
  await page.goto("/trash");
  await expect(page.getByRole("alert", { name: "Trash error" })).toContainText(
    "Temporary Trash outage",
  );
  await page.getByRole("button", { name: "Reload Trash", exact: true }).click();
  await expect(
    page.getByText("Trash is empty.", { exact: true }),
  ).toBeVisible();
  const anonymous = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    const response = await anonymous.request.get("/trash");
    expect(response.url()).toContain("/sign-in");
    expect(
      (await anonymous.request.get("/api/projects?trashed=true")).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
});
