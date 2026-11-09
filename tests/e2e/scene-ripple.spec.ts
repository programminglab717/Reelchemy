import { test, expect, openTool } from "./fixtures";
import { creatorTemplateTimeline } from "../../src/lib/creator-templates";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("a captioned starter closes a deleted scene's gap through undo, reload and HD export with exact retained narration intervals", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(360000);
  page.setDefaultTimeout(15000);
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-ripple-maker-"));
  try {
    const source = path.join(root, "three-tones.wav");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=15",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:sample_rate=48000:duration=15",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1320:sample_rate=48000:duration=6",
        "-filter_complex",
        "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
        "-map",
        "[out]",
        "-ac",
        "1",
        source,
      ],
      { timeout: 15000 },
    );
    await page.goto("/");
    await page
      .getByRole("button", { name: "Use A clear launch template", exact: true })
      .click();
    const [project] = await (await request.get("/api/projects")).json();
    const read = async () =>
      await (await request.get(`/api/projects/${project.id}`)).json();
    const saved = page.getByRole("status", { name: "Save status" });
    await openTool(page, "Media & voice");
    await page
      .getByLabel("Upload audio", { exact: true })
      .setInputFiles(source);
    await page
      .getByPlaceholder("I own this audio", { exact: true })
      .fill("Synthetic tones generated and owned by this test");
    await page
      .getByRole("button", { name: "Upload audio asset", exact: true })
      .click();
    await openTool(page, "Sound & captions");
    await page
      .getByRole("button", { name: "Add audio: three-tones.wav", exact: true })
      .click();
    await expect(saved).toHaveText("All changes saved");
    const before = (await read()).timeline,
      original = creatorTemplateTimeline("vertical-launch");
    expect(before.audioTracks[0].durationFrames).toBe(1080);
    await page
      .getByRole("button", {
        name: `Timeline scene 2: ${original.scenes[1].title}`,
        exact: true,
      })
      .click();
    await openTool(page, "Scene & layers");
    await page
      .getByRole("button", { name: "Delete scene and close gap", exact: true })
      .click();
    await expect(saved).toHaveText("All changes saved");
    const cut = (await read()).timeline;
    expect(cut.scenes).toEqual([before.scenes[0], before.scenes[2]]);
    expect(
      cut.audioTracks.map(
        (a: {
          startFrame: number;
          offsetFrames: number;
          durationFrames: number;
        }) => [a.startFrame, a.offsetFrames, a.durationFrames],
      ),
    ).toEqual([
      [0, 0, 450],
      [450, 900, 180],
    ]);
    expect(cut.captions).toEqual(
      before.captions
        .filter(
          (c: { startFrame: number }) =>
            c.startFrame < 450 || c.startFrame >= 900,
        )
        .map((c: { startFrame: number; endFrame: number }) =>
          c.startFrame >= 900
            ? {
                ...c,
                startFrame: c.startFrame - 450,
                endFrame: c.endFrame - 450,
              }
            : c,
        ),
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(saved).toHaveText("All changes saved");
    expect((await read()).timeline).toEqual(before);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(saved).toHaveText("All changes saved");
    expect((await read()).timeline).toEqual(cut);
    await page.reload();
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: project.name, exact: true }),
    ).toBeVisible();
    expect((await read()).timeline).toEqual(cut);
    const admitted = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/render`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Approve & export MP4", exact: true })
      .click();
    const job = await (await admitted).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 300000,
    });
    const report = await (
      await request.get(`/api/jobs/${job.id}/evidence/report.json`)
    ).json();
    expect([report.export.width, report.export.height]).toEqual([1080, 1920]);
    expect(report.export.duration).toBeCloseTo(30, 2);
    expect(report.qc.audio.tracks).toBe(2);
    expect(report.qc.audio.codec).toBe("aac");
    expect(report.qc.audio.duration).toBeCloseTo(30, 2);
    expect(report.qc.layout.after).toEqual([]);
    const download = await request.get(`/api/jobs/${job.id}/download`);
    expect(download.status()).toBe(200);
    const movie = path.join(root, "cut.mp4");
    await writeFile(movie, await download.body());
    for (const [second, frequency] of [
      [1, 440],
      [16, 1320],
      [25, 0],
    ] as const) {
      const samples = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          String(second),
          "-i",
          movie,
          "-t",
          "0.5",
          "-vn",
          "-f",
          "f32le",
          "-ac",
          "1",
          "-ar",
          "48000",
          "pipe:1",
        ],
        { timeout: 15000 },
      );
      const count = samples.length / 4;
      expect(count).toBe(24000);
      const amplitude = (hz: number) => {
        let re = 0,
          im = 0;
        for (let i = 0; i < count; i++) {
          const value = samples.readFloatLE(i * 4),
            phase = (2 * Math.PI * hz * i) / 48000;
          re += value * Math.cos(phase);
          im += value * Math.sin(phase);
        }
        return (Math.hypot(re, im) * 2) / count;
      };
      // The removed middle source tone never survives or gets substituted
      // for the original closing narration after the gap closes.
      expect(amplitude(880)).toBeLessThan(0.003);
      for (const hz of [440, 1320]) {
        if (hz === frequency) expect(amplitude(hz)).toBeGreaterThan(0.02);
        else expect(amplitude(hz)).toBeLessThan(0.003);
      }
    }
    const archive = await request.get(`/api/projects/${project.id}/archive`);
    const imported = await request.post("/api/projects/import", {
      headers: { "content-type": "application/zip" },
      data: await archive.body(),
    });
    expect(imported.status()).toBe(201);
    const restored = await imported.json();
    expect(restored.timeline.scenes).toEqual(cut.scenes);
    expect(restored.timeline.captions).toEqual(cut.captions);
    expect(
      restored.timeline.audioTracks.map(
        (a: {
          startFrame: number;
          offsetFrames: number;
          durationFrames: number;
        }) => [a.startFrame, a.offsetFrames, a.durationFrames],
      ),
    ).toEqual([
      [0, 0, 450],
      [450, 900, 180],
    ]);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page, "Scene & layers");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("cut-scene-mobile.png"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
