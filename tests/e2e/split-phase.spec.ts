import { test, expect } from "./fixtures";
test("splitting an orbital graphic preserves both axes of its motion at the original global frame", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Orbital split",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  p.timeline.scenes[0].layers = [
    {
      ...p.timeline.scenes[0].layers[0],
      id: "orbit",
      kind: "circle",
      animation: "none",
      text: "",
      x: 0.1,
      y: 0.2,
      width: 0.8,
      height: 0.6,
    },
  ];
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Orbital split", exact: false })
    .click();
  const scrub = page.getByLabel("Timeline playhead", { exact: true });
  await scrub.fill("90");
  const orbit = page.locator('.player-wrap circle[r="15"]');
  await expect(orbit).toHaveCount(1);
  const before = {
    x: Number(await orbit.getAttribute("cx")),
    y: Number(await orbit.getAttribute("cy")),
  };
  await scrub.fill("60");
  await page
    .getByRole("button", { name: "Split scene at playhead", exact: true })
    .click();
  await scrub.fill("90");
  await expect
    .poll(async () => Number(await orbit.getAttribute("cy")))
    .toBeCloseTo(before.y, 5);
  await expect
    .poll(async () => Number(await orbit.getAttribute("cx")))
    .toBeCloseTo(before.x, 5);
});
