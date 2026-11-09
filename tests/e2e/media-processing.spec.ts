import { test, expect, openTool } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import Database from "better-sqlite3";
import type { Project } from "../../src/lib/schema";
import { encodedFrame } from "./media-frame";

const evidence = process.env.REELCHEMY_ARTIFACT_DIR || "artifacts";
async function project(request: APIRequestContext, name: string) {
  const response = await request.post("/api/projects", {
    data: { prompt: name, blank: true, duration: 5, format: "landscape" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Project;
}
async function badge() {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: "#f4c44a" },
  })
    .png()
    .toBuffer();
}
async function open(page: Page, target: Project) {
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
}
async function fillImage(page: Page, name = "Queued badge.png") {
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("Upload image", { exact: true }) });
  await openTool(page, "Media & voice");
  await form
    .getByLabel("Upload image", { exact: true })
    .setInputFiles({ name, mimeType: "image/png", buffer: await badge() });
  await form
    .locator('[name="license"]')
    .fill("Generated private processing fixture");
  return form;
}
async function pausePrivateIngestion() {
  const root = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
  expect(
    root.startsWith("/tmp/reelchemy-e2e-") && path.basename(root) === "data",
  ).toBeTruthy();
  expect(await realpath(root)).toBe(root);
  const lock = JSON.parse(
    await readFile(path.join(root, "ingest.lock"), "utf8"),
  );
  expect(lock.kind).toBe("reelchemy-ingest-lock-v1");
  expect(Number.isInteger(lock.pid) && lock.pid > 1).toBeTruthy();
  async function owned() {
    try {
      const env = await readFile(`/proc/${lock.pid}/environ`, "utf8");
      const command = await readFile(`/proc/${lock.pid}/cmdline`, "utf8");
      return (
        env.split("\0").includes(`REELCHEMY_DATA_DIR=${root}`) &&
        command.includes("scripts/ingest-worker.ts")
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  expect(
    await owned(),
    "Only the disposable fixture's decoder process may be paused",
  ).toBeTruthy();
  // Pause only while this fixture holds the writer lock itself. The consumer
  // cannot be frozen halfway through a transaction that the web then needs.
  const database = new Database(path.join(root, "studio.sqlite"));
  database.pragma("busy_timeout = 5000");
  try {
    database.exec("BEGIN IMMEDIATE");
    expect(await owned()).toBeTruthy();
    process.kill(lock.pid, "SIGSTOP");
  } finally {
    if (database.inTransaction) database.exec("ROLLBACK");
    database.close();
  }
  return async () => {
    if (await owned()) process.kill(lock.pid, "SIGCONT");
  };
}

test("a lost asynchronous upload response retries one attachment, preserves edits and exports actual image pixels", async ({
  page,
  request,
}) => {
  const target = await project(request, "Recover an uncertain image upload");
  await open(page, target);
  await page.route(`**/api/projects/${target.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic save outage during processing",
        }),
      });
    else await route.continue();
  });
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this draft while preparing media");
  await expect(
    page.getByText("Synthetic save outage during processing", { exact: true }),
  ).toBeVisible();
  const keys: string[] = [];
  let first = true;
  await page.route(`**/api/projects/${target.id}/assets`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    if (first) {
      first = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic response lost after upload admission",
        }),
      });
    } else await route.fulfill({ response });
  });
  const form = await fillImage(page);
  await openTool(page, "Media & voice");
  await form.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByText("Synthetic response lost after upload admission", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await form
      .getByLabel("Upload image", { exact: true })
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("Queued badge.png");
  await form.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByAltText("Queued badge.png", { exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).assets,
  ).toHaveLength(1);
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep this draft while preparing media",
  );
  await page.unroute(`**/api/projects/${target.id}`);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await openTool(page, "Media & voice");
  await page
    .getByRole("button", { name: "Add to selected scene", exact: true })
    .click();
  await openTool(page, "Design");
  await page
    .getByRole("button", { name: "Hide layer title", exact: true })
    .click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const [job] = await (
    await request.get(`/api/projects/${target.id}/render`)
  ).json();
  const frame = await encodedFrame(request, job.id, 2.5);
  const pixel =
    (Math.floor(frame.height * 0.675) * frame.width +
      Math.floor(frame.width * 0.5)) *
    3;
  expect(frame.data[pixel]).toBeGreaterThan(220);
  expect(frame.data[pixel + 1]).toBeGreaterThan(160);
  expect(frame.data[pixel + 2]).toBeLessThan(130);
});

test("a failed archive response keeps the chosen file and Retry import recovers exactly one project", async ({
  page,
  request,
}) => {
  const source = await project(request, "One retained background import");
  const archive = await request.get(`/api/projects/${source.id}/archive`);
  expect(archive.status()).toBe(200);
  const keys: string[] = [];
  let first = true;
  await page.route("**/api/projects/import", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    if (first) {
      first = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic interrupted import response",
        }),
      });
    } else await route.fulfill({ response });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Import project archive").setInputFiles({
    name: "Retained project.zip",
    mimeType: "application/zip",
    buffer: await archive.body(),
  });
  await expect(
    page.getByText("Synthetic interrupted import response", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByLabel("Import project archive")
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("Retained project.zip");
  await page.getByRole("button", { name: "Retry import", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `${source.name} (imported)`,
      exact: true,
    }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  const receipts = (
    await (await request.get("/api/workspace/media-requests")).json()
  ).requests;
  expect(
    receipts.filter(
      (item: { operation: string }) => item.operation === "import",
    ),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});

test("processing survives refresh, can be cancelled from the mobile queue, and a later upload succeeds", async ({
  page,
  request,
}) => {
  const target = await project(
    request,
    "Cancel a durable upload after refresh",
  );
  await open(page, target);
  const resume = await pausePrivateIngestion();
  let id = "";
  try {
    const form = await fillImage(page, "Cancelled badge.png");
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${target.id}/assets`) &&
        response.request().method() === "POST",
    );
    await openTool(page, "Media & voice");
    await form
      .getByRole("button", { name: "Upload asset", exact: true })
      .click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    id = (await response.json()).request.id;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const panel = page.getByRole("region", {
      name: "Media processing",
      exact: true,
    });
    const row = panel.locator(`[data-media-request="${id}"]`);
    await openTool(page, "Media & voice");
    await expect(row).toContainText("Waiting to prepare");
    await openTool(page, "Media & voice");
    await row
      .getByRole("button", { name: "Cancel media processing", exact: true })
      .click();
    await expect(row).toContainText("Cancelling");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(evidence, "media-processing-mobile-cancel.png"),
    });
  } finally {
    await resume();
  }
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/media-requests/${id}`)).json()).request
          .state,
    )
    .toBe("cancelled");
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).assets ||
      [],
  ).toHaveLength(0);
  await page.getByRole("button", { name: target.name, exact: true }).click();
  const next = await fillImage(page, "After cancellation.png");
  await next.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByAltText("After cancellation.png", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).assets,
  ).toHaveLength(1);
});

test("a background upload finishes after leaving its form and reopens its project from the retained receipt", async ({
  page,
  request,
}) => {
  const target = await project(request, "Open a completed background upload");
  await open(page, target);
  const resume = await pausePrivateIngestion();
  let id = "";
  try {
    const form = await fillImage(page, "Background badge.png");
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${target.id}/assets`) &&
        response.request().method() === "POST",
    );
    await openTool(page, "Media & voice");
    await form
      .getByRole("button", { name: "Upload asset", exact: true })
      .click();
    id = (await (await accepted).json()).request.id;
    await page.reload();
    await openTool(page, "Media & voice");
    await expect(
      page
        .getByRole("region", { name: "Media processing", exact: true })
        .locator(`[data-media-request="${id}"]`),
    ).toContainText("Waiting to prepare");
  } finally {
    await resume();
  }
  const panel = page.getByRole("region", {
    name: "Media processing",
    exact: true,
  });
  const row = panel.locator(`[data-media-request="${id}"]`);
  await expect(row).toContainText("Added to project");
  await row
    .getByRole("button", { name: "Open media project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: target.name, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByAltText("Background badge.png", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).assets,
  ).toHaveLength(1);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(evidence, "media-processing-desktop-recovered.png"),
  });
});
