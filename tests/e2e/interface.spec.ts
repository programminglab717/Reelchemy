import { test, expect } from "./fixtures";
import path from "node:path";

const evidence = process.env.REELCHEMY_ARTIFACT_DIR || "artifacts";
test("studio icons render without symbol fonts and preserve keyboard/control names on desktop and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText("Creator");
  const create = page.getByRole("button", {
    name: "New creation",
    exact: true,
  });
  await expect(create.locator("svg").first()).toBeVisible();
  expect(
    (await create.locator("svg").first().boundingBox())!.width,
  ).toBeGreaterThan(12);
  await expect(
    page.locator('.studio-icon:not([aria-hidden="true"])'),
  ).toHaveCount(0);
  await expect(page.locator(".composer-footer .options svg")).toHaveCount(2);
  await expect(page.locator(".composer-note svg")).toBeVisible();
  await create.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Studio", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: path.join(evidence, "studio-svg-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText("Creator");
  await expect(create.locator("svg").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Trash", exact: true }).locator("svg"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: path.join(evidence, "studio-svg-mobile.png") });
  await page
    .getByRole("button", { name: "Start from a blank canvas", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve & export MP4", exact: true }),
  ).toHaveAccessibleName("Approve & export MP4");
});

test("the verified account name is bounded in both layouts and sign-in branding uses SVG", async ({
  page,
  request,
}) => {
  const name = "Alexandria Creative Studio ".repeat(3).trim();
  expect(
    (await request.post("/api/auth/update-user", { data: { name } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText(name);
  expect(
    await page
      .locator(".profile-name")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("group", { name: "Signed-in account" }),
  ).toContainText(name);
  expect(
    await page
      .locator(".mobile-account-identity strong")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.locator(".account-card .wordmark svg")).toBeVisible();
  expect(
    await page
      .locator(".account-card .wordmark")
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
  ).toBeGreaterThan(14);
  await page.screenshot({
    path: path.join(evidence, "sign-in-svg-mobile.png"),
  });
});
