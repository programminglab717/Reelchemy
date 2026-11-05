import { test, expect } from "./fixtures";

test("cancelling an active frame render releases the worker for the next private export", async ({
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Cancel an active render safely",
        duration: 15,
        format: "landscape",
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/projects/${project.id}/plan`, { data: {} })
    ).status(),
  ).toBe(200);
  const admission = await request.post(`/api/projects/${project.id}/render`);
  expect(admission.status(), await admission.text()).toBe(202);
  const job = await admission.json();
  await expect
    .poll(
      async () => {
        const current = await (await request.get(`/api/jobs/${job.id}`)).json();
        if (["failed", "completed"].includes(current.status))
          throw new Error(current.error || "Render ended before cancellation.");
        return current.stage;
      },
      { timeout: 60000, intervals: [100, 200, 300] },
    )
    .toBe("Rendering frames");
  expect((await request.delete(`/api/jobs/${job.id}`)).ok()).toBeTruthy();
  const next = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Export after cancellation",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  const nextAdmission = await request.post(`/api/projects/${next.id}/render`);
  expect(nextAdmission.status(), await nextAdmission.text()).toBe(202);
  const followup = await nextAdmission.json();
  await expect
    .poll(
      async () => {
        const current = await (
          await request.get(`/api/jobs/${followup.id}`)
        ).json();
        if (current.status === "failed")
          throw new Error(current.error || "Follow-up render failed.");
        return current.status;
      },
      { timeout: 120000, intervals: [200, 500, 1000] },
    )
    .toBe("completed");
  const download = await request.get(`/api/jobs/${followup.id}/download`);
  expect(download.status()).toBe(200);
  expect((await download.body()).length).toBeGreaterThan(1000);
  expect((await (await request.get(`/api/jobs/${job.id}`)).json()).status).toBe(
    "cancelled",
  );
  expect((await request.get(`/api/jobs/${job.id}/download`)).status()).toBe(
    404,
  );
});

test("a second export waits with a visible place in the shared render queue and starts once the earlier work is cancelled", async ({
  page,
  request,
}) => {
  const long = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Hold the shared render worker",
        duration: 60,
        format: "landscape",
      },
    })
  ).json();
  expect(
    (
      await request.post(`/api/projects/${long.id}/plan`, { data: {} })
    ).status(),
  ).toBe(200);
  const admission = await request.post(`/api/projects/${long.id}/render`);
  expect(admission.status(), await admission.text()).toBe(202);
  const first = await admission.json();
  await expect
    .poll(
      async () => {
        const current = await (
          await request.get(`/api/jobs/${first.id}`)
        ).json();
        if (["failed", "completed"].includes(current.status))
          throw new Error(current.error || "Render ended too early.");
        return current.status;
      },
      { timeout: 60000, intervals: [100, 200, 300] },
    )
    .toBe("rendering");
  const waiting = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Queued behind another export",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: waiting.name, exact: true }).click();
    await page.getByRole("button", { name: /Approve & export MP4/ }).click();
    await expect(
      page.getByText("Waiting in the render queue · 1 export ahead", {
        exact: true,
      }),
    ).toBeVisible();
    // Counts only: the response carries no detail of the other export.
    const jobs = await (
      await request.get(`/api/projects/${waiting.id}/render`)
    ).json();
    const queued = (Array.isArray(jobs) ? jobs : (jobs.jobs ?? jobs.items))[0];
    const view = await (await request.get(`/api/jobs/${queued.id}`)).json();
    expect(view.status).toBe("queued");
    expect(view.queueAhead).toBe(1);
    expect(JSON.stringify(view)).not.toContain(first.id);
  } finally {
    expect((await request.delete(`/api/jobs/${first.id}`)).ok()).toBeTruthy();
  }
  await expect(
    page.getByText("Your film is ready.", { exact: true }),
  ).toBeVisible({ timeout: 120000 });
});
