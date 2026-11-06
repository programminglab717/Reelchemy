import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePlan, mockPlan } from "../src/lib/provider";
import { providerConfiguration } from "../src/lib/provider-config";
import { ProviderError } from "../src/lib/provider-error";
import {
  readProviderResponse,
  MAX_PROVIDER_RESPONSE_BYTES,
} from "../src/lib/provider-response";
import { failure } from "../src/lib/http";

const secret = "synthetic-private-canary-DO-NOT-RETURN";
const configuration = {
  AI_PROVIDER: "compatible",
  AI_BASE_URL: "https://example.test/v1/",
  AI_MODEL: "offline-model",
  AI_API_KEY: secret,
};
const brief = {
  prompt: "Offline contract",
  duration: 5,
  format: "landscape" as const,
};

async function safeError(
  operation: () => unknown | Promise<unknown>,
  code: string,
  status: number,
) {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ProviderError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
  assert(!String(caught).includes(secret));
  assert.equal(caught.cause, undefined);
  const response = failure(caught);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.text();
  assert(!body.includes(secret));
  assert(!body.includes("example.test"));
  assert(body.includes(code));
}

test("provider configuration fails closed without including keys or credential-bearing URLs", async () => {
  assert.deepEqual(providerConfiguration({}), { provider: "mock" });
  for (const invalid of [
    { AI_PROVIDER: secret },
    { AI_BASE_URL: secret },
    { AI_BASE_URL: `http://example.test/${secret}` },
    { AI_BASE_URL: `https://user:${secret}@example.test/v1` },
    { AI_BASE_URL: `https://example.test/v1?key=${secret}` },
    { AI_BASE_URL: `https://example.test/v1#${secret}` },
    { AI_BASE_URL: "https://example.test/v1\n" },
    { AI_BASE_URL: "https://example.test/\u0000path" },
    { AI_API_KEY: `${secret}\n` },
    { AI_API_KEY: `bad ${secret}` },
    { AI_API_KEY: `${secret}\u0080` },
    { AI_API_KEY: "a".repeat(4097) },
    { AI_API_KEY: undefined },
    { AI_MODEL: `${secret}\n` },
    { AI_MODEL: "a".repeat(201) },
    { AI_MODEL: undefined },
  ])
    await safeError(
      () => providerConfiguration({ ...configuration, ...invalid }),
      "AI_CONFIGURATION",
      503,
    );
  assert.equal(
    providerConfiguration(configuration).endpoint,
    "https://example.test/v1/chat/completions",
  );
  assert.equal(
    providerConfiguration({
      ...configuration,
      AI_PROVIDER: "anthropic",
      AI_BASE_URL: undefined,
    }).endpoint,
    "https://api.anthropic.com/v1/messages",
  );
});

test("provider transport, envelopes and timeline errors cross only the fixed safe API boundary", async () => {
  const originalFetch = globalThis.fetch;
  const saved = Object.fromEntries(
    Object.keys(configuration).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, configuration);
  try {
    let requests = 0;
    globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(String(url), "https://example.test/v1/chat/completions");
      assert.equal(
        init?.redirect,
        "error",
        "never forward credentials through provider redirects",
      );
      assert.equal(init?.cache, "no-store");
      return Response.json({
        choices: [{ message: { content: JSON.stringify(mockPlan(brief)) } }],
      });
    };
    await generatePlan(brief);
    assert.equal(requests, 1);
    process.env.AI_API_KEY = `${secret}\n`;
    await safeError(() => generatePlan(brief), "AI_CONFIGURATION", 503);
    assert.equal(requests, 1, "configuration rejected before network work");
    process.env.AI_API_KEY = secret;
    for (const [upstream, code, status] of [
      [
        async () => {
          throw new Error(`Private transport detail ${secret}`);
        },
        "AI_UNAVAILABLE",
        502,
      ],
      [
        async () => new Response(secret, { status: 401 }),
        "AI_KEY_REJECTED",
        502,
      ],
      [
        async () => new Response(secret, { status: 403 }),
        "AI_KEY_REJECTED",
        502,
      ],
      [
        async () => new Response(secret, { status: 404 }),
        "AI_MODEL_UNAVAILABLE",
        502,
      ],
      [
        async () => new Response(secret, { status: 429 }),
        "AI_PROVIDER_RATE_LIMITED",
        429,
      ],
      [
        async () => new Response(secret, { status: 503 }),
        "AI_UNAVAILABLE",
        502,
      ],
      [
        async () =>
          new Response(secret, {
            status: 302,
            headers: { location: `https://other.test/${secret}` },
          }),
        "AI_UNAVAILABLE",
        502,
      ],
    ] as const) {
      globalThis.fetch = upstream as typeof fetch;
      await safeError(() => generatePlan(brief), code, status);
    }
    for (const upstream of [
      () => new Response(`bad json ${secret}`),
      () => Response.json({ choices: [{ message: { content: secret } }] }),
      () =>
        Response.json({
          choices: [{ message: { content: JSON.stringify({ fps: secret }) } }],
        }),
      () => Response.json({ choices: secret }),
      () => Response.json({ choices: [] }),
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error(secret));
            },
          }),
        ),
      () =>
        new Response("{}", {
          headers: {
            "content-length": String(MAX_PROVIDER_RESPONSE_BYTES + 1),
          },
        }),
    ]) {
      globalThis.fetch = async () => upstream();
      await safeError(() => generatePlan(brief), "AI_INVALID_RESPONSE", 502);
    }
    process.env.AI_PROVIDER = "anthropic";
    for (const content of [
      secret,
      null,
      [{ type: "text", text: secret }],
      [{ type: "text", text: 3 }],
    ]) {
      globalThis.fetch = async () => Response.json({ content });
      await safeError(() => generatePlan(brief), "AI_INVALID_RESPONSE", 502);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("provider response bytes and stalled streams remain bounded and cancelled", async () => {
  let cancelled = false;
  let chunks = 0;
  const large = new Response(
    new ReadableStream(
      {
        pull(c) {
          chunks++;
          c.enqueue(new Uint8Array(64 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
  );
  await safeError(
    () => readProviderResponse(large, new AbortController().signal),
    "AI_INVALID_RESPONSE",
    502,
  );
  assert.equal(chunks, 9);
  assert(cancelled);
  cancelled = false;
  const controller = new AbortController();
  const stalled = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = safeError(
    () => readProviderResponse(stalled, controller.signal),
    "AI_TIMEOUT",
    504,
  );
  controller.abort();
  await pending;
  assert(cancelled);
  await safeError(
    () =>
      readProviderResponse(
        new Response(new Uint8Array([0xff])),
        new AbortController().signal,
      ),
    "AI_INVALID_RESPONSE",
    502,
  );
});
