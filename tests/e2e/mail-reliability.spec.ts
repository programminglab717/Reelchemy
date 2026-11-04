import { browserTest as test, expect, authPost, mailLink } from "./fixtures";
import { readdir, readFile, writeFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
const queuedName = /^[a-f0-9-]{36}\.json$/;

test("missed verification recovers after a full private queue without losing email or overflowing mobile sign-in", async ({
  page,
  request,
}, testInfo) => {
  const email = `mail-recovery-${crypto.randomUUID()}@example.test`,
    password = "Synthetic-mail-passphrase-4826";
  const signup = await authPost(request, "/api/auth/sign-up/email", {
    data: { email, password, name: "Mail recovery", callbackURL: "/" },
  });
  expect(signup.ok()).toBeTruthy();
  const user = (await signup.json()).user;
  const directory = path.join(
    process.env.REELCHEMY_AUTH_DIR || process.env.REELCHEMY_DATA_DIR!,
    "mail",
  );
  const originals = new Map<string, Buffer>();
  let originalName = "";
  const seeded: string[] = [];
  for (const name of (await readdir(directory)).filter((name) =>
    queuedName.test(name),
  )) {
    const bytes = await readFile(path.join(directory, name)),
      message = JSON.parse(bytes.toString());
    if (message.to === email) {
      originalName = name;
      await writeFile(
        path.join(directory, name),
        JSON.stringify({
          ...message,
          createdAt: new Date(Date.now() - 3600001).toISOString(),
        }),
        { mode: 0o600 },
      );
    } else originals.set(name, bytes);
  }
  expect(originalName).not.toBe("");
  expect(originals.size).toBeLessThan(1000);
  try {
    // Explicit legacy-format fixture mail fills the unchanged default allowance.
    // No SMTP consumer is started by the production HTTPS harness.
    for (let index = originals.size; index < 1000; index++)
      seeded.push(`${crypto.randomUUID()}.json`);
    for (let start = 0; start < seeded.length; start += 20)
      await Promise.all(
        seeded
          .slice(start, start + 20)
          .map((name, index) =>
            writeFile(
              path.join(directory, name),
              JSON.stringify({
                to: `capacity-${start + index}@example.test`,
                subject: "Synthetic capacity fixture",
                text: "Never deliver this fixture externally",
                createdAt: new Date().toISOString(),
                attempts: 0,
                nextAttemptAt: 0,
              }),
              { mode: 0o600, flag: "wx" },
            ),
          ),
      );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sign-in");
    await page
      .getByRole("button", { name: "Resend verification email", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Verify your email" }),
    ).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await page.getByLabel("Email address").fill(email);
    const refused = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/send-verification-email") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Send verification link", exact: true })
      .click();
    expect((await refused).ok()).toBeFalsy();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    await expect(
      page.getByRole("button", { name: "Send verification link", exact: true }),
    ).toBeEnabled();
    expect(
      (await readdir(directory)).filter((name) => queuedName.test(name)),
    ).toHaveLength(1000);
    await expect(async () =>
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390),
    ).toPass();
    const screenshot = path.join(
      testInfo.outputDir,
      "verification-queue-full-mobile.png",
    );
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("verification-queue-full-mobile", {
      path: screenshot,
      contentType: "image/png",
    });
    // Release only this test's explicitly seeded message; all other accounts stay intact.
    await unlink(path.join(directory, seeded.pop()!));
    const retried = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/send-verification-email") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Send verification link", exact: true })
      .click();
    expect((await retried).ok()).toBeTruthy();
    await expect(page.getByRole("status")).toContainText(
      "If this address has an unverified account",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    const matching = [];
    for (const name of (await readdir(directory)).filter((name) =>
      queuedName.test(name),
    )) {
      const item = JSON.parse(
        await readFile(path.join(directory, name), "utf8"),
      );
      if (item.to === email) matching.push({ name, item });
    }
    expect(matching).toHaveLength(1);
    expect(matching[0].item.accountId).toBe(user.id);
    expect(
      (await stat(path.join(directory, matching[0].name))).mode & 0o777,
    ).toBe(0o600);
    for (const [name, bytes] of originals)
      expect(await readFile(path.join(directory, name))).toEqual(bytes);
    const verified = await request.get(await mailLink(email, "Verify"));
    expect(verified.ok()).toBeTruthy();
    const film = await request.post("/api/projects", {
      data: {
        prompt: "Studio opened after verification recovery",
        duration: 5,
        format: "landscape",
      },
    });
    expect(film.ok()).toBeTruthy();
  } finally {
    for (const name of seeded)
      await unlink(path.join(directory, name)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
  }
});
