import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
// Keep real abuse controls enabled. Fast suites can share a source IP and
// legitimately exhaust signup/sign-in windows; honor Retry-After, never bypass it.
export async function authPost(
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
// Direct API calls carry the site's Origin, as the studio's own writes do.
// Only these calls: an Origin header forced onto every browser request also
// reaches the sandboxed code-scene documents, whose real origin is opaque, and
// current Chromium refuses those script loads (net::ERR_INVALID_ARGUMENT).
const apiMethods = new Set(["get", "post", "put", "patch", "delete", "head"]);
function withOrigin(request: APIRequestContext, origin: string) {
  return new Proxy(request, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      if (!apiMethods.has(String(property)) && property !== "fetch")
        return value.bind(target);
      return (
        url: unknown,
        options: { headers?: Record<string, string> } = {},
      ) =>
        value.call(target, url, {
          ...options,
          headers: { origin, ...options.headers },
        });
    },
  });
}
// What makes the page wider than the viewport, for a failed test's report:
// elements past the right edge that are not inside a scrolling container.
const overflowReport = () => {
  const width = innerWidth;
  const items: string[] = [];
  for (const element of document.querySelectorAll("body *")) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.right <= width + 1) continue;
    let clipped = false;
    for (
      let parent = element.parentElement;
      parent && parent !== document.body;
      parent = parent.parentElement
    )
      if (
        /(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)
      ) {
        clipped = true;
        break;
      }
    if (clipped) continue;
    items.push(
      `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 50)} "${(element.textContent || "").trim().slice(0, 40)}" right=${Math.round(rect.right)} width=${Math.round(rect.width)}`,
    );
    if (items.length >= 15) break;
  }
  return { scrollWidth: document.documentElement.scrollWidth, width, items };
};
export const browserTest = base.extend({
  page: async ({ page }, runFixture, testInfo) => {
    await runFixture(page);
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed())
      try {
        const report = await page.evaluate(overflowReport);
        if (report.scrollWidth > report.width)
          console.log(
            `Page overflow in "${testInfo.title.slice(0, 60)}": ${JSON.stringify(report)}`,
          );
      } catch {}
  },
  request: async ({ context }, runFixture) => {
    await runFixture(
      withOrigin(
        context.request,
        process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
      ),
    );
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

// The studio shows one editing tool at a time below the player and timeline.
export type StudioToolName =
  | "Scene & layers"
  | "Design"
  | "Media & voice"
  | "Sound & captions"
  | "Export"
  | "Project";
export async function openTool(page: Page, name: StudioToolName) {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
// Account-wide storage and export records are folded away on the page.
export async function openRecords(page: Page) {
  const records = page.locator("details.studio-records");
  if ((await records.getAttribute("open")) === null)
    await records.locator("summary").click();
  await expect(records).toHaveAttribute("open", "");
}
