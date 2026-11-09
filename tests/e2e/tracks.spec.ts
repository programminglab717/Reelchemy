import { test, expect, openTool } from "./fixtures";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
test("audio and caption bars move/trim with source limits, undo and non-overlap", async ({
  page,
  request,
}) => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-tracks-"));
  try {
    const file = path.join(dir, "tone.wav");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=660:duration=4",
      "-ar",
      "48000",
      "-ac",
      "2",
      file,
    ]);
    const p = await (
      await request.post("/api/projects", {
        data: {
          prompt: "Track editing",
          duration: 5,
          format: "landscape",
          blank: true,
        },
      })
    ).json();
    const upload = await request.post(`/api/projects/${p.id}/assets`, {
      multipart: {
        kind: "audio",
        license: "Owned test",
        file: {
          name: "tone.wav",
          mimeType: "audio/wav",
          buffer: await readFile(file),
        },
      },
    });
    expect(upload.status()).toBe(201);
    const asset = (await upload.json()).assets[0];
    const timeline = {
      ...p.timeline,
      audioTracks: [
        {
          id: "tone",
          assetId: asset.id,
          startFrame: 30,
          offsetFrames: 0,
          durationFrames: 60,
          volume: 0.5,
          fadeFrames: 6,
        },
      ],
      captions: [
        { id: "first", startFrame: 0, endFrame: 15, text: "First" },
        { id: "middle", startFrame: 45, endFrame: 60, text: "Middle" },
        { id: "last", startFrame: 100, endFrame: 120, text: "Last" },
      ],
    };
    expect(
      (
        await request.patch(`/api/projects/${p.id}`, {
          data: { timeline, baseRevisionId: p.revisions.at(-1).id },
        })
      ).status(),
    ).toBe(200);
    await page.goto("/");
    await page
      .getByRole("button", { name: "Track editing", exact: false })
      .click();
    const saved = async () =>
      (await (await request.get(`/api/projects/${p.id}`)).json()).timeline;
    await page
      .getByRole("button", { name: "Move Audio 1", exact: true })
      .press("Shift+ArrowRight");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await saved()).audioTracks[0].startFrame).toBe(40);
    await page
      .getByRole("button", { name: "Trim start Audio 1", exact: true })
      .press("Shift+ArrowRight");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await saved()).audioTracks[0]).toMatchObject({
      startFrame: 50,
      offsetFrames: 10,
      durationFrames: 50,
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await saved()).audioTracks[0]).toMatchObject({
      startFrame: 40,
      offsetFrames: 0,
      durationFrames: 60,
    });
    const move = page.getByRole("button", {
      name: "Move Caption 2",
      exact: true,
    });
    await openTool(page, "Sound & captions");
    await move.scrollIntoViewIfNeeded();
    const box = (await move.boundingBox())!,
      lane = (await page
        .getByLabel("Caption 2 track", { exact: true })
        .boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 - (lane.width * 60) / 150,
      box.y + box.height / 2,
      { steps: 5 },
    );
    await page.mouse.up();
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await saved()).captions[1]).toMatchObject({
      startFrame: 15,
      endFrame: 30,
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByRole("button", { name: "Trim end Caption 2", exact: true })
      .press("Shift+ArrowRight");
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
      "All changes saved",
    );
    expect((await saved()).captions[1]).toMatchObject({
      startFrame: 45,
      endFrame: 70,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Track editing", exact: false })
      .click();
    await openTool(page, "Sound & captions");
    await expect(
      page.getByRole("button", { name: "Move Caption 2", exact: true }),
    ).toBeVisible();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
