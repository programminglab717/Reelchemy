import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createAccountFetch,
  AccountSessionError,
} from "../src/lib/account-fetch";
import {
  ACCOUNT_HEADER,
  ACCOUNT_STATUS_HEADER,
} from "../src/lib/account-session";

const origin = () => "https://studio.example.test";
test("private browser requests bind the rendered account and retain multipart, abort and JSON options", async () => {
  const controller = new AbortController();
  const form = new FormData();
  form.set("license", "Private synthetic fixture");
  const request = createAccountFetch(
    "original-owner",
    () => assert.fail(),
    async (url, init) => {
      assert.equal(url, `${origin()}/api/projects/import`);
      assert.equal(
        new Headers(init?.headers).get(ACCOUNT_HEADER),
        "original-owner",
      );
      assert.equal(new Headers(init?.headers).get("X-Other"), "preserved");
      assert.equal(new Headers(init?.headers).get("content-type"), null);
      assert.equal(init?.signal, controller.signal);
      assert.equal(init?.body, form);
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
      return Response.json({ okay: true });
    },
    origin,
  );
  assert(
    (
      await request("/api/projects/import", {
        method: "POST",
        headers: { [ACCOUNT_HEADER]: "forged", "X-Other": "preserved" },
        body: form,
        signal: controller.signal,
        credentials: "include",
        redirect: "follow",
        cache: "force-cache",
      })
    ).ok,
  );
});
test("account binding never travels to external or non-API destinations", async () => {
  const request = createAccountFetch(
    "owner",
    () => assert.fail(),
    async () => assert.fail("Transport must not run"),
    origin,
  );
  for (const url of [
    "https://outside.example/api/projects",
    "//outside.example/api/projects",
    "/sign-in",
    "https://user:password@studio.example.test/api/projects",
    "/api/../sign-in",
  ])
    await assert.rejects(request(url), /Private requests/);
});
test("account changes stop new requests and discard an already in-flight success without reading its data", async () => {
  let finish!: (value: Response) => void;
  let calls = 0;
  const changes: string[] = [];
  const request = createAccountFetch(
    "old-owner",
    (state) => changes.push(state),
    async () => {
      calls++;
      if (calls === 1)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json(
        { code: "ACCOUNT_CHANGED" },
        { status: 409, headers: { [ACCOUNT_STATUS_HEADER]: "changed" } },
      );
    },
    origin,
  );
  const pending = request("/api/projects");
  await assert.rejects(request("/api/workspace/exports"), AccountSessionError);
  let canceled = false;
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          canceled = true;
        },
      }),
    ),
  );
  await assert.rejects(pending, AccountSessionError);
  assert(canceled);
  await assert.rejects(
    request("/api/projects", { method: "POST" }),
    AccountSessionError,
  );
  assert.equal(calls, 2);
  assert(changes.every((state) => state === "changed"));
});
test("expired sessions stop private requests while network, capacity and revision errors remain retryable", async () => {
  let calls = 0;
  const changes: string[] = [];
  const request = createAccountFetch(
    "owner",
    (state) => changes.push(state),
    async () => {
      calls++;
      if (calls === 1) throw new Error("Synthetic network loss");
      return Response.json({}, { status: [0, 0, 503, 409, 401][calls] || 200 });
    },
    origin,
  );
  await assert.rejects(request("/api/projects"), /network loss/);
  assert.equal((await request("/api/projects")).status, 503);
  assert.equal((await request("/api/projects")).status, 409);
  await assert.rejects(
    request("/api/projects"),
    (error: unknown) =>
      error instanceof AccountSessionError && error.state === "expired",
  );
  await assert.rejects(request("/api/projects"), AccountSessionError);
  assert.deepEqual(changes, ["expired"]);
  assert.equal(calls, 4);
});
