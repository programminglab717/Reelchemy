import { test, expect } from "./fixtures";
import { encodedFrame } from "./media-frame";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
for (const kind of ["image", "video"] as const)
  test(`${kind} framing previews non-destructively, commits one gesture and exports the selected source pixels`, async ({
    page,
    request,
  }) => {
    test.setTimeout(360000);
    const temporary = await mkdtemp(path.join(tmpdir(), "reelchemy-framing-"));
    try {
      let source: Buffer;
      if (kind === "image")
        source = await sharp({
          create: {
            width: 200,
            height: 100,
            channels: 3,
            background: "#ff0000",
          },
        })
          .composite([
            {
              input: await sharp({
                create: {
                  width: 100,
                  height: 100,
                  channels: 3,
                  background: "#0000ff",
                },
              })
                .png()
                .toBuffer(),
              left: 100,
              top: 0,
            },
          ])
          .png()
          .toBuffer();
      else {
        const file = path.join(temporary, "framing.mp4");
        execFileSync("ffmpeg", [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=200x100:r=30:d=5,drawbox=x=100:y=0:w=100:h=100:color=blue:t=fill",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          file,
        ]);
        source = await readFile(file);
      }
      const p = await (
        await request.post("/api/projects", {
          data: {
            prompt: `${kind} framing`,
            duration: 5,
            format: "square",
            blank: true,
          },
        })
      ).json();
      const upload = await request.post(`/api/projects/${p.id}/assets`, {
        multipart: {
          kind,
          license: "Owned synthetic source",
          file: {
            name: kind === "image" ? "framing.png" : "framing.mp4",
            mimeType: kind === "image" ? "image/png" : "video/mp4",
            buffer: source,
          },
        },
      });
      expect(upload.status()).toBe(201);
      const asset = (await upload.json()).assets[0];
      p.timeline.scenes[0].layers = [
        {
          ...p.timeline.scenes[0].layers[0],
          id: "picture",
          kind,
          assetId: asset.id,
          text: "",
          x: 0.2,
          y: 0.2,
          width: 0.6,
          height: 0.6,
          animation: "none",
          ...(kind === "video"
            ? {
                video: {
                  fit: "contain",
                  startFrame: 0,
                  offsetFrames: 0,
                  durationFrames: 150,
                  audio: false,
                  volume: 1,
                },
              }
            : {}),
        },
      ];
      expect(
        (
          await request.patch(`/api/projects/${p.id}`, {
            data: {
              timeline: p.timeline,
              baseRevisionId: p.revisions.at(-1).id,
            },
          })
        ).status(),
      ).toBe(200);
      await page.goto("/");
      await page
        .getByRole("button", { name: `${kind} framing`, exact: false })
        .click();
      const controls = page.getByRole("group", {
        name: "Media framing",
        exact: true,
      });
      await controls
        .getByLabel("Media fit", { exact: true })
        .selectOption("cover");
      await expect(
        page.getByRole("status", { name: "Save status" }),
      ).toHaveText("All changes saved");
      const slider = controls.getByLabel("Horizontal media framing", {
        exact: true,
      });
      await slider.scrollIntoViewIfNeeded();
      const box = (await slider.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width, box.y + box.height / 2, {
        steps: 8,
      });
      await expect(
        page.locator(`.canvas-stage ${kind === "image" ? "img" : "video"}`),
      ).toHaveCSS("object-position", "100% 50%");
      expect(
        (await (await request.get(`/api/projects/${p.id}`)).json()).timeline
          .scenes[0].layers[0].mediaPosition,
      ).toBeUndefined();
      await slider.press("Escape");
      await page.mouse.up();
      await expect(slider).toHaveValue("50");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width, box.y + box.height / 2, {
        steps: 8,
      });
      await page.mouse.up();
      await expect(slider).toHaveValue("100");
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(slider).toHaveValue("50");
      await expect(
        controls.getByLabel("Media fit", { exact: true }),
      ).toHaveValue("cover");
      await page.getByRole("button", { name: "Redo", exact: true }).click();
      await expect(slider).toHaveValue("100");
      await page
        .getByRole("button", { name: "Lock layer picture", exact: true })
        .click();
      await expect(slider).toBeDisabled();
      await page
        .getByRole("button", { name: "Unlock layer picture", exact: true })
        .click();
      await expect(
        page.getByRole("status", { name: "Save status" }),
      ).toHaveText("All changes saved");
      await page.reload();
      await page
        .getByRole("button", { name: `${kind} framing`, exact: false })
        .click();
      await expect(
        page.getByLabel("Horizontal media framing", { exact: true }),
      ).toHaveValue("100");
      await page.getByRole("button", { name: "Approve & export MP4" }).click();
      await expect(page.getByText("Your film is ready.")).toBeVisible({
        timeout: 200000,
      });
      const job = (
        await (await request.get(`/api/projects/${p.id}/render`)).json()
      )[0];
      const frame = await encodedFrame(request, job.id, 2.5);
      let red = 0,
        blue = 0;
      for (let y = 530; y < 550; y++)
        for (let x = 530; x < 550; x++) {
          const i = (y * frame.width + x) * 3;
          red += frame.data[i];
          blue += frame.data[i + 2];
        }
      expect(red / 400).toBeLessThan(30);
      expect(blue / 400).toBeGreaterThan(220);
      expect(job.report.timeline.scenes[0].layers[0].mediaPosition).toEqual({
        x: 1,
        y: 0.5,
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
