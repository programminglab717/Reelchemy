import { test, expect, openTool } from "./fixtures";
import { encodedFrame } from "./media-frame";

for (const format of ["landscape", "portrait"] as const)
  test(`${format} native HD survives save, undo, reload and archive and exports the actual selected dimensions`, async ({
    page,
    request,
  }, testInfo) => {
    const response = await request.post("/api/projects", {
      data: { prompt: `Native HD ${format}`, duration: 5, format, blank: true },
    });
    expect(response.status()).toBe(201);
    const project = await response.json();
    const originalLayers = structuredClone(project.timeline.scenes[0].layers);
    await page.goto("/");
    await page
      .getByRole("button", { name: project.name, exact: false })
      .click();
    const resolution = page.getByLabel("Export resolution", { exact: true });
    const saved = page.getByRole("status", { name: "Save status" });
    await expect(resolution).toHaveValue("standard");
    await openTool(page, "Export");
    await resolution.selectOption("1080p");
    await expect(saved).toHaveText("All changes saved");
    const read = async () =>
      (await (await request.get(`/api/projects/${project.id}`)).json())
        .timeline;
    expect((await read()).exportResolution).toBe("1080p");
    expect((await read()).scenes[0].layers).toEqual(originalLayers);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(resolution).toHaveValue("standard");
    await expect(saved).toHaveText("All changes saved");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(resolution).toHaveValue("1080p");
    await expect(saved).toHaveText("All changes saved");
    await page.reload();
    await page
      .getByRole("button", { name: project.name, exact: false })
      .click();
    await expect(resolution).toHaveValue("1080p");
    const archive = await request.get(`/api/projects/${project.id}/archive`);
    expect(archive.ok()).toBeTruthy();
    const imported = await request.post("/api/projects/import", {
      data: await archive.body(),
      headers: { "content-type": "application/zip" },
    });
    expect(imported.status()).toBe(201);
    const copy = await imported.json();
    expect(copy.timeline.exportResolution).toBe("1080p");
    expect(copy.revisions.at(-1).timeline.exportResolution).toBe("1080p");
    await page.setViewportSize({ width: 390, height: 844 });
    await openTool(page, "Export");
    await resolution.scrollIntoViewIfNeeded();
    expect((await resolution.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`${format}-hd-mobile.png`),
      fullPage: true,
    });
    const admitted = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${project.id}/render`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    const job = await (await admitted).json();
    await expect(page.getByText("Your film is ready.")).toBeVisible({
      timeout: 180000,
    });
    const reportResponse = await request.get(
      `/api/jobs/${job.id}/evidence/report.json`,
    );
    expect(reportResponse.ok()).toBeTruthy();
    const report = await reportResponse.json();
    expect(report.timeline.exportResolution).toBe("1080p");
    expect(report.export.fps).toBe(30);
    expect(report.export.duration).toBeCloseTo(5, 2);
    const frame = await encodedFrame(request, job.id, 2);
    const dimensions = format === "landscape" ? [1920, 1080] : [1080, 1920];
    expect([frame.width, frame.height]).toEqual(dimensions);
    expect([report.export.width, report.export.height]).toEqual(dimensions);
    const download = await request.get(`/api/jobs/${job.id}/download`);
    expect(download.headers()["cache-control"]).toContain("no-store");
    expect((await read()).scenes[0].layers).toEqual(originalLayers);
  });
