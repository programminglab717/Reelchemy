import { test, expect } from "./fixtures";

test("the director shows progress, can be stopped, and its film previews as live code scenes", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Director studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  // The browser's view of a director run (the server side is covered by its
  // API tests): progress while working, then the outcome.
  let job = {
    id: "00000000-0000-4000-8000-000000000001",
    projectId: project.id,
    state: "working",
    stage: "Writing scene 1 of 1: The idea",
    progress: 0.4,
    error: null as string | null,
    summary: null as string | null,
    request: { kind: "film-revision" },
  };
  await page.route(`**/api/projects/${project.id}/direct`, async (route) => {
    const method = route.request().method();
    if (method === "POST") return route.fulfill({ status: 202, json: { job } });
    if (method === "DELETE") {
      job = { ...job, state: "cancelled", stage: "Cancelled" };
      return route.fulfill({ json: { job } });
    }
    return route.fulfill({ json: { job } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Director studio", exact: false })
    .click();
  const revise = async (instruction: string) => {
    await page
      .getByLabel("Revision scope", { exact: true })
      .selectOption("story");
    await page.locator("#revision").fill(instruction);
    await page.getByRole("button", { name: "Apply revision" }).click();
  };
  await revise("Animate how a database index works");
  const status = page.getByRole("status", { name: "AI director progress" });
  await expect(status).toContainText("The director is animating your film");
  await expect(status).toContainText("Writing scene 1 of 1: The idea");
  await expect(
    status.getByRole("progressbar", { name: "Director progress" }),
  ).toHaveAttribute("aria-valuenow", "40");

  // The director saves its film; then the run reports completion.
  const current = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  const timeline = structuredClone(current.timeline);
  timeline.scenes[0] = {
    ...timeline.scenes[0],
    layers: [],
    code: {
      html: '<div id="t">Index</div>',
      css: '#stage{background:#0b1020}#t{position:absolute;left:200px;top:400px;font:700 120px "Space Grotesk";color:#fff}',
      js: 'document.getElementById("t").textContent = "Ran GSAP " + gsap.version; gsap.from("#t",{x:-300,duration:1});',
    },
  };
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        data: { timeline, baseRevisionId: current.revisions.at(-1).id },
      })
    ).ok(),
  ).toBe(true);
  job = {
    ...job,
    state: "completed",
    progress: 1,
    stage: "Finished",
    summary: "AI director animated 1 scene: The idea.",
  };
  await expect(status).toContainText("The director finished");
  await expect(status).toContainText("AI director animated 1 scene");
  // The new version opens, and the player runs the scene's code with the
  // studio's motion libraries.
  const scene = page
    .locator(".player-wrap iframe[title^='Code scene']")
    .first();
  await expect(scene).toBeVisible();
  await expect(
    page.frameLocator(".player-wrap iframe[title^='Code scene']").locator("#t"),
  ).toHaveText(/^Ran GSAP 3\./);
  await status.getByRole("button", { name: "Dismiss" }).click();
  await expect(status).toHaveCount(0);

  // A second run can be stopped.
  job = {
    ...job,
    state: "working",
    progress: 0.1,
    stage: "Planning the storyboard",
    summary: null,
  };
  await revise("Make it about B-trees");
  await expect(status).toContainText("Planning the storyboard");
  await status.getByRole("button", { name: "Stop" }).click();
  await expect(status).toContainText("The director was stopped");
});
