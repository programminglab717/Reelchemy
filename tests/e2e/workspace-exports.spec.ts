import { test, expect, account } from "./fixtures";
test("Studio exports shows private capacity, cancels queued work and frees admission without blocking another studio", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(240000);
  const other = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  const ownJobs: string[] = [],
    otherJobs: string[] = [];
  try {
    await account(other.request, "Other export studio");
    const projects = [];
    for (const [prompt, duration] of [
      ["Long export in this studio", 60],
      ["Queued second export", 5],
      ["Retry after cancellation", 5],
    ] as const) {
      const response = await request.post("/api/projects", {
        data: { prompt, duration, format: "landscape", blank: true },
      });
      expect(response.status()).toBe(201);
      projects.push(await response.json());
    }
    for (const p of projects.slice(0, 2)) {
      const response = await request.post(`/api/projects/${p.id}/render`);
      expect(response.status()).toBe(202);
      ownJobs.push((await response.json()).id);
    }
    const key = crypto.randomUUID();
    const denied = await request.post(
      `/api/projects/${projects[2].id}/render`,
      {
        headers: { "idempotency-key": key },
        data: { baseRevisionId: projects[2].revisions.at(-1).id },
      },
    );
    expect(denied.status()).toBe(429);
    expect(denied.headers()["retry-after"]).toBe("30");
    expect(await denied.json()).toMatchObject({
      code: "EXPORT_CAPACITY",
      scope: "studio",
    });
    const theirs = await (
      await other.request.post("/api/projects", {
        data: {
          prompt: "Other private export",
          duration: 5,
          format: "landscape",
          blank: true,
        },
      })
    ).json();
    const accepted = await other.request.post(
      `/api/projects/${theirs.id}/render`,
    );
    expect(accepted.status()).toBe(202);
    otherJobs.push((await accepted.json()).id);
    const foreign = await (
      await other.request.get("/api/workspace/exports")
    ).json();
    expect(
      foreign.exports.map((j: { projectId: string }) => j.projectId),
    ).toEqual([theirs.id]);
    await page.goto("/");
    const panel = page.getByRole("region", {
      name: "Studio exports",
      exact: true,
    });
    await expect(
      panel.getByRole("status", { name: "Studio export usage" }),
    ).toHaveText("2 of 2 active exports");
    await expect(
      panel.getByText("Other private export", { exact: true }),
    ).toHaveCount(0);
    await panel
      .getByRole("button", {
        name: "Cancel export Queued second export",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("status", { name: "Studio export usage" }),
    ).toHaveText("1 of 2 active exports");
    expect(
      (await (await request.get(`/api/jobs/${ownJobs[1]}`)).json()).status,
    ).toBe("cancelled");
    const retried = await request.post(
      `/api/projects/${projects[2].id}/render`,
      {
        headers: { "idempotency-key": key },
        data: { baseRevisionId: projects[2].revisions.at(-1).id },
      },
    );
    expect(retried.status()).toBe(202);
    ownJobs.push((await retried.json()).id);
    await panel
      .getByRole("button", { name: "Refresh Studio exports", exact: true })
      .click();
    await expect(
      panel.getByText("Retry after cancellation", { exact: true }),
    ).toBeVisible();
    await panel
      .getByRole("button", {
        name: "Open export project Long export in this studio",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Long export in this studio",
        exact: true,
      }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel
      .getByRole("button", {
        name: "Cancel export Long export in this studio",
        exact: true,
      })
      .click();
    await panel
      .getByRole("button", {
        name: "Cancel export Retry after cancellation",
        exact: true,
      })
      .click();
    await expect(
      panel.getByRole("status", { name: "Studio export usage" }),
    ).toHaveText("0 of 2 active exports");
  } finally {
    for (const id of ownJobs) await request.delete(`/api/jobs/${id}`);
    for (const id of otherJobs) await other.request.delete(`/api/jobs/${id}`);
    await other.close();
  }
});

test("Studio exports can recover from an unavailable check without blocking manual editing", async ({
  page,
}) => {
  let unavailable = true;
  await page.route("**/api/workspace/exports", (route) =>
    unavailable
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Temporary export queue outage" }),
        })
      : route.continue(),
  );
  await page.goto("/");
  const panel = page.getByRole("region", {
    name: "Studio exports",
    exact: true,
  });
  await expect(
    panel.getByRole("alert", { name: "Studio exports error" }),
  ).toContainText("Temporary export queue outage");
  await page.getByRole("button", { name: "Start from a blank canvas" }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toBeVisible();
  unavailable = false;
  await panel
    .getByRole("button", { name: "Refresh Studio exports", exact: true })
    .click();
  await expect(
    panel.getByRole("status", { name: "Studio export usage" }),
  ).toHaveText("0 of 2 active exports");
  await expect(
    panel.getByRole("alert", { name: "Studio exports error" }),
  ).toHaveCount(0);
});
