import { test, expect, account, openTool } from "./fixtures";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  },
});

test("synthetic microphone take can be reviewed, recovered after failed upload, mixed and privately visualized", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(360000);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Narration studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { testMic: MediaStream }).testMic = stream;
      return stream;
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Narration studio", exact: false })
    .click();
  await openTool(page, "Media & voice");
  await page
    .getByRole("button", { name: "Start microphone recording", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop recording", exact: true }),
  ).toBeVisible();
  await openTool(page, "Project");
  await expect(
    page.getByRole("button", { name: "Manage saved history", exact: true }),
  ).toBeDisabled();
  await openTool(page, "Media & voice");
  await expect
    .poll(async () =>
      Number(
        (
          await page
            .getByRole("status", { name: "Recorded duration" })
            .textContent()
        )?.split("s")[0],
      ),
    )
    .toBeGreaterThan(1.2);
  await page
    .getByRole("button", { name: "Stop recording", exact: true })
    .click();
  await expect(
    page.getByLabel("Recorded narration preview", { exact: true }),
  ).toBeVisible();
  const take = await page
    .getByLabel("Recorded narration preview", { exact: true })
    .getAttribute("src");
  await openTool(page, "Project");
  await page
    .getByRole("button", { name: "Manage saved history", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Manage saved history", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Manage saved history", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await openTool(page, "Media & voice");
  await expect(
    page.getByLabel("Recorded narration preview", { exact: true }),
  ).toHaveAttribute("src", take!);
  await openTool(page, "Project");
  await expect(
    page.getByRole("button", { name: "Browse saved versions", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Restore saved version", { exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { testMic: MediaStream }).testMic
        .getTracks()
        .every((t) => t.readyState === "ended"),
    ),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "New creation", exact: false })
    .click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toContainText(
    "Save or discard your narration take before leaving this project.",
  );
  await openTool(page, "Media & voice");
  await expect(
    page.getByLabel("Recorded narration preview", { exact: true }),
  ).toBeVisible();
  const draftDownload = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download recording", exact: true })
    .click();
  const download = await draftDownload;
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-recording-e2e-"));
  try {
    const wav = path.join(dir, "recording.wav");
    await download.saveAs(wav);
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", wav],
        { encoding: "utf8" },
      ),
    );
    expect(meta.streams[0].codec_name).toBe("pcm_s16le");
    expect(Number(meta.streams[0].duration)).toBeGreaterThan(1.2);
    await page.route(
      `**/api/projects/${p.id}/assets`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary test outage" }),
        }),
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Save recording to assets", exact: true })
      .click();
    await expect(
      page.getByText(/Your take is retained here\. Temporary test outage/),
    ).toBeVisible();
    await expect(
      page.getByLabel("Recorded narration preview", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Save recording to assets", exact: true })
      .click();
    const add = page.getByRole("button", {
      name: "Add audio: Narration.wav",
      exact: true,
    });
    await openTool(page, "Sound & captions");
    await expect(add).toBeVisible();
    await add.click();
    await expect(
      page.getByRole("img", { name: "Source audio waveform", exact: true }),
    ).toBeVisible();
    const latest = await (await request.get(`/api/projects/${p.id}`)).json();
    const asset = latest.assets[0];
    const waveformUrl = `/api/projects/${p.id}/assets/${asset.id}/waveform`;
    const owner = await request.get(waveformUrl);
    expect(owner.status()).toBe(200);
    expect(owner.headers()["cache-control"]).toContain("private");
    expect(
      (await owner.json()).peaks.some((x: number) => x > 0.005),
    ).toBeTruthy();
    const outsider = await browser.newContext({
      baseURL: process.env.PLAYWRIGHT_BASE_URL,
    });
    try {
      await account(outsider.request, "Outside recorder");
      expect((await outsider.request.get(waveformUrl)).status()).toBe(404);
    } finally {
      await outsider.close();
    }
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 200000,
    });
    const job = (
      await (await request.get(`/api/projects/${p.id}/render`)).json()
    )[0];
    expect(job.report.qc.audio.codec).toBe("aac");
    expect(job.report.qc.audio.tracks).toBe(1);
    const exported = await request.get(`/api/jobs/${job.id}/download`);
    expect(exported.ok()).toBeTruthy();
    const mp4 = path.join(dir, "recorded.mp4");
    await writeFile(mp4, await exported.body());
    const raw = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      mp4,
      "-t",
      "1",
      "-f",
      "s16le",
      "-ac",
      "1",
      "pipe:1",
    ]);
    let peak = 0;
    for (let i = 0; i < raw.length; i += 2)
      peak = Math.max(peak, Math.abs(raw.readInt16LE(i)));
    expect(peak).toBeGreaterThan(100);
    await page
      .getByRole("button", { name: "New creation", exact: false })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Start from a blank canvas",
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("denied microphone permission explains recovery without blocking manual editing", async ({
  page,
  request,
}) => {
  await request.post("/api/projects", {
    data: {
      prompt: "Denied recording",
      duration: 5,
      format: "portrait",
      blank: true,
    },
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Denied", "NotAllowedError"));
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Denied recording", exact: false })
    .click();
  await openTool(page, "Media & voice");
  await page
    .getByRole("button", { name: "Start microphone recording", exact: true })
    .click();
  await expect(
    page.getByText(/Microphone permission was denied/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Start microphone recording",
      exact: true,
    }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "New creation", exact: false })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Start from a blank canvas",
      exact: true,
    }),
  ).toBeVisible();
});
