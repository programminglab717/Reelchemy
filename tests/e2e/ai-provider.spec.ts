import { test, expect } from "./fixtures";

const key = "sk-e2e-private-canary-0123456789WXYZ";
test("a maker saves an encrypted AI key, plans with it instead of the demo director, never sees it returned and can delete it", async ({
  page,
  request,
}) => {
  await page.goto("/account");
  const settings = page.getByRole("region", { name: "AI director" });
  await expect(
    settings.getByRole("status", { name: "AI director source" }),
  ).toHaveText(/demo director/);
  await settings
    .getByRole("button", { name: "Add my AI provider key", exact: true })
    .click();
  const form = settings.getByRole("form", { name: "AI provider key" });
  await form.getByLabel("Provider").selectOption("gemini");
  await expect(form.getByLabel("API base URL")).toHaveValue(
    "https://generativelanguage.googleapis.com/v1beta/openai",
  );
  // An unreachable HTTPS endpoint proves requests go to the saved provider
  // rather than the demo director, without contacting a real service.
  await form.getByLabel("Provider").selectOption("custom");
  await form.getByLabel("API base URL").fill("https://127.0.0.1:9/v1");
  await form.getByLabel("Model").fill("e2e-model");
  await form.getByLabel("API key").fill(key);
  await form.getByLabel("Input per million tokens").fill("0.5");
  await form.getByLabel("Output per million tokens").fill("1.5");
  await form.getByLabel("Daily spending limit").fill("2");
  await form.getByRole("button", { name: "Save encrypted key" }).click();
  await expect(
    settings.getByRole("status", { name: "AI director source" }),
  ).toHaveText(/key ending in WXYZ \(e2e-model\)/);
  const saved = await request.get("/api/workspace/ai-provider");
  expect(saved.status()).toBe(200);
  const text = await saved.text();
  expect(text).not.toContain(key);
  expect(JSON.parse(text)).toMatchObject({
    access: "own",
    own: { keyHint: "WXYZ", model: "e2e-model", dailyUsd: "2" },
  });
  await page.reload();
  expect(await page.content()).not.toContain(key);
  await expect(
    settings.getByRole("status", { name: "AI director source" }),
  ).toHaveText(/key ending in WXYZ/);

  const project = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Plan with my own key",
        duration: 5,
        format: "landscape",
      },
    })
  ).json();
  const plan = await request.post(`/api/projects/${project.id}/plan`, {
    data: {},
  });
  expect(plan.status()).toBe(502);
  const failure = await plan.json();
  expect(failure.code).toBe("AI_UNAVAILABLE");
  expect(JSON.stringify(failure)).not.toContain(key);
  const usage = await (await request.get("/api/workspace/ai-provider")).json();
  expect(usage.usage.requests).toBe(1);

  await settings
    .getByRole("button", { name: "Delete my AI key", exact: true })
    .click();
  await expect(
    settings.getByRole("status", { name: "AI director source" }),
  ).toHaveText(/demo director/);
  expect(
    (await (await request.get("/api/workspace/ai-provider")).json()).own,
  ).toBeNull();
  const demo = await request.post(`/api/projects/${project.id}/plan`, {
    data: {},
  });
  expect(demo.status()).toBe(200);
});
