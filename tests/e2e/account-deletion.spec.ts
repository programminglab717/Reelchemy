import { browserTest as test, expect, account, authPost } from "./fixtures";
import type { APIRequestContext, Page } from "@playwright/test";
import { readFile, stat, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Project } from "../../src/lib/schema";
import {
  deletionReceiptSchema,
  type DeletionReceipt,
} from "../../src/lib/account-erasure-receipt";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
async function project(request: APIRequestContext, label: string) {
  const response = await request.post("/api/projects", {
    data: { prompt: label, blank: true, duration: 5, format: "landscape" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Project;
}
async function upload(request: APIRequestContext, p: Project) {
  const response = await request.post(`/api/projects/${p.id}/assets`, {
    multipart: {
      license: "Generated private deletion fixture",
      file: {
        name: "Original.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 32, height: 32, channels: 3, background: "#18a68a" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Project;
}
async function render(request: APIRequestContext, id: string) {
  const response = await request.post(`/api/projects/${id}/render`, {
    data: {},
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () => {
        const current = await (await request.get(`/api/jobs/${job.id}`)).json();
        if (current.status === "failed")
          throw new Error(current.error || "Fixture export failed.");
        return current.status;
      },
      { timeout: 180000 },
    )
    .toBe("completed");
  return job.id as string;
}
async function prepare(page: Page, output: string) {
  await page
    .getByRole("button", { name: "Prepare account deletion", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download deletion receipt", exact: true })
    .click();
  await (await download).saveAs(output);
  const receipt = deletionReceiptSchema.parse(
    JSON.parse(await readFile(output, "utf8")),
  );
  await page
    .getByRole("checkbox", {
      name: "I have saved my private deletion receipt.",
    })
    .check();
  await page
    .getByLabel("Type DELETE MY ACCOUNT to confirm")
    .fill("DELETE MY ACCOUNT");
  return receipt;
}
async function draft(page: Page, userId: string, p: Project) {
  const id = crypto.randomUUID(),
    value = JSON.stringify({
      version: 1,
      id,
      userId,
      projectId: p.id,
      baseRevisionId: p.revisions.at(-1)?.id ?? null,
      updatedAt: new Date().toISOString(),
      timeline: p.timeline,
    }),
    key = `reelchemy:browser-draft:v1:${encodeURIComponent(userId)}:${p.id}:${id}`;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key,
    value,
  });
  return { key, value };
}
async function complete(request: APIRequestContext, receipt: DeletionReceipt) {
  await expect
    .poll(
      async () => {
        const response = await request.post("/api/account/deletion", {
          headers: { origin },
          data: {
            action: "status",
            requestId: receipt.requestId,
            receipt: receipt.receipt,
          },
        });
        expect(response.status()).toBe(200);
        expect(response.headers()["set-cookie"]).toBeUndefined();
        return (await response.json()).state;
      },
      { timeout: 60000 },
    )
    .toBe("completed");
}
test("saved deletion receipt closes stale studio tabs, removes real media/MP4 and preserves another maker and browser copies", async ({
  page,
  request,
  browser,
  context,
}, info) => {
  const a = await account(request, "Erasing maker"),
    aSession = await (await request.get("/api/auth/get-session")).json();
  const other = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  try {
    await account(other.request, "Retained maker");
    const bSession = await (
      await other.request.get("/api/auth/get-session")
    ).json();
    const pa = await upload(
        request,
        await project(request, "Account removal film"),
      ),
      pb = await upload(
        other.request,
        await project(other.request, "Retained account film"),
      );
    const exported = await render(request, pa.id),
      assetA = pa.assets![0].id,
      assetB = pb.assets![0].id;
    const keptBytes = await (
      await other.request.get(`/api/projects/${pb.id}/assets/${assetB}`)
    ).body();
    await page.goto("/");
    const keptDraft = await draft(page, bSession.user.id, pb);
    const stale = await context.newPage();
    await stale.goto("/");
    await stale.getByRole("button", { name: pa.name, exact: true }).click();
    await stale.route(`**/api/projects/${pa.id}`, async (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic unsaved account draft" }),
          })
        : route.continue(),
    );
    await stale
      .getByLabel("Scene title", { exact: true })
      .fill("Erase this unsaved browser work");
    await expect(
      stale.getByText("Synthetic unsaved account draft", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account settings" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    const receiptPath = info.outputPath("private-deletion-receipt.json"),
      receipt = await prepare(page, receiptPath);
    await page
      .getByLabel("Current password", { exact: true })
      .fill("wrong-password");
    await page
      .getByRole("button", {
        name: "Permanently delete my account",
        exact: true,
      })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "password could not be verified",
    );
    expect(
      (await (await request.get("/api/auth/get-session")).json()).user.id,
    ).toBe(aSession.user.id);
    expect(
      await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      })),
    ).toEqual({ width: 390, scroll: 390 });
    for (const name of [
      "Download deletion receipt",
      "Permanently delete my account",
      "Check saved request",
    ]) {
      const button = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(button?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: info.outputPath("account-deletion-confirm-mobile.png"),
      fullPage: true,
    });
    await page.getByLabel("Current password", { exact: true }).fill(a.password);
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/account/deletion") &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.action === "confirm",
    );
    await page
      .getByRole("button", {
        name: "Permanently delete my account",
        exact: true,
      })
      .click();
    const confirmed = await accepted;
    expect(confirmed.status()).toBe(202);
    expect(confirmed.headers()["set-cookie"]).toBeUndefined();
    await expect(
      stale.getByText(
        "Account deletion was requested. This studio is closed.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(stale.getByLabel("Scene title", { exact: true })).toHaveCount(
      0,
    );
    await complete(other.request, receipt);
    await page
      .getByRole("button", { name: "Check progress", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account deleted", exact: true }),
    ).toBeVisible();
    const local = await page.evaluate(
      ({ aId, bKey }) => ({
        removed: Object.keys(localStorage).filter((key) =>
          key.startsWith(
            `reelchemy:browser-draft:v1:${encodeURIComponent(aId)}:`,
          ),
        ).length,
        kept: localStorage.getItem(bKey),
      }),
      { aId: aSession.user.id, bKey: keptDraft.key },
    );
    expect(local).toEqual({ removed: 0, kept: keptDraft.value });
    await expect(async () => {
      await expect(
        stat(path.join(process.env.REELCHEMY_DATA_DIR!, "assets", assetA)),
      ).rejects.toThrow();
      await expect(
        access(path.join(process.env.REELCHEMY_ARTIFACT_DIR!, exported)),
      ).rejects.toThrow();
    }).toPass();
    expect(
      await (
        await other.request.get(`/api/projects/${pb.id}/assets/${assetB}`)
      ).body(),
    ).toEqual(keptBytes);
    expect(
      (await (await other.request.get("/api/auth/get-session")).json()).user.id,
    ).toBe(bSession.user.id);
    const fresh = await render(other.request, pb.id);
    expect(
      (await other.request.get(`/api/jobs/${fresh}/download`)).status(),
    ).toBe(200);
    await page.screenshot({
      path: info.outputPath("account-deletion-complete-mobile.png"),
      fullPage: true,
    });
    await page.goto("/account/deletion");
    await page
      .getByLabel("Private deletion receipt", { exact: true })
      .setInputFiles(receiptPath);
    await expect(
      page.getByRole("heading", { name: "Account deleted", exact: true }),
    ).toBeVisible();
    expect(new URL(page.url()).search).toBe("");
    await page
      .getByRole("button", { name: "Choose another receipt", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Check account deletion",
        exact: true,
      }),
    ).toBeVisible();
    await stale.close();
  } finally {
    await other.close();
  }
});
test("a lost deletion reply recovers the same receipt after the browser signs in to another account without clearing that account", async ({
  page,
  request,
}, info) => {
  const next = await account(request, "Next signed in maker"),
    keptProject = await project(request, "Next account retained film");
  const a = await account(request, "Lost reply maker"),
    aSession = await (await request.get("/api/auth/get-session")).json(),
    pa = await project(request, "Lost reply old film");
  await page.goto("/account");
  const originalDraft = await draft(page, aSession.user.id, pa),
    receipt = await prepare(page, info.outputPath("lost-reply-receipt.json"));
  let nextId = "";
  await page.route("**/api/account/deletion", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== "confirm") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    const signIn = await authPost(request, "/api/auth/sign-in/email", {
      headers: { origin },
      data: { email: next.email, password: next.password },
    });
    expect(signIn.ok()).toBeTruthy();
    nextId = (await (await request.get("/api/auth/get-session")).json()).user
      .id;
    await route.abort("failed");
  });
  await page.getByLabel("Current password", { exact: true }).fill(a.password);
  await page
    .getByRole("button", { name: "Permanently delete my account", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Keep your receipt and check the saved request before retrying.",
  );
  expect(nextId).not.toBe(aSession.user.id);
  expect(keptProject).toBeDefined();
  const nextDraft = await draft(page, nextId, keptProject!);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), originalDraft.key),
  ).toBe(originalDraft.value);
  await page
    .getByRole("button", { name: "Check saved request", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate((key) => localStorage.getItem(key), originalDraft.key),
    )
    .toBeNull();
  await complete(request, receipt);
  await page
    .getByRole("button", { name: "Check progress", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Account deleted", exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/auth/get-session")).json()).user.id,
  ).toBe(nextId);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), nextDraft.key),
  ).toBe(nextDraft.value);
  expect((await request.get(`/api/projects/${keptProject!.id}`)).status()).toBe(
    200,
  );
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText("Next signed in maker");
});
test("public deletion receipt recovery rejects malformed or oversized files and stays within the mobile viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/account/deletion");
  const field = page.getByLabel("Private deletion receipt", { exact: true });
  await field.setInputFiles({
    name: "wrong.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"password":"must-not-be-displayed"}'),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "not a supported account-deletion receipt",
  );
  await field.setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(2049, 65),
  });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "small private account-deletion receipt",
  );
  await expect(
    page.getByText("must-not-be-displayed", { exact: false }),
  ).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    })),
  ).toEqual({ width: 390, scroll: 390 });
  await page.screenshot({
    path: info.outputPath("receipt-recovery-mobile.png"),
    fullPage: true,
  });
});
