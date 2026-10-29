import { test, expect, account } from "./fixtures";
import { limitsPolicy } from "../../src/lib/limits-policy";
test("write budgets persist per workspace, return Retry-After and keep private reads/other users available", async ({
  request,
  browser,
}) => {
  const limit = limitsPolicy().writes.count;
  expect(limit).toBeLessThanOrEqual(300);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Budget studio",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  let name = p.name;
  for (let i = 1; i < limit; i++) {
    const next = `Budget studio ${i}`;
    const renamed = await request.patch(`/api/projects/${p.id}/name`, {
      data: { name: next, baseName: name },
    });
    expect(renamed.status()).toBe(200);
    name = next;
  }
  const blocked = await request.patch(`/api/projects/${p.id}/name`, {
    data: { name: "Must not overwrite", baseName: name },
  });
  expect(blocked.status()).toBe(429);
  expect(Number(blocked.headers()["retry-after"])).toBeGreaterThan(0);
  expect(await blocked.json()).toMatchObject({ code: "RATE_LIMITED" });
  const read = await request.get(`/api/projects/${p.id}`);
  expect(read.status()).toBe(200);
  expect((await read.json()).name).toBe(name);
  const other = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  });
  try {
    await account(other.request, "Outside budget");
    expect(
      (
        await other.request.patch(`/api/projects/${p.id}/name`, {
          data: { name: "Other", baseName: name },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await other.request.post("/api/projects", {
          data: {
            prompt: "Independent budget",
            duration: 5,
            format: "landscape",
            blank: true,
          },
        })
      ).status(),
    ).toBe(201);
  } finally {
    await other.close();
  }
});
