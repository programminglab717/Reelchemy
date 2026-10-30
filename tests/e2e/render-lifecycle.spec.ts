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
