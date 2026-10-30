import { test, expect } from "./fixtures";

test("retrying a lost export response reuses the admitted job and the just-saved timeline", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Export retry protection",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: p.name, exact: false }).click();
  const attempts: { key: string | undefined; version: string }[] = [];
  let admittedId = "";
  await page.route(`**/api/projects/${p.id}/render`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push({
      key: route.request().headers()["idempotency-key"],
      version: route.request().postDataJSON().baseRevisionId,
    });
    const response = await route.fetch();
    expect(response.status()).toBe(202);
    const job = await response.json();
    if (attempts.length === 1) {
      admittedId = job.id;
      await route.abort("failed"); // Admission succeeded; only its response is lost.
    } else {
      expect(job.id).toBe(admittedId);
      expect(response.headers()["idempotency-replayed"]).toBe("true");
      await route.fulfill({ response });
    }
  });
  await page
    .getByLabel("Scene title", { exact: true })
    .fill("Last edit before approving");
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByRole("alert", { name: "Studio error" })).toBeVisible();
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(attempts[0].version).toBe(saved.revisions.at(-1).id);
  expect(attempts[0].version).not.toBe(p.revisions.at(-1).id);
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(attempts[0].key).toMatch(/^[a-f0-9-]{36}$/);
  const jobs = await (await request.get(`/api/projects/${p.id}/render`)).json();
  expect(jobs).toHaveLength(1);
  expect(jobs[0].id).toBe(admittedId);
  expect(jobs[0].report.timeline.scenes[0].title).toBe(
    "Last edit before approving",
  );
  expect((await request.get(`/api/jobs/${admittedId}/download`)).status()).toBe(
    200,
  );
});

test("a stale saved tab cannot export another tab's video and can open the latest version", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Export saved-version conflict",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: p.name, exact: false }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  const newer = structuredClone(p.timeline);
  newer.scenes[0].title = "Saved from another tab";
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: newer, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(
    page.getByRole("button", { name: "Open latest saved version" }),
  ).toBeVisible();
  expect(
    await (await request.get(`/api/projects/${p.id}/render`)).json(),
  ).toEqual([]);
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Scene 1",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Open latest saved version" }).click();
  await expect(page.getByLabel("Scene title", { exact: true })).toHaveValue(
    "Saved from another tab",
  );
});
