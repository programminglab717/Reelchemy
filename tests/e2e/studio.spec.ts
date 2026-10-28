import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
test("idea → varied storyboard → saved edit → approval → actual MP4 download", async ({
  page,
}) => {
  const idea = `A mountain sunrise ${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Big ideas." })).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-studio.png", fullPage: true });
  await page.getByLabel("Video idea").fill(idea);
  await page.getByLabel("Duration", { exact: true }).selectOption("5");
  await page.getByRole("button", { name: "Create storyboard" }).click();
  await expect(
    page.getByRole("heading", { name: "Your storyboard" }),
  ).toBeVisible();
  await expect(page.locator(".scene-card")).toHaveCount(3);
  await page.getByLabel("On-screen text").fill("Every story starts somewhere.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saved ✓" })).toBeVisible();
  await page.screenshot({
    path: "artifacts/ui-storyboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadPromise;
  await download.saveAs("artifacts/e2e-export.mp4");
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "artifacts/e2e-export.mp4",
      ],
      { encoding: "utf8" },
    ),
  );
  const video = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  expect(video.codec_name).toBe("h264");
  expect(video.width).toBe(1280);
  expect(video.height).toBe(720);
  expect(video.r_frame_rate).toBe("30/1");
  expect(Number(probe.format.duration)).toBeCloseTo(5, 1);
  expect((await fs.stat("artifacts/e2e-export.mp4")).size).toBeGreaterThan(
    10000,
  );
  await page.reload();
  await page.getByRole("button", { name: new RegExp(idea) }).click();
  await expect(page.getByLabel("On-screen text")).toHaveValue(
    "Every story starts somewhere.",
  );
});
test("mobile composer is usable and does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Video idea")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "artifacts/ui-mobile.png", fullPage: true });
});
