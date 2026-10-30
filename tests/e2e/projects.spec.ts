import { test, expect, account } from "./fixtures";

test("project search/pages find older work and rename preserves history with private metadata CAS", async ({
  page,
  request,
  browser,
}) => {
  const older = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Old 100%_special",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  for (let i = 0; i < 21; i++)
    expect(
      (
        await request.post("/api/projects", {
          data: {
            prompt: `Recent creation ${i}`,
            duration: 5,
            format: "landscape",
            blank: true,
          },
        })
      ).status(),
    ).toBe(201);
  const first = await request.get("/api/projects?limit=20");
  expect((await first.json()).length).toBe(20);
  expect(first.headers()["x-total-count"]).toBe("22");
  expect(first.headers()["x-next-offset"]).toBe("20");
  expect((await request.get("/api/projects?limit=51")).status()).toBe(400);
  expect((await request.get("/api/projects?view=unknown")).status()).toBe(400);
  const compact = await request.get("/api/projects?limit=20&view=summary");
  expect(compact.status()).toBe(200);
  expect(compact.headers()["cache-control"]).toBe("private, no-store");
  expect(compact.headers()["x-total-count"]).toBe("22");
  expect(compact.headers()["x-next-offset"]).toBe("20");
  const summaries = await compact.json();
  expect(summaries).toHaveLength(20);
  expect(Object.keys(summaries[0]).sort()).toEqual([
    "createdAt",
    "id",
    "name",
    "revisionCount",
  ]);
  expect(summaries[0].revisionCount).toBe(1);
  expect((await compact.body()).length).toBeLessThan(
    (await first.body()).length / 3,
  );
  const listing = page.waitForResponse(
    (r) =>
      r.url().includes("/api/projects?") &&
      new URL(r.url()).searchParams.get("view") === "summary",
  );
  await page.goto("/");
  expect((await (await listing).json())[0].revisions).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "Old 100%_special", exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Load more projects", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Old 100%_special", exact: false }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search projects", exact: true })
    .fill("%_");
  await expect(page.locator(".project-item")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Old 100%_special", exact: false })
    .click();
  await page.getByLabel("Scene title", { exact: true }).fill("Edited scene");
  await page
    .getByRole("button", { name: "Rename project", exact: true })
    .click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Renamed 100%_special");
  await page
    .getByRole("button", { name: "Save project name", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Renamed 100%_special", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Edited scene",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  expect(
    (await (await request.get(`/api/projects/${older.id}`)).json()).name,
  ).toBe("Renamed 100%_special");
  const stale = await request.patch(`/api/projects/${older.id}/name`, {
    data: { name: "Overwrite", baseName: "Old 100%_special" },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("NAME_CONFLICT");
  const outsider = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    expect(
      (await outsider.request.get("/api/projects?view=summary")).status(),
    ).toBe(401);
    await account(outsider.request, "Outside rename");
    expect(
      await (await outsider.request.get("/api/projects?view=summary")).json(),
    ).toEqual([]);
    expect(
      (
        await outsider.request.patch(`/api/projects/${older.id}/name`, {
          data: { name: "Stolen", baseName: "Renamed 100%_special" },
        })
      ).status(),
    ).toBe(404);
    expect(
      await (await outsider.request.get("/api/projects?q=special")).json(),
    ).toEqual([]);
  } finally {
    await outsider.close();
  }
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search projects", exact: true })
    .fill("Renamed");
  await page
    .getByRole("button", { name: "Renamed 100%_special", exact: false })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  await page.getByRole("button", { name: "← Studio", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const library = page.getByRole("region", {
    name: "Your projects",
    exact: true,
  });
  await expect(library).toBeVisible();
  await library.getByLabel("Search projects", { exact: true }).fill("100%_");
  await expect(
    library.getByRole("button", { name: "Renamed 100%_special", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await library
    .getByRole("button", { name: "Renamed 100%_special", exact: true })
    .click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
});
