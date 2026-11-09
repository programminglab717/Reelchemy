import { test, expect, account, openTool } from "./fixtures";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
test("uploaded footage trims/splits with exact source pictures and audible intervals in a real MP4", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(360000);
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-e2e-footage-"));
  try {
    const source = path.join(dir, "colors.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=red:size=160x90:rate=30:duration=1",
      "-f",
      "lavfi",
      "-i",
      "color=blue:size=160x90:rate=30:duration=1",
      "-f",
      "lavfi",
      "-i",
      "color=green:size=160x90:rate=30:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=4",
      "-filter_complex",
      "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map",
      "[v]",
      "-map",
      "3:a",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-shortest",
      source,
    ]);
    await page.goto("/");
    await page.getByLabel("Duration", { exact: true }).selectOption("5");
    await page
      .getByRole("button", { name: "Start from a blank canvas" })
      .click();
    await openTool(page, "Media & voice");
    await page.getByLabel("Upload video").setInputFiles(source);
    await page
      .getByPlaceholder("I own this footage")
      .fill("Owned color and tone test");
    await page
      .getByRole("button", { name: "Upload video asset", exact: true })
      .click();
    await expect(page.getByText("colors.mp4", { exact: true })).toBeVisible({
      timeout: 120000,
    });
    await page
      .getByRole("button", { name: "Add video to selected scene" })
      .click();
    const textRow = page
      .locator(".layer-row")
      .filter({ hasText: "text · title" });
    await openTool(page, "Scene & layers");
    await textRow.locator("summary").first().click();
    await textRow.getByRole("button", { name: "Remove layer" }).click();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    const [p] = await (await request.get("/api/projects")).json();
    const asset = p.assets[0],
      clipId = p.timeline.scenes[0].layers[0].id;
    const row = page
      .locator(".layer-row")
      .filter({ hasText: `video · ${clipId}` });
    await row.locator("summary").first().click();
    await page.getByLabel(`Clip length ${clipId}`, { exact: true }).fill("2");
    await page.getByLabel(`Source in ${clipId}`, { exact: true }).fill("1");
    await page.getByLabel(`Clip start ${clipId}`, { exact: true }).fill("1");
    await page
      .getByLabel(`Video fit ${clipId}`, { exact: true })
      .selectOption("cover");
    await page
      .getByLabel(`Video volume ${clipId}`, { exact: true })
      .fill("0.5");
    const getClip = async () =>
      (await (await request.get(`/api/projects/${p.id}`)).json()).timeline
        .scenes[0].layers[0].video;
    const moved = page.getByRole("button", {
      name: "Move Footage 1.1",
      exact: true,
    });
    await moved.focus();
    await moved.press("Shift+ArrowRight");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await getClip()).startFrame).toBe(40);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByRole("button", { name: "Trim start Footage 1.1", exact: true })
      .press("Shift+ArrowRight");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect(await getClip()).toMatchObject({
      startFrame: 40,
      offsetFrames: 40,
      durationFrames: 50,
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const trim = page.getByRole("button", {
      name: "Trim end Footage 1.1",
      exact: true,
    });
    await trim.scrollIntoViewIfNeeded();
    const handle = (await trim.boundingBox())!,
      lane = (await page
        .getByLabel("Footage 1.1 track", { exact: true })
        .boundingBox())!;
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      handle.x + handle.width / 2 - (lane.width * 10) / 150,
      handle.y + handle.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await getClip()).durationFrames).toBe(50);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.getByLabel("Timeline playhead").fill("60");
    await page.getByRole("button", { name: "Split scene at playhead" }).click();
    await expect(page.locator(".scene-card")).toHaveCount(2);
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    let saved = await (await request.get(`/api/projects/${p.id}`)).json();
    expect(
      saved.timeline.scenes.map(
        (s: { durationFrames: number }) => s.durationFrames,
      ),
    ).toEqual([60, 90]);
    expect(saved.timeline.scenes[0].layers[0].video).toMatchObject({
      startFrame: 30,
      offsetFrames: 30,
      durationFrames: 30,
      volume: 0.5,
    });
    expect(saved.timeline.scenes[1].layers[0].video).toMatchObject({
      startFrame: 0,
      offsetFrames: 60,
      durationFrames: 30,
      volume: 0.5,
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator(".scene-card")).toHaveCount(1);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator(".scene-card")).toHaveCount(2);
    const url = `/api/projects/${p.id}/assets/${asset.id}`;
    const range = await request.get(url, { headers: { Range: "bytes=0-31" } });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(32);
    expect(range.headers()["content-range"]).toMatch(/^bytes 0-31\//);
    expect(range.headers()["cache-control"]).toContain("private");
    expect(
      (
        await request.get(url, { headers: { Range: "bytes=999999999-" } })
      ).status(),
    ).toBe(416);
    const outsider = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
      extraHTTPHeaders: { origin: process.env.PLAYWRIGHT_BASE_URL! },
    });
    await account(outsider.request, "Footage outsider");
    expect(
      (
        await outsider.request.get(url, { headers: { Range: "bytes=0-31" } })
      ).status(),
    ).toBe(404);
    await outsider.close();
    await page.screenshot({
      path: `${process.env.REELCHEMY_ARTIFACT_DIR}/footage-editor.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 200000,
    });
    const jobs = await (
      await request.get(`/api/projects/${p.id}/render`)
    ).json();
    expect(jobs[0].report.qc.audio.codec).toBe("aac");
    const file = path.join(dir, "export.mp4");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download MP4" }).click();
    await (await downloadEvent).saveAs(file);
    for (const [seconds, channel] of [
      [1.5, 2],
      [2.5, 1],
    ] as const) {
      const png = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(seconds),
          "-i",
          file,
          "-frames:v",
          "1",
          "-f",
          "image2pipe",
          "-vcodec",
          "png",
          "-",
        ],
        { maxBuffer: 10000000 },
      );
      const pixel = await sharp(png)
        .extract({ left: 640, top: 360, width: 1, height: 1 })
        .removeAlpha()
        .raw()
        .toBuffer();
      expect(pixel[channel]).toBeGreaterThan(channel === 2 ? 200 : 90);
      expect(pixel[0]).toBeLessThan(30);
    }
    const pcm = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-vn",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 2000000 },
    );
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++)
        sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / ((end - start) * 48000));
    };
    expect(rms(0.1, 0.8)).toBeLessThan(0.0001);
    expect(rms(1.2, 2.8)).toBeGreaterThan(0.01);
    expect(rms(3.2, 4.8)).toBeLessThan(0.0001);
    await page.reload();
    await page.getByRole("button", { name: "Untitled creation" }).click();
    await expect(page.locator(".scene-card")).toHaveCount(2);
    saved = await (await request.get(`/api/projects/${p.id}`)).json();
    expect(saved.timeline.scenes[1].layers[0].video.offsetFrames).toBe(60);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${process.env.REELCHEMY_ARTIFACT_DIR}/footage-editor-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    // New loopback ports/tokens on each attempt must not invalidate byte-identical footage.
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 200000,
    });
    const repeated = await (
      await request.get(`/api/projects/${p.id}/render`)
    ).json();
    expect(
      repeated[0].report.sceneCache.map((s: { reused: boolean }) => s.reused),
    ).toEqual([true, true]);
    // Keep a media artifact only in the isolated run; the temporary fixture folder is cleaned.
    expect((await readFile(file)).length).toBeGreaterThan(10000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
