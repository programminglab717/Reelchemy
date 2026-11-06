import { test, expect } from "./fixtures";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

test("compact export pages reach an older real MP4, recover read failures and preserve unsaved edits across mobile browsing and new arrivals", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Export history browsing",
        blank: true,
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: project.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Approve & export MP4", exact: true })
    .click();
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 200000 });
  const job = (
    await (await request.get(`/api/projects/${project.id}/render`)).json()
  )[0];
  const originalVideo = await (
    await request.get(`/api/jobs/${job.id}/download`)
  ).body();
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const admin = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
  );
  function appendLegacy() {
    const id = randomUUID();
    admin
      .prepare(
        "INSERT INTO jobs(id,project_id,status,data,timeline) VALUES(?,?,?,?,?)",
      )
      .run(
        id,
        project.id,
        "cancelled",
        JSON.stringify({
          ...job,
          id,
          status: "cancelled",
          report: {
            privateReport: "PRIVATE_OLD_REPORT_CANARY" + "x".repeat(65536),
          },
        }),
        JSON.stringify(project.timeline),
      );
    // Synthetic historical rows have no files. Index that known empty fixture
    // state so this read-only history case does not leave the shared test
    // installation requiring an offline legacy export census.
    admin
      .prepare(
        "INSERT INTO export_storage_entries(job_id,project_id,workspace_id,retained_bytes,retained_files,reservation_bytes,ceiling_bytes,dirty) SELECT ?,p.id,p.workspace_id,0,0,0,536870912,0 FROM projects p WHERE p.id=?",
      )
      .run(id, project.id);
  }
  try {
    admin
      .transaction(() => {
        for (let i = 0; i < 44; i++) appendLegacy();
      })
      .immediate();
    let failPage = true,
      legacyListReads = 0,
      fullReads = 0;
    const pages: { bytes: number; text: string }[] = [];
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (
        req.method() === "GET" &&
        url.pathname === `/api/projects/${project.id}/render` &&
        !url.searchParams.has("view")
      )
        legacyListReads++;
    });
    await page.route(
      `**/api/projects/${project.id}/render?**`,
      async (route) => {
        // Keep failing until the user retries: development mode can mount the
        // history twice and would otherwise hide the first failed read.
        if (failPage) {
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic unavailable history" },
          });
        }
        const response = await route.fetch(),
          text = await response.text();
        pages.push({ bytes: Buffer.byteLength(text), text });
        await route.fulfill({ response });
      },
    );
    await page.goto("/");
    await page.getByRole("button", { name: project.name, exact: true }).click();
    const history = page.getByRole("region", {
      name: "Export history",
      exact: true,
    });
    await expect(
      history.getByRole("alert", { name: "Export history error", exact: true }),
    ).toContainText("Could not load export history");
    failPage = false;
    await history
      .getByRole("button", { name: "Refresh export history", exact: true })
      .click();
    await expect(history).toContainText("45 retained exports");
    await page.route(`**/api/projects/${project.id}`, async (route) => {
      if (route.request().method() === "PATCH")
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic save outage" },
        });
      return route.continue();
    });
    const saveRefused = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/projects/${project.id}` &&
        response.request().method() === "PATCH",
    );
    await page
      .getByLabel("Scene title", { exact: true })
      .fill("My unsaved film stays here");
    expect((await saveRefused).status()).toBe(503);
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic save outage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Save status", exact: true }),
    ).toHaveText("Unsaved changes");
    await history
      .getByRole("button", { name: "Older exports", exact: true })
      .click();
    await expect(history).toContainText("Page 2");
    appendLegacy(); // An independent retained record arrives after this view's anchor.
    await history
      .getByRole("button", { name: "Older exports", exact: true })
      .click();
    await expect(history).toContainText("Page 3");
    await expect(history).toContainText("45 retained exports");
    await page.route(`**/api/jobs/${job.id}`, async (route) => {
      if (++fullReads === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic report outage" },
        });
      return route.continue();
    });
    const older = history.getByRole("button", {
      name: new RegExp(job.id.slice(0, 6)),
    });
    await older.click();
    await expect(
      history.getByRole("alert", { name: "Export history error", exact: true }),
    ).toContainText("Could not open this export");
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "My unsaved film stays here",
    );
    await older.click();
    await expect(
      page.getByText("Your film is ready.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
      "My unsaved film stays here",
    );
    expect(fullReads).toBe(2);
    expect(
      hash(await (await request.get(`/api/jobs/${job.id}/download`)).body()),
    ).toBe(hash(originalVideo));
    expect(
      (await (await request.get(`/api/projects/${project.id}`)).json()).timeline
        .scenes[0].title,
    ).toBe("Scene 1");
    await page.setViewportSize({ width: 390, height: 844 });
    await history
      .getByRole("button", { name: "Newer exports", exact: true })
      .click();
    await expect(history).toContainText("Page 2");
    await history
      .getByRole("button", { name: "Refresh export history", exact: true })
      .click();
    await expect(history).toContainText("46 retained exports");
    await expect(history).toContainText("Page 1");
    await history.screenshot({
      path: `${process.env.REELCHEMY_ARTIFACT_DIR}/export-history-mobile.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(legacyListReads).toBe(0);
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const response of pages) {
      expect(response.bytes).toBeLessThan(10000);
      expect(response.text).not.toContain("PRIVATE_OLD_REPORT_CANARY");
    }
    await page.unroute(`**/api/projects/${project.id}`);
    await page.getByRole("button", { name: "Save now", exact: true }).click();
    await expect(
      page.getByRole("status", { name: "Save status", exact: true }),
    ).toHaveText("All changes saved");
    expect(
      (await (await request.get(`/api/projects/${project.id}`)).json()).timeline
        .scenes[0].title,
    ).toBe("My unsaved film stays here");
  } finally {
    admin.close();
  }
});
