import { test, expect } from "./fixtures";
import { encodedFrame } from "./media-frame";
import sharp from "sharp";

test("phone JPEG orientation survives normalization, portable import, preview and actual MP4 encoding", async ({
  page,
  request,
}) => {
  const source = await sharp({
    create: { width: 200, height: 100, channels: 3, background: "#ff0000" },
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
    .withMetadata({ orientation: 6 })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Oriented phone photo",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  const upload = await request.post(`/api/projects/${p.id}/assets`, {
    multipart: {
      kind: "image",
      license: "Owned synthetic photo",
      file: { name: "phone.jpg", mimeType: "image/jpeg", buffer: source },
    },
  });
  expect(upload.status()).toBe(201);
  const image = (await upload.json()).assets[0];
  expect(image.width).toBe(100);
  expect(image.height).toBe(200);
  p.timeline.scenes[0].layers = [
    {
      ...p.timeline.scenes[0].layers[0],
      id: "photo",
      kind: "image",
      assetId: image.id,
      text: "",
      x: 0.3,
      y: 0.1,
      width: 0.4,
      height: 0.8,
      animation: "none",
      mediaFit: "contain",
    },
  ];
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(200);
  const archive = await (
    await request.get(`/api/projects/${p.id}/archive`)
  ).body();
  const imported = await request.post("/api/projects/import", {
    data: archive,
    headers: { "content-type": "application/zip" },
  });
  expect(imported.status()).toBe(201);
  const copy = await imported.json();
  expect(copy.assets[0]).toMatchObject({
    width: 100,
    height: 200,
    mime: "image/png",
  });
  const bytes = await (
    await request.get(`/api/projects/${copy.id}/assets/${copy.assets[0].id}`)
  ).body();
  const meta = await sharp(bytes).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.orientation).toBeUndefined();
  await page.goto("/");
  await page.getByRole("button", { name: copy.name, exact: false }).click();
  await expect(page.locator(".canvas-stage img")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".canvas-stage img")
        .evaluate((img: HTMLImageElement) => [
          img.naturalWidth,
          img.naturalHeight,
        ]),
    )
    .toEqual([100, 200]);
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const job = (
    await (await request.get(`/api/projects/${copy.id}/render`)).json()
  )[0];
  const frame = await encodedFrame(request, job.id, 2.5);
  for (const [y, channel] of [
    [216, 0],
    [504, 2],
  ]) {
    let selected = 0,
      other = 0;
    for (let dy = -10; dy < 10; dy++)
      for (let dx = -10; dx < 10; dx++) {
        const offset = ((y + dy) * frame.width + 640 + dx) * 3;
        selected += frame.data[offset + channel];
        other += frame.data[offset + (channel === 0 ? 2 : 0)];
      }
    expect(selected / 400).toBeGreaterThan(220);
    expect(other / 400).toBeLessThan(30);
  }
});
