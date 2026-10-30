import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// Keep real abuse controls enabled. Fast suites can share a source IP and
// legitimately exhaust signup/sign-in windows; honor Retry-After, never bypass it.
async function authPost(
  request: APIRequestContext,
  url: string,
  options: Parameters<APIRequestContext["post"]>[1],
) {
  for (let attempt = 0; ; attempt++) {
    const response = await request.post(url, options);
    if (response.status() !== 429 || attempt >= 2) return response;
    const retryAfter = Number(response.headers()["retry-after"] || 60);
    await new Promise((resolve) =>
      setTimeout(resolve, (Math.max(1, Math.min(65, retryAfter)) + 1) * 1000),
    );
  }
}
export async function account(request: APIRequestContext, label = "Creator") {
  const email = `${label.toLowerCase().replace(/[^a-z]/g, "")}-${crypto.randomUUID()}@example.test`,
    password = "Test-only-passphrase-4826";
  const headers = {
    origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
  };
  const response = await authPost(request, "/api/auth/sign-up/email", {
    headers,
    data: { name: label, email, password, callbackURL: "/" },
  });
  if (!response.ok()) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Test signup returned HTTP ${response.status()} (${error.code || "unknown error"}).`,
    );
  }
  const url = await mailLink(email, "Verify");
  const verification = await request.get(url);
  expect(verification.ok()).toBeTruthy();
  const login = await authPost(request, "/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  return { email, password };
}
export async function mailLink(email: string, subject: string) {
  const dir = path.resolve(
    process.env.REELCHEMY_AUTH_DIR || process.env.REELCHEMY_DATA_DIR || ".data",
    "mail",
  );
  for (let attempt = 0; attempt < 40; attempt++) {
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {}
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const message = JSON.parse(await readFile(path.join(dir, file), "utf8"));
      if (message.to === email && message.subject.includes(subject)) {
        const url = message.text.match(/https?:\/\/\S+/)?.[0];
        if (url) return url;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    "Expected test email was not delivered to the private development mailbox.",
  );
}
export const browserTest = base.extend({
  request: async ({ context }, runFixture) => {
    await context.setExtraHTTPHeaders({
      origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    });
    await runFixture(context.request);
  },
});
export const test = browserTest.extend<{ signedIn: void }>({
  signedIn: [
    async ({ request }, runFixture) => {
      await account(request);
      await runFixture();
    },
    { auto: true },
  ],
});
export { expect };
