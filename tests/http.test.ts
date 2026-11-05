import { test } from "node:test";
import assert from "node:assert/strict";
import { readLimitedBody, body } from "../src/lib/http";
test("streamed request limits stop chunked oversized input before parsing", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(10));
    },
    cancel() {
      cancelled = true;
    },
  });
  const req = new Request("http://local", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: string });
  await assert.rejects(() => readLimitedBody(req, 20), /too large/);
  assert.equal(cancelled, true);
  assert.deepEqual(
    await body(
      new Request("http://local", { method: "POST", body: '{"ok":true}' }),
    ),
    { ok: true },
  );
});

test("large timeline requests opt into a bounded allowance while ordinary JSON routes keep their smaller cap", async () => {
  const payload = JSON.stringify({ text: "x".repeat(100001) });
  const request = () =>
    new Request("http://local", { method: "PATCH", body: payload });
  await assert.rejects(() => body(request()), /too large/);
  assert.equal((await body(request(), 110000)).text.length, 100001);
  await assert.rejects(() => body(request(), 100002), /too large/);
});
