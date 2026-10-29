import { browserTest as test, expect } from "./fixtures";
test("public health probes report availability without project or configuration details", async ({
  request,
}) => {
  const live = await request.get("/api/health/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ status: "alive" });
  const ready = await request.get("/api/health");
  expect(ready.status()).toBe(200);
  expect(ready.headers()["cache-control"]).toBe("no-store");
  expect(await ready.json()).toEqual({
    status: "ready",
    checks: {
      database: true,
      authentication: true,
      storage: true,
      worker: true,
      limits: true,
    },
  });
});
