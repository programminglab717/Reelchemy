import { test } from "node:test";
import assert from "node:assert/strict";
import { localMutation } from "../src/lib/http";

const request = (origin: string | null, host: string) =>
  new Request("http://internal/api/x", {
    method: "POST",
    headers: { host, ...(origin ? { origin } : {}) },
  });
test("writes accept same-host or configured public origins behind a tunnel and refuse others", () => {
  const saved = process.env.BETTER_AUTH_URL;
  try {
    process.env.BETTER_AUTH_URL = "https://studio.example.test";
    assert.doesNotThrow(() => localMutation(request(null, "localhost:3001")));
    assert.doesNotThrow(() =>
      localMutation(request("http://localhost:3001", "localhost:3001")),
    );
    // Cloudflare Tunnel may forward the internal Host header.
    assert.doesNotThrow(() =>
      localMutation(request("https://studio.example.test", "localhost:3001")),
    );
    for (const origin of [
      "https://evil.example.test",
      "http://studio.example.test",
      "https://studio.example.test.evil.test",
      "null",
    ])
      assert.throws(
        () => localMutation(request(origin, "localhost:3001")),
        /Cross-origin/,
      );
    delete process.env.BETTER_AUTH_URL;
    assert.throws(
      () =>
        localMutation(request("https://studio.example.test", "localhost:3001")),
      /Cross-origin/,
    );
  } finally {
    if (saved === undefined) delete process.env.BETTER_AUTH_URL;
    else process.env.BETTER_AUTH_URL = saved;
  }
});
