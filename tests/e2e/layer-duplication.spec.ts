import { test, expect } from "./fixtures";
import { encodedFrame } from "./media-frame";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

test("duplicate keeps owned media/style, selects the copy, undoes once and exports both placements without copying source bytes", async ({
  page,
  request,
}) => {
  const created = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Layer duplication artwork",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  const png = await sharp({
    create: { width: 24, height: 24, channels: 3, background: "#2eb0a6" },
  })
    .png()
    .toBuffer();
  const uploaded = await request.post(`/api/projects/${created.id}/assets`, {
    multipart: {
      kind: "image",
      license: "Owned synthetic duplication artwork",
      file: { name: "reuse-layer.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(uploaded.status()).toBe(201);
  const project = await uploaded.json(),
    asset = project.assets[0];
  project.timeline.scenes[0].layers = [
    {
      ...project.timeline.scenes[0].layers[0],
      id: "owned-image",
      kind: "image",
      text: "",
      assetId: asset.id,
      x: 0.1,
      y: 0.25,
      width: 0.25,
      height: 0.45,
      rotation: 20,
      animation: "none",
      imageFit: "cover",
    },
  ];
  const saved = await request.patch(`/api/projects/${project.id}`, {
    data: {
      timeline: project.timeline,
      baseRevisionId: project.revisions.at(-1).id,
    },
  });
  expect(saved.status()).toBe(200);
  const source = await (
    await request.get(`/api/projects/${project.id}/assets/${asset.id}`)
  ).body();
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const usage = await (await request.get("/api/workspace/storage")).json();
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page
    .getByRole("button", {
      name: "Choose owned-image in layer stack",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Duplicate selected layer", exact: true })
    .click();
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  const duplicated = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  const original = duplicated.timeline.scenes[0].layers[0],
    copy = duplicated.timeline.scenes[0].layers[1];
  expect(duplicated.timeline.scenes[0].layers).toHaveLength(2);
  expect(copy.id).not.toBe(original.id);
  expect(copy).toEqual({ ...original, id: copy.id });
  const chooseCopy = () =>
    page.getByRole("button", {
      name: `Choose ${copy.id} in layer stack`,
      exact: true,
    });
  await expect(chooseCopy()).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(chooseCopy()).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Choose owned-image in layer stack",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(chooseCopy()).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: `Lock layer ${copy.id}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Duplicate selected layer", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: `Unlock layer ${copy.id}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: `Select layer ${copy.id}`, exact: true })
    .scrollIntoViewIfNeeded();
  const stage = await page.locator(".canvas-stage").boundingBox(),
    layer = await page
      .getByRole("button", { name: `Select layer ${copy.id}`, exact: true })
      .boundingBox();
  expect(stage).not.toBeNull();
  expect(layer).not.toBeNull();
  await page.mouse.move(
    layer!.x + layer!.width / 2,
    layer!.y + layer!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    layer!.x + layer!.width / 2 + stage!.width * 0.5,
    layer!.y + layer!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  const positioned = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  expect(positioned.timeline.scenes[0].layers[0]).toEqual(original);
  expect(positioned.timeline.scenes[0].layers[1].x).toBeCloseTo(0.6, 2);
  expect(positioned.assets).toHaveLength(1);
  expect(
    (await (await request.get("/api/workspace/storage")).json()).usedBytes,
  ).toBe(usage.usedBytes);
  const full = structuredClone(positioned.timeline),
    extras = Array.from({ length: 18 }, () => ({
      ...original,
      id: randomUUID(),
      hidden: true,
    }));
  full.scenes[0].layers.push(...extras);
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        data: {
          timeline: full,
          baseRevisionId: positioned.revisions.at(-1).id,
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await chooseCopy().click();
  await expect(
    page.getByRole("button", { name: "Duplicate selected layer", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".canvas-editor").screenshot({
    path: `${process.env.REELCHEMY_ARTIFACT_DIR}/layer-copy-mobile.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 200000 });
  const jobs = await (
    await request.get(`/api/projects/${project.id}/render`)
  ).json();
  const frame = await encodedFrame(request, jobs[0].id, 2);
  for (const x of [0.225, 0.725]) {
    const index =
      (Math.round(frame.height * 0.475) * frame.width +
        Math.round(frame.width * x)) *
      3;
    for (const [channel, expected] of [46, 176, 166].entries())
      expect(Math.abs(frame.data[index + channel] - expected)).toBeLessThan(15);
  }
  expect(
    hash(
      await (
        await request.get(`/api/projects/${project.id}/assets/${asset.id}`)
      ).body(),
    ),
  ).toBe(hash(source));
});
