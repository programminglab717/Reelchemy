import { test, expect, account } from "./fixtures";
import { open, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
test("shared saturation keeps chosen uploads and private edits usable, permits zero-byte reuse/export, and retries after confirmed reclamation", async ({
  page,
  request,
  browser,
}) => {
  const source = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Shared storage source",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: source.name, exact: true }).click();
  const png = await sharp({
    create: { width: 24, height: 18, channels: 3, background: "#2eb0a6" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("Upload image", { exact: true }).setInputFiles({
    name: "reusable-shared.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page
    .getByPlaceholder("I own this image")
    .fill("Owned reusable artwork");
  await page.getByRole("button", { name: "Upload asset", exact: true }).click();
  await expect(
    page.getByText("reusable-shared.png", { exact: true }),
  ).toBeVisible();
  const owned = await (await request.get(`/api/projects/${source.id}`)).json(),
    asset = owned.assets[0],
    sourceBytes = await (
      await request.get(`/api/projects/${source.id}/assets/${asset.id}`)
    ).body(),
    sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const target = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Shared storage target",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  const holder = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  let holderProjectId: string | undefined;
  try {
    await account(holder.request, "Private capacity holder");
    const legacy = await (
      await holder.request.post("/api/projects", {
        data: {
          prompt: "PRIVATE_FOREIGN_STORAGE_CANARY",
          blank: true,
          duration: 5,
          format: "landscape",
        },
      })
    ).json();
    holderProjectId = legacy.id;
    // A sparse, private legacy source fills the logical retained-byte ceiling
    // without allocating gigabytes or changing the production policy/guards.
    const id = randomUUID(),
      directory = path.join(process.env.REELCHEMY_DATA_DIR!, "assets"),
      file = path.join(directory, id),
      sharedLimit = Number(process.env.REELCHEMY_MEDIA_SHARED_STORAGE_BYTES);
    await mkdir(directory, { recursive: true });
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.truncate(sharedLimit);
    } finally {
      await handle.close();
    }
    const admin = new Database(
      path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
    );
    try {
      const saved = JSON.parse(
        (
          admin
            .prepare("SELECT data FROM projects WHERE id=?")
            .get(legacy.id) as { data: string }
        ).data,
      );
      saved.assets = [
        {
          id,
          name: "PRIVATE_FOREIGN_ASSET_CANARY",
          mime: "image/png",
          source: "Retained legacy fixture",
          license: "Owned",
          bytes: sharedLimit,
          createdAt: new Date().toISOString(),
        },
      ];
      admin
        .transaction(() => {
          admin
            .prepare("UPDATE projects SET data=? WHERE id=?")
            .run(JSON.stringify(saved), legacy.id);
          admin
            .prepare("INSERT INTO media_sizes(asset_id,bytes) VALUES(?,?)")
            .run(id, sharedLimit);
        })
        .immediate();
    } finally {
      admin.close();
    }
    await page.goto("/");
    await page.getByRole("button", { name: target.name, exact: true }).click();
    await page
      .getByLabel("Scene title", { exact: true })
      .fill("Editing remains available at shared capacity");
    await expect(
      page.getByRole("status", { name: "Save status", exact: true }),
    ).toHaveText("All changes saved");
    await page.getByLabel("Upload image", { exact: true }).setInputFiles({
      name: "kept-after-capacity.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page
      .getByPlaceholder("I own this image")
      .fill("Owned second artwork");
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/projects/${target.id}/assets`) &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Upload asset", exact: true })
      .click();
    const response = await denied;
    expect(response.status()).toBe(503);
    const failure = await response.json();
    expect(failure.code).toBe("MEDIA_SERVICE_STORAGE_LIMIT");
    expect(failure).not.toHaveProperty("usedBytes");
    expect(failure).not.toHaveProperty("limitBytes");
    await expect(
      page.getByText(/Shared media storage is full/, { exact: false }),
    ).toBeVisible();
    expect(
      await page
        .getByLabel("Upload image", { exact: true })
        .evaluate((element: HTMLInputElement) => element.files?.length),
    ).toBe(1);
    await expect(page.getByPlaceholder("I own this image")).toHaveValue(
      "Owned second artwork",
    );
    await expect(
      page.getByText("PRIVATE_FOREIGN_STORAGE_CANARY", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByText("Reuse media from your studio", { exact: true })
      .click();
    const library = page.getByRole("region", {
      name: "Studio media library",
      exact: true,
    });
    await library
      .getByRole("button", { name: "Reuse reusable-shared.png", exact: true })
      .click();
    await expect(
      library.getByRole("button", {
        name: "reusable-shared.png is already in this project",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      (await (await request.get("/api/workspace/storage")).json()).usedBytes,
    ).toBe(sourceBytes.length);
    await expect(
      page.getByText("PRIVATE_FOREIGN_ASSET_CANARY", { exact: true }),
    ).not.toBeVisible();
    await page
      .getByRole("button", { name: "Add to selected scene", exact: true })
      .click();
    await expect(
      page.getByRole("status", { name: "Save status", exact: true }),
    ).toHaveText("All changes saved");
    await page
      .getByRole("button", { name: "Approve & export MP4", exact: true })
      .click();
    await expect(
      page.getByText("Your film is ready.", { exact: true }),
    ).toBeVisible({ timeout: 200000 });
    expect(
      (await holder.request.delete(`/api/projects/${legacy.id}/trash`)).ok(),
    ).toBe(true);
    const deletion = await holder.request.post(
      `/api/projects/${legacy.id}/deletion`,
      { data: { confirmation: "DELETE" } },
    );
    expect(deletion.status()).toBe(202);
    await expect
      .poll(
        async () => {
          const result = await holder.request.get(
            `/api/projects/${legacy.id}/deletion`,
          );
          return result.ok() ? (await result.json()).state : "unavailable";
        },
        { timeout: 30000 },
      )
      .toBe("completed");
    expect(
      await stat(file).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await page
        .getByLabel("Upload image", { exact: true })
        .evaluate((element: HTMLInputElement) => element.files?.length),
    ).toBe(1);
    await page
      .getByRole("button", { name: "Upload asset", exact: true })
      .click();
    await expect(
      page.getByText("kept-after-capacity.png", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "Editing remains available at shared capacity",
    );
    expect(
      createHash("sha256")
        .update(
          await (
            await request.get(`/api/projects/${source.id}/assets/${asset.id}`)
          ).body(),
        )
        .digest("hex"),
    ).toBe(sourceHash);
    const saved = await (
      await request.get(`/api/projects/${target.id}`)
    ).json();
    expect(saved.assets).toHaveLength(2);
    const jobs = await (
      await request.get(`/api/projects/${target.id}/render`)
    ).json();
    expect(jobs[0].status).toBe("completed");
    expect(
      (await (await request.get(`/api/jobs/${jobs[0].id}/download`)).body())
        .length,
    ).toBeGreaterThan(1000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${process.env.REELCHEMY_ARTIFACT_DIR}/shared-storage-recovery-mobile.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    if (holderProjectId) {
      try {
        const current = await holder.request.get(
          `/api/projects/${holderProjectId}/deletion`,
        );
        if (!current.ok() || (await current.json()).state !== "completed") {
          await holder.request.delete(`/api/projects/${holderProjectId}/trash`);
          await holder.request.post(
            `/api/projects/${holderProjectId}/deletion`,
            { data: { confirmation: "DELETE" } },
          );
          await expect
            .poll(
              async () => {
                const response = await holder.request.get(
                  `/api/projects/${holderProjectId}/deletion`,
                );
                return response.ok()
                  ? (await response.json()).state
                  : "unavailable";
              },
              { timeout: 30000 },
            )
            .toBe("completed");
        }
      } catch {
        /* Preserve the original test failure if its owned cleanup also fails. */
      }
    }
    await holder.close();
  }
});
