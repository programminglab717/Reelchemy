import { test, expect } from "./fixtures";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
test("full export storage can be reclaimed across projects without losing an unsaved film, with private paged retry and mobile review", async ({
  page,
  request,
}, testInfo) => {
  async function create(prompt: string) {
    const response = await request.post("/api/projects", {
      data: { prompt, blank: true, duration: 5, format: "landscape" },
    });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const retained = await create("Retained films across my studio"),
    editing = await create("My currently edited film");
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#318b75" },
  })
    .png()
    .toBuffer();
  const uploaded = await request.post(`/api/projects/${retained.id}/assets`, {
    multipart: {
      kind: "image",
      license: "Synthetic export-manager artwork",
      file: { name: "owned.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(uploaded.status()).toBe(201);
  const withSource = await uploaded.json(),
    sourcePath = `/api/projects/${retained.id}/assets/${withSource.assets[0].id}`,
    hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
    sourceHash = hash(await (await request.get(sourcePath)).body());
  const admin = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
  );
  try {
    // Explicitly known, zero-byte historical file fixtures exercise the real
    // 100-export allowance without rendering 99 unrelated videos or changing
    // any service limit. Only the selected export below is a genuine MP4.
    const owner = (
      admin
        .prepare("SELECT workspace_id FROM projects WHERE id=?")
        .get(retained.id) as { workspace_id: string }
    ).workspace_id;
    const ids = Array.from({ length: 99 }, () => randomUUID());
    for (const id of ids) {
      const dir = path.join(process.env.REELCHEMY_ARTIFACT_DIR!, id);
      await mkdir(dir);
      await writeFile(path.join(dir, "report.json"), "");
    }
    admin
      .transaction(() => {
        for (const id of ids) {
          admin
            .prepare("INSERT INTO jobs VALUES(?,?,'failed',?,?)")
            .run(
              id,
              retained.id,
              JSON.stringify({
                id,
                projectId: retained.id,
                status: "failed",
                createdAt: new Date().toISOString(),
                issues: [],
                report: { privateCanary: "PRIVATE_RETAINED_REPORT" },
              }),
              JSON.stringify(retained.timeline),
            );
          admin
            .prepare(
              "INSERT INTO export_storage_entries VALUES(?,?,?,0,1,0,536870912,0)",
            )
            .run(id, retained.id, owner);
        }
      })
      .immediate();
    async function render(projectId: string) {
      const response = await request.post(`/api/projects/${projectId}/render`, {
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
            (await (await request.get("/api/workspace/export-storage")).json())
              .reservedBytes,
        )
        .toBe(0);
      return job.id as string;
    }
    const real = await render(retained.id),
      videoHash = hash(
        await (await request.get(`/api/jobs/${real}/download`)).body(),
      );
    expect(videoHash).toHaveLength(64);
    const rejected = await request.post(`/api/projects/${editing.id}/render`, {
      data: {},
    });
    expect(rejected.status()).toBe(413);
    expect((await rejected.json()).code).toBe("EXPORT_STORAGE_LIMIT");
    await page.goto("/");
    await page.getByRole("button", { name: editing.name, exact: true }).click();
    await page.route(`**/api/projects/${editing.id}`, (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic retained-file draft outage" },
          })
        : route.continue(),
    );
    await page
      .getByLabel("Scene title", { exact: true })
      .fill("Keep this unsaved cross-project edit");
    await expect(
      page.getByText("Synthetic retained-file draft outage", { exact: true }),
    ).toBeVisible();
    const storage = page.getByRole("region", {
      name: "Studio export storage",
      exact: true,
    });
    await expect(storage).toContainText("100 of 100 retained exports");
    let fail = true;
    const pages: string[] = [];
    await page.route(
      "**/api/workspace/export-storage/files?**",
      async (route) => {
        if (fail) {
          fail = false;
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic retained-page outage" },
          });
        }
        const response = await route.fetch();
        pages.push(await response.text());
        await route.fulfill({ response });
      },
    );
    await storage
      .getByRole("button", { name: "Manage export files", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manage export files",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toContainText(
      "could not be loaded",
    );
    await dialog
      .getByRole("button", { name: "Refresh retained exports", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: `Review files for export ${real.slice(0, 8)}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(await dialog.locator(".retained-export-list > li").count()).toBe(20);
    await dialog
      .getByRole("button", { name: "Older retained exports", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: `Review files for export ${real.slice(0, 8)}`,
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "Newer retained exports", exact: true })
      .click();
    await dialog
      .getByRole("button", {
        name: `Review files for export ${real.slice(0, 8)}`,
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("link", {
        name: "Download MP4 before removal",
        exact: true,
      }),
    ).toHaveAttribute("href", `/api/jobs/${real}/download`);
    expect(
      hash(await (await request.get(`/api/jobs/${real}/download`)).body()),
    ).toBe(videoHash);
    const review = dialog.getByRole("region", {
      name: "Export file storage",
      exact: true,
    });
    await review
      .getByRole("button", { name: "Review export file removal", exact: true })
      .click();
    await expect(review.getByText(/This cannot be undone/)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog.screenshot({
      path: testInfo.outputPath("export-manager-mobile.png"),
    });
    await review
      .getByLabel("Export file removal confirmation")
      .fill("REMOVE EXPORT");
    await review
      .getByRole("button", {
        name: "Permanently remove export files",
        exact: true,
      })
      .click();
    await expect(review.getByRole("status")).toContainText(
      "Export files removed",
    );
    expect((await request.get(`/api/jobs/${real}/download`)).status()).toBe(
      404,
    );
    await dialog
      .getByRole("button", { name: "Close export manager", exact: true })
      .click();
    await expect(
      storage.getByRole("button", { name: "Manage export files", exact: true }),
    ).toBeFocused();
    await expect(storage).toContainText("99 of 100 retained exports");
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "Keep this unsaved cross-project edit",
    );
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeEnabled();
    expect(hash(await (await request.get(sourcePath)).body())).toBe(sourceHash);
    expect(
      (await (await request.get(`/api/projects/${editing.id}`)).json()).timeline
        .scenes[0].title,
    ).toBe("Scene 1");
    for (const body of pages) {
      expect(Buffer.byteLength(body)).toBeLessThan(12000);
      expect(body).not.toContain("PRIVATE_RETAINED_REPORT");
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
    expect(
      (await (await request.get(`/api/jobs/${real}`)).json()).files.state,
    ).toBe("completed");
  } finally {
    admin.close();
  }
});
