import { readFile } from "node:fs/promises";
import { test, expect, openTool } from "./fixtures";

test("a downloaded recovery copy can be loaded after browser storage is cleared and keeps version history", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic file recovery outage" }),
      });
    else await route.continue();
  });
  await openTool(page, "Scene & layers");
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("My downloaded story");
  await expect(
    page.getByText("Synthetic file recovery outage", { exact: true }),
  ).toBeVisible();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download unsaved draft", exact: true })
    .click();
  const download = await event;
  const buffer = await readFile((await download.path())!);
  const copy = JSON.parse(buffer.toString());
  expect(copy.version).toBe(1);
  expect(copy.timeline.scenes[0].title).toBe("My downloaded story");
  expect(copy.assets).toBeUndefined();
  expect(copy.revisions).toBeUndefined();
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("reelchemy:browser-draft:v1:"))
        localStorage.removeItem(key);
  });
  page.once("dialog", (d) => void d.accept());
  await page.reload();
  await page.unroute("**/api/projects/*");
  await page
    .getByRole("button", { name: "Untitled creation", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Browser recovery drafts" }),
  ).toHaveCount(0);
  await openTool(page, "Project");
  await page
    .getByLabel("Recover a downloaded draft", { exact: true })
    .setInputFiles({
      name: download.suggestedFilename(),
      mimeType: "application/json",
      buffer,
    });
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "My downloaded story",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  const after = await (
    await request.get(`/api/projects/${copy.projectId}`)
  ).json();
  expect(after.revisions).toHaveLength(2);
  expect(after.revisions[0].timeline.scenes[0].title).toBe("Scene 1");
});

test("invalid, oversized and different-project recovery files cannot overwrite saved work; legacy drafts still recover", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await openTool(page, "Design");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  const [p] = await (await request.get("/api/projects")).json();
  const input = page.getByLabel("Recover a downloaded draft", { exact: true });
  for (const invalid of [
    {
      name: "broken.json",
      buffer: Buffer.from("private malformed input canary"),
      error: "This file does not contain a supported timeline recovery copy.",
    },
    {
      name: "large.json",
      buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32),
      error: "Recovery files must be 2 MiB or smaller.",
    },
    {
      name: "another-project.json",
      buffer: Buffer.from(JSON.stringify({ ...p, id: crypto.randomUUID() })),
      error: "This recovery copy belongs to a different account or project.",
    },
  ]) {
    await openTool(page, "Project");
    await input.setInputFiles({
      name: invalid.name,
      mimeType: "application/json",
      buffer: invalid.buffer,
    });
    await expect(page.getByText(invalid.error, { exact: false })).toBeVisible();
    expect(await (await request.get(`/api/projects/${p.id}`)).json()).toEqual(
      p,
    );
    await openTool(page, "Scene & layers");
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "Scene 1",
    );
  }
  const legacy = structuredClone(p);
  legacy.timeline.scenes[0].title = "Legacy recovery works";
  await openTool(page, "Project");
  await input.setInputFiles({
    name: "older-unsaved-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await openTool(page, "Scene & layers");
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Legacy recovery works",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).revisions,
  ).toHaveLength(2);
});
