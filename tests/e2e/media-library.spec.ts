import { test, expect, openTool } from "./fixtures";
import sharp from "sharp";
import type { APIRequestContext } from "@playwright/test";
import type { Project } from "../../src/lib/schema";
import { encodedFrame } from "./media-frame";

async function project(request: APIRequestContext, name: string) {
  const response = await request.post("/api/projects", {
    data: { prompt: name, blank: true, duration: 5, format: "landscape" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Project;
}
async function upload(
  request: APIRequestContext,
  id: string,
  name = "Reusable brand badge.png",
) {
  const response = await request.post(`/api/projects/${id}/assets`, {
    multipart: {
      license: "Generated studio library fixture",
      file: {
        name,
        mimeType: "image/png",
        buffer: await sharp({
          create: { width: 64, height: 64, channels: 3, background: "#f4c44a" },
        })
          .png()
          .toBuffer(),
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Project;
}
async function removeSource(request: APIRequestContext, id: string) {
  expect((await request.delete(`/api/projects/${id}/trash`)).ok()).toBeTruthy();
  expect(
    (
      await request.post(`/api/projects/${id}/deletion`, {
        data: { confirmation: "DELETE" },
      })
    ).ok(),
  ).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/projects/${id}/deletion`)).json())
          .state,
    )
    .toBe("completed");
}

test("reuse preserves unsaved edits, shared storage and actual MP4 pixels after the source is permanently removed", async ({
  page,
  request,
}) => {
  let source = await project(request, "Original brand sources");
  source = await upload(request, source.id);
  const target = await project(request, "Reuse in a new campaign");
  const asset = source.assets![0];
  const bytes = await (
    await request.get(`/api/projects/${source.id}/assets/${asset.id}`)
  ).body();
  const before = await (await request.get("/api/workspace/storage")).json();
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  await page.route(`**/api/projects/${target.id}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Synthetic save outage during media reuse",
        }),
      });
    else await route.continue();
  });
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep this unsaved campaign edit");
  await expect(
    page.getByText("Synthetic save outage during media reuse", { exact: true }),
  ).toBeVisible();
  await openTool(page, "Media & voice");
  await page.getByText("Reuse media from your studio", { exact: true }).click();
  const library = page.getByRole("region", { name: "Studio media library" });
  await library.getByLabel("Search studio media").fill("Reusable brand");
  await expect(
    library.getByText("From Original brand sources", { exact: true }),
  ).toBeVisible();
  await expect(library.getByText(asset.license, { exact: true })).toBeVisible();
  await library
    .getByRole("button", { name: `Reuse ${asset.name}`, exact: true })
    .click();
  await expect(
    library.getByRole("button", {
      name: `${asset.name} is already in this project`,
      exact: true,
    }),
  ).toBeDisabled();
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep this unsaved campaign edit",
  );
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).timeline
      .scenes[0].title,
  ).toBe("Scene 1");
  expect(await (await request.get("/api/workspace/storage")).json()).toEqual(
    before,
  );
  await page.unroute(`**/api/projects/${target.id}`);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await removeSource(request, source.id);
  expect((await request.get(`/api/projects/${source.id}`)).status()).toBe(404);
  expect(
    await (
      await request.get(`/api/projects/${target.id}/assets/${asset.id}`)
    ).body(),
  ).toEqual(bytes);
  expect(await (await request.get("/api/workspace/storage")).json()).toEqual(
    before,
  );
  await page
    .getByRole("button", { name: "Add to selected scene", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide layer title", exact: true })
    .click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const [job] = await (
    await request.get(`/api/projects/${target.id}/render`)
  ).json();
  const frame = await encodedFrame(request, job.id, 2.5);
  const pixel =
    (Math.floor(frame.height * 0.675) * frame.width +
      Math.floor(frame.width * 0.5)) *
    3;
  expect(frame.data[pixel]).toBeGreaterThan(220);
  expect(frame.data[pixel + 1]).toBeGreaterThan(160);
  expect(frame.data[pixel + 2]).toBeLessThan(110);
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).timeline
      .scenes[0].title,
  ).toBe("Keep this unsaved campaign edit");
});

test("an uncertain reuse response retries safely even after the original source is removed", async ({
  page,
  request,
}) => {
  let source = await project(request, "Uncertain media source");
  source = await upload(request, source.id, "Retry reuse.png");
  const target = await project(request, "Recover uncertain reuse");
  const asset = source.assets![0];
  const before = await (await request.get("/api/workspace/storage")).json();
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  let first = true;
  await page.route(
    `**/api/projects/${target.id}/assets/link`,
    async (route) => {
      if (first) {
        first = false;
        expect((await route.fetch()).ok()).toBeTruthy();
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic lost reuse response" }),
        });
      } else await route.continue();
    },
  );
  await openTool(page, "Media & voice");
  await page.getByText("Reuse media from your studio", { exact: true }).click();
  const library = page.getByRole("region", { name: "Studio media library" });
  await library
    .getByRole("button", { name: `Reuse ${asset.name}`, exact: true })
    .click();
  await expect(
    library.getByRole("alert", { name: "Studio media error" }),
  ).toHaveText("Synthetic lost reuse response");
  await removeSource(request, source.id);
  await library
    .getByRole("button", { name: `Reuse ${asset.name}`, exact: true })
    .click();
  await expect(
    library.getByRole("button", {
      name: `${asset.name} is already in this project`,
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await (await request.get(`/api/projects/${target.id}`)).json()).assets,
  ).toHaveLength(1);
  expect(await (await request.get("/api/workspace/storage")).json()).toEqual(
    before,
  );
});

test("library search/type/pagination and failure recovery remain usable at mobile width", async ({
  page,
  request,
}) => {
  let source = await project(request, "Searchable studio uploads");
  for (let i = 0; i < 21; i++)
    source = await upload(
      request,
      source.id,
      `Reusable image ${String(i).padStart(2, "0")}.png`,
    );
  const target = await project(request, "Browse reusable media");
  await page.goto("/");
  await page.getByRole("button", { name: target.name, exact: true }).click();
  let fail = true;
  await page.route("**/api/workspace/assets?**", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic library outage" }),
      });
    else await route.continue();
  });
  await openTool(page, "Media & voice");
  await page.getByText("Reuse media from your studio", { exact: true }).click();
  const library = page.getByRole("region", { name: "Studio media library" });
  await expect(
    library.getByRole("alert", { name: "Studio media error" }),
  ).toHaveText("Synthetic library outage");
  fail = false;
  await library
    .getByRole("button", { name: "Refresh studio media", exact: true })
    .click();
  await expect(library.getByRole("listitem")).toHaveCount(20);
  await library
    .getByRole("button", { name: "Load more studio media", exact: true })
    .click();
  await expect(library.getByRole("listitem")).toHaveCount(21);
  await library.getByLabel("Search studio media").fill("Reusable image 20.png");
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await library.getByLabel("Studio media type").selectOption("video");
  await expect(
    library.getByText("No uploads match this search.", { exact: true }),
  ).toBeVisible();
  await library.getByLabel("Studio media type").selectOption("image");
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(
    await library.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBeTruthy();
  await library
    .getByRole("button", { name: "Reuse Reusable image 20.png", exact: true })
    .click();
  await expect(
    library.getByRole("button", {
      name: "Reusable image 20.png is already in this project",
      exact: true,
    }),
  ).toBeDisabled();
  const fresh = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  await page.setViewportSize({ width: 1280, height: 900 });
  const timeline = structuredClone(fresh.timeline!);
  const base = timeline.scenes[0];
  const full = {
    ...structuredClone(base),
    title: "Full scene",
    durationFrames: 75,
    layers: Array.from({ length: 20 }, (_, index) => ({
      ...base.layers[0],
      id: index === 0 ? "title" : `full-layer-${index}`,
      hidden: true,
    })),
  };
  const available = {
    ...structuredClone(base),
    id: crypto.randomUUID(),
    title: "Room for another image",
    durationFrames: 75,
  };
  timeline.scenes = [full, available];
  expect(
    (
      await request.patch(`/api/projects/${target.id}`, {
        data: { timeline, baseRevisionId: fresh.revisions.at(-1)!.id },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: target.name, exact: true }).click();
  const add = page.getByRole("button", {
    name: "Add to selected scene",
    exact: true,
  });
  await expect(add).toBeDisabled();
  await page.locator(".storyboard").getByRole("button").nth(1).click();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const saved = (await (
    await request.get(`/api/projects/${target.id}`)
  ).json()) as Project;
  expect(saved.timeline!.scenes[0].layers).toHaveLength(20);
  expect(saved.timeline!.scenes[1].layers).toHaveLength(2);
});
