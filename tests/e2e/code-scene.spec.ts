import { execFileSync } from "node:child_process";
import { test, expect } from "./fixtures";

test("a scene can be written in code, edited, checked for errors and kept", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Code studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("button", { name: "Code studio", exact: false }).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Write scene in code" }).click();
  const editor = page.getByRole("region", { name: "Code of scene 1" });
  await expect(editor).toBeVisible();
  const scene = page.frameLocator(".player-wrap iframe[title^='Code scene']");
  await expect(scene.locator(".title")).not.toBeEmpty();

  // Edit and apply: the player runs the new code.
  const js = editor.getByLabel("Scene JavaScript");
  await js.fill(
    'R.theme({ background: "#101828" });\ndocument.querySelector(".title").textContent = "Edited in the studio";\ngsap.from(".title", { opacity: 0, duration: 0.5 });',
  );
  await editor.getByRole("button", { name: "Apply code" }).click();
  await expect(scene.locator(".title")).toHaveText("Edited in the studio");
  await editor.screenshot({ path: "artifacts/ui-code-scene-editor.png" });

  // Errors the scene throws are shown next to its code.
  await js.fill('throw new Error("boom from the scene");');
  await editor.getByRole("button", { name: "Apply code" }).click();
  await expect(
    editor.getByRole("alert", { name: "Scene errors" }),
  ).toContainText("boom from the scene");

  // Invalid code is refused before it reaches the film.
  await js.fill("");
  await editor.getByRole("button", { name: "Apply code" }).click();
  await expect(editor.getByRole("alert").first()).toContainText("js");
  await editor.getByRole("button", { name: "Revert" }).click();
  await expect(js).toHaveValue('throw new Error("boom from the scene");');

  // Applied code autosaves with the film.
  await js.fill(
    'R.theme({ background: "#123456" });\ndocument.querySelector(".title").textContent = "Kept";',
  );
  await editor.getByRole("button", { name: "Apply code" }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/projects/${project.id}`)).json())
          .timeline.scenes[0].code?.js,
      { timeout: 20000 },
    )
    .toContain('"Kept"');
  await page.reload();
  await page.getByRole("button", { name: "Code studio", exact: false }).click();
  await expect(
    page
      .getByRole("region", { name: "Code of scene 1" })
      .getByLabel("Scene JavaScript"),
  ).toHaveValue(/Kept/);

  // The code scene exports through the real renderer.
  await expect(page.getByRole("status", { name: "Save status" })).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Approve & export MP4" }).click();
  await expect(page.getByText("Your film is ready.")).toBeVisible({
    timeout: 200000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  await (await downloadPromise).saveAs("artifacts/e2e-code-scene.mp4");
  // A pixel away from the title shows the scene's own background colour.
  const frame = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      "2",
      "-i",
      "artifacts/e2e-code-scene.mp4",
      "-frames:v",
      "1",
      "-vf",
      "format=rgb24,crop=1:1:iw*0.94:ih*0.9",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: 1024 },
  );
  const [r, g, b] = [...frame];
  expect(Math.abs(r - 0x12)).toBeLessThan(10);
  expect(Math.abs(g - 0x34)).toBeLessThan(10);
  expect(Math.abs(b - 0x56)).toBeLessThan(10);
});

test("portrait and square previews keep the video's own shape", async ({
  page,
  request,
}) => {
  for (const [format, ratio] of [
    ["portrait", 720 / 1280],
    ["square", 1],
    ["landscape", 1280 / 720],
  ] as const) {
    await request.post("/api/projects", {
      data: { prompt: `Shape ${format}`, duration: 5, format, blank: true },
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: `Shape ${format}`, exact: false })
      .click();
    const player = page.locator(".player-wrap > div").first();
    await expect(player).toBeVisible();
    const box = (await player.boundingBox())!;
    expect(Math.abs(box.width / box.height - ratio)).toBeLessThan(0.02);
    expect(box.height).toBeLessThanOrEqual(471);
  }
});

test("a layer past the frame's edge can be fitted back in one click", async ({
  page,
  request,
}) => {
  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Edge case",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  const current = await (
    await request.get(`/api/projects/${project.id}`)
  ).json();
  const timeline = structuredClone(current.timeline);
  timeline.scenes[0].layers = [
    {
      id: "wide",
      kind: "text",
      x: 0.7,
      y: 0.4,
      width: 0.6,
      height: 0.2,
      text: "Half of me is outside",
      color: "#ffffff",
      fontSize: 48,
      animation: "none",
    },
  ];
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        data: { timeline, baseRevisionId: current.revisions.at(-1).id },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: "Edge case", exact: false }).click();
  await expect(
    page.getByText("Some layers extend past the video frame"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit to frame" }).click();
  await expect(
    page.getByText("Some layers extend past the video frame"),
  ).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const saved = (
          await (await request.get(`/api/projects/${project.id}`)).json()
        ).timeline.scenes[0].layers[0];
        return saved.x + saved.width <= 1;
      },
      { timeout: 20000 },
    )
    .toBe(true);
});
