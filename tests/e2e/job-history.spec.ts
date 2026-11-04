import { test, expect } from "./fixtures";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import path from "node:path";
import sharp from "sharp";
test("full activity storage retires only reviewed details, retries uncertain consent and keeps unsaved work, originals and another real MP4 usable on mobile", async ({
  page,
  request,
}, testInfo) => {
  async function create(prompt: string) {
    const response = await request.post("/api/projects", {
      data: { prompt, duration: 5, format: "landscape", blank: true },
    });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const retained = await create("Earlier film for activity cleanup"),
    keep = await create("Keep this other finished MP4"),
    editing = await create("Keep my currently edited film"),
    png = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#318b75" },
    })
      .png()
      .toBuffer();
  const upload = await request.post(`/api/projects/${retained.id}/assets`, {
    multipart: {
      kind: "image",
      license: "Owned synthetic activity artwork",
      file: { name: "original.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(upload.status()).toBe(201);
  const uploaded = await upload.json(),
    asset = uploaded.assets[0],
    timeline = uploaded.timeline;
  timeline.scenes[0].layers = [
    {
      ...timeline.scenes[0].layers[0],
      id: "picture",
      kind: "image",
      assetId: asset.id,
      text: "",
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
      animation: "none",
    },
  ];
  const saved = await request.patch(`/api/projects/${retained.id}`, {
    data: { timeline, baseRevisionId: uploaded.revisions.at(-1)?.id ?? null },
  });
  expect(saved.status()).toBe(200);
  const originalFilm = await saved.json(),
    sourcePath = `/api/projects/${retained.id}/assets/${asset.id}`,
    hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
    sourceHash = hash(await (await request.get(sourcePath)).body()),
    sourceUsage = await (await request.get("/api/workspace/storage")).json();
  async function render(id: string) {
    const response = await request.post(`/api/projects/${id}/render`, {
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
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/workspace/job-history")).json())
            .reservedBytes,
      )
      .toBe(0);
    return job.id as string;
  }
  const retired = await render(retained.id),
    other = await render(keep.id),
    otherHash = hash(
      await (await request.get(`/api/jobs/${other}/download`)).body(),
    );
  await testInfo.attach("old-export-before-reviewed-removal.mp4", {
    body: await (await request.get(`/api/jobs/${retired}/download`)).body(),
    contentType: "video/mp4",
  });
  const removalReview = await request.post(`/api/jobs/${retired}/files`, {
    data: { action: "preview" },
  });
  expect(removalReview.status()).toBe(200);
  const remove = await request.post(`/api/jobs/${retired}/files`, {
    data: {
      action: "remove",
      digest: (await removalReview.json()).preview.digest,
      confirmation: "REMOVE EXPORT",
    },
  });
  expect(remove.status()).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/jobs/${retired}/files`)).json()).removal
          ?.state,
    )
    .toBe("completed");
  const archive = await request.get(`/api/jobs/${retired}/history`);
  expect(archive.status()).toBe(200);
  const archiveBytes = await archive.body();
  expect(
    JSON.parse(archiveBytes.toString()).timeline.scenes[0].layers[0].assetId,
  ).toBe(asset.id);
  await testInfo.attach("activity-before-retirement.json", {
    body: archiveBytes,
    contentType: "application/json",
  });
  const admin = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
  );
  try {
    const owner = (
        admin
          .prepare("SELECT workspace_id FROM projects WHERE id=?")
          .get(retained.id) as { workspace_id: string }
      ).workspace_id,
      detail = "HISTORICAL_ACTIVITY_CANARY" + "x".repeat(65536);
    // Known historical details fill the real default 500-record allowance.
    // They have no generated files or active jobs; all service limits and real
    // request budgets remain unchanged. The two videos above are genuine.
    admin
      .transaction(() => {
        for (let index = 0; index < 498; index++) {
          const id = randomUUID();
          admin.prepare("INSERT INTO jobs VALUES(?,?,'failed',?,'{}')").run(
            id,
            retained.id,
            JSON.stringify({
              id,
              projectId: retained.id,
              status: "failed",
              progress: 0,
              error: null,
              createdAt: "2026-10-01T00:00:00.000Z",
              issues: [],
              report: { private: detail },
              attempts: 0,
              retryCount: 0,
              stage: "Historical fixture",
              events: [],
            }),
          );
          admin
            .prepare(
              "INSERT INTO export_storage_entries VALUES(?,?,?,0,0,0,536870912,0)",
            )
            .run(id, retained.id, owner);
        }
      })
      .immediate();
    const before = await (
      await request.get("/api/workspace/job-history")
    ).json();
    expect(before.fullJobs).toBe(500);
    const blocked = await request.post(`/api/projects/${editing.id}/render`, {
      data: {},
    });
    expect(blocked.status()).toBe(413);
    expect((await blocked.json()).code).toBe("JOB_HISTORY_LIMIT");
    await page.goto("/");
    await page.getByRole("button", { name: editing.name, exact: true }).click();
    await page.route(`**/api/projects/${editing.id}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic activity-review save outage" },
          })
        : route.continue(),
    );
    await page
      .getByLabel("Scene title", { exact: true })
      .fill("Keep my unsaved activity-review film");
    await expect(
      page.getByText("Synthetic activity-review save outage", { exact: true }),
    ).toBeVisible();
    const allowance = page.getByRole("region", {
      name: "Export activity allowance",
      exact: true,
    });
    await expect(allowance).toContainText("500 of 500 detailed exports");
    let fail = true;
    const pages: string[] = [];
    await page.route(
      "**/api/workspace/job-history/records?**",
      async (route) => {
        if (fail) {
          fail = false;
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic activity-page outage" },
          });
        }
        const response = await route.fetch();
        pages.push(await response.text());
        await route.fulfill({ response });
      },
    );
    await allowance
      .getByRole("button", { name: "Manage export activity", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manage export activity",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "could not be loaded",
    );
    await dialog
      .getByRole("button", { name: "Refresh export activity", exact: true })
      .click();
    const target = dialog.getByRole("button", {
      name: `Review activity for export ${retired.slice(0, 8)}`,
      exact: true,
    });
    for (let index = 0; index < 24; index++) {
      const first = dialog.locator(".retained-export-list > li").first(),
        previous = await first.innerText();
      await dialog
        .getByRole("button", { name: "Older export activity", exact: true })
        .click();
      await expect(first).not.toHaveText(previous);
    }
    await expect(target).toBeVisible();
    await target.click();
    const selected = dialog.getByRole("region", {
      name: "Selected export activity",
      exact: true,
    });
    await expect(
      selected.getByRole("heading", {
        name: `${retained.name} · export ${retired.slice(0, 8)}`,
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      selected.getByRole("link", {
        name: "Download export activity JSON",
        exact: true,
      }),
    ).toHaveAttribute("href", `/api/jobs/${retired}/history`);
    await selected
      .getByRole("button", {
        name: "Review export detail retirement",
        exact: true,
      })
      .click();
    await expect(selected.getByRole("status")).toContainText(
      "cannot be undone",
    );
    admin
      .prepare(
        "UPDATE jobs SET data=json_set(data,'$.error','A later diagnostic annotation') WHERE id=?",
      )
      .run(retired);
    await selected
      .getByLabel("Export detail retirement confirmation")
      .fill("RETIRE EXPORT DETAILS");
    await selected
      .getByRole("button", {
        name: "Retire reviewed export details",
        exact: true,
      })
      .click();
    await expect(selected.getByRole("alert")).toContainText(
      "changed after your review",
    );
    await selected
      .getByRole("button", {
        name: "Review current export details again",
        exact: true,
      })
      .click();
    await expect(
      selected.getByLabel("Export detail retirement confirmation"),
    ).toHaveValue("");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.screenshot({
      path: testInfo.outputPath("activity-retirement-mobile.png"),
    });
    await selected
      .getByLabel("Export detail retirement confirmation")
      .fill("RETIRE EXPORT DETAILS");
    let lose = true;
    const digests: string[] = [];
    await page.route(`**/api/jobs/${retired}/history`, async (route) => {
      if (
        route.request().method() !== "POST" ||
        route.request().postDataJSON().action !== "retire"
      )
        return route.continue();
      digests.push(route.request().postDataJSON().digest);
      if (lose) {
        lose = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await selected
      .getByRole("button", {
        name: "Retire reviewed export details",
        exact: true,
      })
      .click();
    await expect(selected.getByRole("alert")).toContainText(
      "response was interrupted",
    );
    await selected
      .getByRole("button", {
        name: "Retire reviewed export details",
        exact: true,
      })
      .click();
    await expect(selected.getByRole("status")).toContainText(
      "Export details retired",
    );
    expect(digests).toHaveLength(2);
    expect(digests[0]).toBe(digests[1]);
    await dialog
      .getByRole("button", { name: "Close activity manager", exact: true })
      .click();
    await expect(
      allowance.getByRole("button", {
        name: "Manage export activity",
        exact: true,
      }),
    ).toBeFocused();
    await expect(allowance).toContainText("499 of 500 detailed exports");
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "Keep my unsaved activity-review film",
    );
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    expect(hash(await (await request.get(sourcePath)).body())).toBe(sourceHash);
    expect(
      hash(await (await request.get(`/api/jobs/${other}/download`)).body()),
    ).toBe(otherHash);
    expect(
      (await (await request.get("/api/workspace/storage")).json()).usedBytes,
    ).toBe(sourceUsage.usedBytes);
    const old = await (await request.get(`/api/jobs/${retired}`)).json();
    expect(old.retired).toBe(true);
    expect(old.report).toBeNull();
    expect((await request.get(`/api/jobs/${retired}/download`)).status()).toBe(
      404,
    );
    const savedFilm = await (
      await request.get(`/api/projects/${retained.id}`)
    ).json();
    expect(savedFilm.timeline).toEqual(originalFilm.timeline);
    expect(savedFilm.revisions).toEqual(originalFilm.revisions);
    expect(
      (await (await request.get(`/api/projects/${editing.id}`)).json()).timeline
        .scenes[0].title,
    ).toBe("Scene 1");
    for (const body of pages) {
      expect(Buffer.byteLength(body)).toBeLessThan(14000);
      expect(body).not.toContain("HISTORICAL_ACTIVITY_CANARY");
      expect(body).not.toContain("timeline");
    }
    await page.unroute(`**/api/projects/${editing.id}`);
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Save status", exact: true }),
    ).toHaveText("All changes saved");
    const fresh = await render(editing.id);
    expect((await request.get(`/api/jobs/${fresh}/download`)).status()).toBe(
      200,
    );
    const after = await (
      await request.get("/api/workspace/job-history")
    ).json();
    expect(after.fullJobs).toBe(500);
    expect(after.retiredJobs).toBe(1);
    expect(after.reservedBytes).toBe(0);
  } finally {
    admin.close();
  }
});
