import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
export async function account(request: APIRequestContext, label = "Creator") {
  const email = `${label.toLowerCase().replace(/[^a-z]/g, "")}-${crypto.randomUUID()}@example.test`,
    password = "Test-only-passphrase-4826";
  const headers = {
    origin: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
  };
  const response = await request.post("/api/auth/sign-up/email", {
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
  const login = await request.post("/api/auth/sign-in/email", {
    headers,
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  return { email, password };
}
export async function mailLink(email: string, subject: string) {
  const dir = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data", "mail");
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
