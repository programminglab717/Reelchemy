import { test, expect } from "./fixtures";
import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
test("reviewed file removal rejects stale consent, replays a lost response, preserves unsaved edits/media/other exports and permits a fresh MP4", async ({
  page,
  request,
}, testInfo) => {
  const created = await (
      await request.post("/api/projects", {
        data: {
          prompt: "Reviewed export cleanup",
          blank: true,
          duration: 5,
          format: "landscape",
        },
      })
    ).json(),
    png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#318b75" },
    })
      .png()
      .toBuffer();
  const uploaded = await request.post(`/api/projects/${created.id}/assets`, {
    multipart: {
      kind: "image",
      license: "Owned synthetic cleanup artwork",
      file: { name: "source.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(uploaded.status()).toBe(201);
  const project = await uploaded.json(),
    asset = project.assets[0],
    sourcePath = `/api/projects/${project.id}/assets/${asset.id}`,
    hash = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
    originalSource = hash(await (await request.get(sourcePath)).body()),
    storage = await (await request.get("/api/workspace/storage")).json();
  async function render() {
    const response = await request.post(`/api/projects/${project.id}/render`, {
      data: {},
    });
    expect(response.status()).toBe(202);
    const job = await response.json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${job.id}`)).json()).status,
        { timeout: 180000 },
      )
      .toBe("completed");
    return job.id as string;
  }
  const selected = await render(),
    other = await render(),
    otherHash = hash(
      await (await request.get(`/api/jobs/${other}/download`)).body(),
    ),
    savedBefore = await (
      await request.get(`/api/projects/${project.id}`)
    ).json();
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page.route(`**/api/projects/${project.id}`, async (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          json: { error: "Synthetic cleanup draft outage" },
        })
      : route.continue(),
  );
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Keep my unsaved cleanup film");
  await expect(
    page.getByText("Synthetic cleanup draft outage", { exact: true }),
  ).toBeVisible();
  // Timeline edits deliberately clear the selected output. Reopen its saved
  // report only after the local edit settles, avoiding a race with that reset.
  await page
    .getByRole("region", { name: "Export history", exact: true })
    .getByRole("button", { name: new RegExp(selected.slice(0, 6)) })
    .click();
  const panel = page.getByRole("region", {
    name: "Export file storage",
    exact: true,
  });
  await expect(
    panel.getByRole("button", {
      name: "Review export file removal",
      exact: true,
    }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Review export file removal", exact: true })
    .click();
  await expect(panel.getByText(/This cannot be undone/)).toBeVisible();
  await appendFile(
    path.join(process.env.REELCHEMY_ARTIFACT_DIR!, selected, "report.json"),
    "\n",
  );
  await panel
    .getByLabel("Export file removal confirmation")
    .fill("REMOVE EXPORT");
  await panel
    .getByRole("button", {
      name: "Permanently remove export files",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "changed after this review",
  );
  expect((await request.get(`/api/jobs/${selected}/download`)).status()).toBe(
    200,
  );
  await panel
    .getByRole("button", { name: "Review current files again", exact: true })
    .click();
  await expect(
    panel.getByLabel("Export file removal confirmation"),
  ).toHaveValue("");
  await panel
    .getByLabel("Export file removal confirmation")
    .fill("REMOVE EXPORT");
  let lose = true;
  const digests: string[] = [];
  await page.route(`**/api/jobs/${selected}/files`, async (route) => {
    if (
      route.request().method() !== "POST" ||
      route.request().postDataJSON().action !== "remove"
    )
      return route.continue();
    digests.push(route.request().postDataJSON().digest);
    if (lose) {
      lose = false;
      const r = await route.fetch();
      expect(r.status()).toBe(202);
      await route.abort("failed");
    } else await route.continue();
  });
  await panel
    .getByRole("button", {
      name: "Permanently remove export files",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "response was interrupted",
  );
  await panel
    .getByRole("button", {
      name: "Permanently remove export files",
      exact: true,
    })
    .click();
  await expect(panel.getByRole("status")).toContainText("Export files removed");
  expect(digests).toHaveLength(2);
  expect(digests[0]).toBe(digests[1]);
  for (const suffix of ["download", "thumbnail", "evidence/report.json"])
    expect(
      (await request.get(`/api/jobs/${selected}/${suffix}`)).status(),
    ).toBe(404);
  expect(
    hash(await (await request.get(`/api/jobs/${other}/download`)).body()),
  ).toBe(otherHash);
  expect(hash(await (await request.get(sourcePath)).body())).toBe(
    originalSource,
  );
  expect(
    (await (await request.get("/api/workspace/storage")).json()).usedBytes,
  ).toBe(storage.usedBytes);
  const savedAfter = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  expect(savedAfter.timeline).toEqual(savedBefore.timeline);
  expect(savedAfter.revisions).toEqual(savedBefore.revisions);
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Keep my unsaved cleanup film",
  );
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel.getByRole("status")).toContainText("Export files removed");
  await testInfo.attach("mobile-layout", {
    contentType: "application/json",
    body: JSON.stringify(
      await page.evaluate(() => ({
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        overflow: [...document.querySelectorAll("body *")]
          .map((element) => ({
            tag: element.tagName,
            class: element.className,
            text: element.textContent?.trim().slice(0, 80),
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
          }))
          .filter(
            (item) => item.right > window.innerWidth + 1 || item.left < -1,
          ),
      })),
      null,
      2,
    ),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("export-files-mobile.png"),
    fullPage: true,
  });
  await page.unroute(`**/api/projects/${project.id}`);
  await page.getByRole("button", { name: "Save now", exact: true }).click();
  await expect(
    page.getByRole("status", { name: "Save status", exact: true }),
  ).toHaveText("All changes saved");
  const fresh = await render();
  expect(fresh).not.toBe(selected);
  expect((await request.get(`/api/jobs/${fresh}/download`)).status()).toBe(200);
  const removed = await (await request.get(`/api/jobs/${selected}`)).json();
  expect(removed.status).toBe("completed");
  expect(removed.files.state).toBe("completed");
  expect(
    hash(
      await readFile(
        path.join(process.env.REELCHEMY_DATA_DIR!, "assets", asset.id),
      ),
    ),
  ).toBe(originalSource);
});
