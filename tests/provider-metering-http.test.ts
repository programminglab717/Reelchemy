import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline, revisionId } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import type { Project } from "../src/lib/schema";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-provider-metering-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
  AI_PROVIDER: "compatible",
  AI_BASE_URL: "https://provider.example.test/v1",
  AI_MODEL: "offline-contract",
  AI_API_KEY: "synthetic-private-provider-canary",
  REELCHEMY_AI_INPUT_USD_PER_MILLION: "3",
  REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "15",
});
const originalFetch = globalThis.fetch;
const app = await import("../src/lib/db");
const { getAuth } = await import("../src/lib/auth");
const { POST } = await import("../src/app/api/projects/[id]/plan/route");
const { PATCH } = await import("../src/app/api/projects/[id]/route");
const admin = new Database(path.join(root, "data", "studio.sqlite"));
after(async () => {
  globalThis.fetch = originalFetch;
  admin.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-provider-metering-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  const accounts = new Database(path.join(root, "auth", "auth.sqlite"));
  accounts
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  accounts.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  return {
    id: signup.user.id,
    workspace: app.ensureWorkspace(signup.user.id, name).id,
    cookie: login.headers
      .getSetCookie()
      .map((x) => x.split(";")[0])
      .join("; "),
  };
}
const owner = await account("meter-owner"),
  other = await account("meter-other");
const brief = {
  prompt: "Private creative instruction sentinel",
  duration: 5,
  format: "landscape" as const,
};
function project() {
  const p = app.createProject(brief, owner.workspace);
  app.reviseProject(p, blankTimeline(brief), "Manual work");
  return app.getProject(p.id)!;
}
function request(
  p: Project,
  body: Record<string, unknown> = {},
  cookie = owner.cookie,
  actor = owner.id,
) {
  return new Request(`http://127.0.0.1:3001/api/projects/${p.id}/plan`, {
    method: "POST",
    headers: {
      cookie,
      origin: "http://127.0.0.1:3001",
      host: "127.0.0.1:3001",
      "Content-Type": "application/json",
      [ACCOUNT_HEADER]: actor,
    },
    body: JSON.stringify(body),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function response(
  p: Project,
  usage: unknown = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
  },
) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(p.timeline) } }],
    ...(usage === null ? {} : { usage }),
  });
}
function latest() {
  return admin
    .prepare(
      "SELECT state,cost_micro_usd,reserved_micro_usd,usage_source FROM provider_usage ORDER BY rowid DESC LIMIT 1",
    )
    .get() as {
    state: string;
    cost_micro_usd: number | null;
    reserved_micro_usd: number;
    usage_source: string | null;
  };
}
function count() {
  return (
    admin.prepare("SELECT count(*) AS n FROM provider_usage").get() as {
      n: number;
    }
  ).n;
}

test("authentication, owner and actor checks reject before provider admission, including forged workspace/budget fields", async () => {
  const p = project(),
    before = count();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response(p);
  };
  assert.equal((await POST(request(p, {}, ""), context(p.id))).status, 401);
  assert.equal(
    (await POST(request(p, {}, other.cookie, other.id), context(p.id))).status,
    404,
  );
  assert.equal(
    (await POST(request(p, {}, owner.cookie, other.id), context(p.id))).status,
    409,
  );
  assert.equal(count(), before);
  assert.equal(requests, 0);
  const result = await POST(
    request(p, {
      workspaceId: other.workspace,
      globalMicroUsd: 1e12,
      studioMicroUsd: 1e12,
    }),
    context(p.id),
  );
  assert.equal(result.status, 200);
  assert.equal(requests, 1);
  assert.equal(latest().state, "settled");
  assert.equal(latest().cost_micro_usd, 6000);
  assert.deepEqual(
    admin
      .prepare(
        "SELECT workspace_id FROM provider_usage ORDER BY rowid DESC LIMIT 1",
      )
      .get(),
    { workspace_id: owner.workspace },
  );
  const stored = JSON.stringify(
    admin.prepare("SELECT * FROM provider_usage").all(),
  );
  for (const secret of [
    process.env.AI_API_KEY!,
    brief.prompt,
    "provider.example.test",
    "timeline",
    "Private-provider-metering-passphrase",
  ])
    assert.ok(!stored.includes(secret));
  const originalModel = process.env.AI_MODEL;
  try {
    // Even a misconfigured model field must not persist the credential text.
    process.env.AI_MODEL = process.env.AI_API_KEY;
    const next = project();
    globalThis.fetch = async () => response(next);
    assert.equal((await POST(request(next), context(next.id))).status, 200);
    const row = admin
      .prepare("SELECT * FROM provider_usage ORDER BY rowid DESC LIMIT 1")
      .get() as { model_hash: string };
    assert.match(row.model_hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(row).includes(process.env.AI_API_KEY!));
  } finally {
    process.env.AI_MODEL = originalModel;
  }
});

test("missing pricing and zero service allowance prevent network work while manual editing remains usable", async () => {
  const p = project(),
    before = count();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return response(p);
  };
  const original = process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION;
  try {
    delete process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION;
    let result = await POST(request(p), context(p.id));
    assert.equal(result.status, 503);
    assert.equal((await result.json()).code, "AI_BUDGET_CONFIGURATION");
    process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION = original;
    process.env.REELCHEMY_AI_GLOBAL_USD_PER_DAY = "0";
    result = await POST(
      request(p, { globalMicroUsd: 1e12, workspaceId: other.workspace }),
      context(p.id),
    );
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("Retry-After"), "300");
    assert.equal(result.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await result.json()).code, "AI_SERVICE_ALLOWANCE");
    assert.equal(requests, 0);
    assert.equal(count(), before);
    assert.deepEqual(app.getProject(p.id), p);
    const timeline = structuredClone(p.timeline!);
    timeline.scenes[0].title = "Manual editing remains usable";
    const manual = await PATCH(
      new Request(`http://127.0.0.1:3001/api/projects/${p.id}`, {
        method: "PATCH",
        headers: request(p).headers,
        body: JSON.stringify({ timeline, baseRevisionId: revisionId(p) }),
      }),
      context(p.id),
    );
    assert.equal(manual.status, 200);
  } finally {
    process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION = original;
    delete process.env.REELCHEMY_AI_GLOBAL_USD_PER_DAY;
  }
});

test("billable usage settles despite unusable creative output; transport and missing-usage outcomes retain their holds", async () => {
  const p = project();
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return Response.json({
      choices: [{ message: { content: "invalid storyboard" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
    });
  };
  let result = await POST(request(p), context(p.id));
  assert.equal(result.status, 502);
  assert.equal(latest().state, "settled");
  assert.equal(latest().cost_micro_usd, 6000);
  assert.deepEqual(app.getProject(p.id), p);
  globalThis.fetch = async () => {
    requests++;
    throw new Error("synthetic-private-provider-canary");
  };
  result = await POST(request(p), context(p.id));
  assert.equal(result.status, 502);
  assert.equal((await result.json()).code, "AI_UNAVAILABLE");
  assert.equal(latest().state, "uncertain");
  assert.equal(latest().cost_micro_usd, null);
  assert.ok(latest().reserved_micro_usd > 0);
  assert.deepEqual(app.getProject(p.id), p);
  globalThis.fetch = async () => {
    requests++;
    return response(p, null);
  };
  result = await POST(request(p), context(p.id));
  assert.equal(result.status, 200);
  assert.equal(latest().state, "uncertain");
  assert.equal(latest().cost_micro_usd, null);
  assert.equal(requests, 3);
});

test("a studio's concurrent planning call is refused before fetch without disturbing the admitted request", async () => {
  const p = project(),
    second = project();
  let enter: () => void = () => {},
    release: () => void = () => {},
    requests = 0;
  const entered = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
  globalThis.fetch = async () => {
    requests++;
    enter();
    await waiting;
    return response(p);
  };
  const first = POST(request(p), context(p.id));
  await entered;
  try {
    const refused = await POST(request(second), context(second.id));
    assert.equal(refused.status, 503);
    assert.equal((await refused.json()).code, "AI_BUSY");
    assert.equal(requests, 1);
    assert.deepEqual(app.getProject(second.id), second);
  } finally {
    release();
    await first;
  }
  assert.equal((await first).status, 200);
  assert.equal(latest().state, "settled");
});

test("demo planning needs no key or pricing and does not reserve any provider allowance", async () => {
  const p = project(),
    before = count();
  const saved = {
    provider: process.env.AI_PROVIDER,
    input: process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION,
    key: process.env.AI_API_KEY,
  };
  try {
    process.env.AI_PROVIDER = "mock";
    delete process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION;
    process.env.AI_API_KEY = "invalid-key\n";
    process.env.REELCHEMY_AI_GLOBAL_USD_PER_DAY = "0";
    globalThis.fetch = async () => {
      throw new Error("Demo must never reach provider transport");
    };
    const result = await POST(request(p), context(p.id));
    assert.equal(result.status, 200);
    assert.equal(count(), before);
    assert.equal(app.getProject(p.id)?.timeline?.scenes.length, 3);
  } finally {
    process.env.AI_PROVIDER = saved.provider;
    process.env.REELCHEMY_AI_INPUT_USD_PER_MILLION = saved.input;
    process.env.AI_API_KEY = saved.key;
    delete process.env.REELCHEMY_AI_GLOBAL_USD_PER_DAY;
  }
});
