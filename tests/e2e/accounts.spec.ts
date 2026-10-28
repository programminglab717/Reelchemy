import { browserTest as test, expect } from "./fixtures";
import sharp from "sharp";
import { account, mailLink } from "./fixtures";
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({
    origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
  });
});
test("verified accounts isolate all project, job, asset and download routes", async ({
  page,
  request,
  browser,
}) => {
  const guest = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    extraHTTPHeaders: {
      origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    },
  });
  expect((await guest.request.get("/api/projects")).status()).toBe(401);
  const alice = await account(request, "Alice");
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Private Alice project",
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await request.post(`/api/projects/${p.id}/plan`, { data: {} });
  const upload = await request.post(`/api/projects/${p.id}/assets`, {
    multipart: {
      file: {
        name: "private.png",
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 16, height: 16, channels: 3, background: "#345678" },
        })
          .png()
          .toBuffer(),
      },
      license: "Owned test asset",
    },
  });
  expect(upload.status()).toBe(201);
  const privateAssetId = (await upload.json()).assets[0].id;
  expect(
    (
      await request.get(`/api/projects/${p.id}/assets/${privateAssetId}`)
    ).status(),
  ).toBe(200);
  const job = await (await request.post(`/api/projects/${p.id}/render`)).json();
  await request.delete(`/api/jobs/${job.id}`);
  const bob = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    extraHTTPHeaders: {
      origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    },
  });
  await account(bob.request, "Bob");
  expect((await bob.request.get("/api/projects")).ok()).toBeTruthy();
  expect(
    (await (await bob.request.get("/api/projects")).json()).some(
      (x: { id: string }) => x.id === p.id,
    ),
  ).toBeFalsy();
  for (const url of [
    `/api/projects/${p.id}`,
    `/api/projects/${p.id}/render`,
    `/api/projects/${p.id}/archive`,
    `/api/projects/${p.id}/assets/${privateAssetId}`,
    `/api/jobs/${job.id}`,
    `/api/jobs/${job.id}/download`,
    `/api/jobs/${job.id}/thumbnail`,
    `/api/jobs/${job.id}/evidence/report.json`,
  ])
    expect((await bob.request.get(url)).status()).toBe(404);
  expect(
    (await bob.request.patch(`/api/projects/${p.id}`, { data: {} })).status(),
  ).toBe(404);
  expect(
    (
      await bob.request.post(`/api/projects/${p.id}/restore`, {
        data: { revisionId: "unknown" },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await bob.request.post(`/api/projects/${p.id}/plan`, {
        data: { revision: "Steal content" },
      })
    ).status(),
  ).toBe(404);
  expect((await bob.request.delete(`/api/jobs/${job.id}`)).status()).toBe(404);
  await page.goto("/");
  await expect(page.getByLabel("Video idea")).toBeEnabled({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: /Private Alice project/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await request.get("/api/projects")).status()).toBe(401);
  await page.getByLabel("Email address").fill(alice.email);
  await page.getByLabel("Password", { exact: true }).fill(alice.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  expect(
    (
      await request.post("/api/projects", {
        headers: { origin: "https://untrusted.example" },
        data: { prompt: "Blocked", duration: 5, format: "landscape" },
      })
    ).status(),
  ).toBe(400);
  await bob.close();
  await guest.close();
});
test("unverified login is denied and password reset revokes existing sessions", async ({
  request,
  browser,
}) => {
  const email = `unverified-${crypto.randomUUID()}@example.test`;
  const password = "Test-only-passphrase-4826";
  await request.post("/api/auth/sign-up/email", {
    data: { name: "Unverified", email, password },
  });
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: { email, password },
      })
    ).status(),
  ).toBe(403);
  const user = await account(request, "Reset");
  const other = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    extraHTTPHeaders: {
      origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    },
  });
  await other.request.post("/api/auth/sign-in/email", {
    data: { email: user.email, password: user.password },
  });
  await request.post("/api/auth/request-password-reset", {
    data: { email: user.email, redirectTo: "/sign-in" },
  });
  const link = new URL(await mailLink(user.email, "Reset"));
  const redirect = await request.get(link.toString(), { maxRedirects: 0 });
  const location = redirect.headers().location;
  const token = new URL(location, "http://127.0.0.1:3001").searchParams.get(
    "token",
  );
  expect(token).toBeTruthy();
  const newPassword = "Replacement-test-passphrase-7395";
  expect(
    (
      await request.post("/api/auth/reset-password", {
        data: { token, newPassword },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await other.request.get("/api/projects")).status()).toBe(401);
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: { email: user.email, password: user.password },
      })
    ).ok(),
  ).toBeFalsy();
  expect(
    (
      await request.post("/api/auth/sign-in/email", {
        data: { email: user.email, password: newPassword },
      })
    ).ok(),
  ).toBeTruthy();
  await other.close();
});
