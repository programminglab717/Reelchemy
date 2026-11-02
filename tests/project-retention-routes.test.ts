import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline, revisionId } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-retention-routes-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
  AI_PROVIDER: "mock",
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth");
const { GET, POST } =
    await import("../src/app/api/projects/[id]/retention/route"),
  { PATCH } = await import("../src/app/api/projects/[id]/route"),
  { POST: plan } = await import("../src/app/api/projects/[id]/plan/route");
const admin = new Database(path.join(root, "data", "studio.sqlite"));
after(async () => {
  admin.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-retention-fixture-passphrase-4826";
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
    cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
    workspace: app.ensureWorkspace(signup.user.id, name).id,
  };
}
const owner = await account("retention-owner"),
  other = await account("retention-other");
const brief = {
  prompt: "PRIVATE_RETAINED_DIRECTION_CANARY",
  duration: 5,
  format: "landscape" as const,
};
function project() {
  const p = app.createProject(brief, owner.workspace);
  for (let i = 0; i < 6; i++)
    app.reviseProject(p, blankTimeline(brief), `Saved edit ${i}`);
  p.messages.push(
    ...Array.from({ length: 8 }, (_, i) => ({
      role: "user" as const,
      content: `Retained direction ${i}`,
    })),
  );
  return app.saveProject(p);
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const endpoint = (id: string) =>
  `http://127.0.0.1:3001/api/projects/${id}/retention`;
const headers = (actor = owner.id, cookie = owner.cookie) => ({
  cookie,
  [ACCOUNT_HEADER]: actor,
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:3001",
  "Content-Type": "application/json",
});
const hash = (id: string) =>
  createHash("sha256")
    .update(
      (
        admin.prepare("SELECT data FROM projects WHERE id=?").get(id) as {
          data: string;
        }
      ).data,
    )
    .digest("hex");
async function preview(id: string) {
  const response = await GET(
    new Request(`${endpoint(id)}?preview=1&keepVersions=2&keepMessages=3`, {
      headers: headers(),
    }),
    context(id),
  );
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
function cleanupRequest(
  id: string,
  payload: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(endpoint(id), {
    method: "POST",
    headers: { ...headers(), ...extra },
    body: JSON.stringify(payload),
  });
}
const payload = (p: { digest: string }) => ({
  keepVersions: 2,
  keepMessages: 3,
  digest: p.digest,
  requestId: randomUUID(),
  confirmation: "REMOVE EARLIER HISTORY",
});
test("retention routes enforce verified ownership/actor/origin and return private bounded storage metadata without shared-service usage", async () => {
  const p = project(),
    before = hash(p.id);
  const anonymous = await GET(new Request(endpoint(p.id)), context(p.id));
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("Cache-Control"), "private, no-store");
  const foreign = await GET(
    new Request(endpoint(p.id), { headers: headers(other.id, other.cookie) }),
    context(p.id),
  );
  assert.equal(foreign.status, 404);
  assert(!(await foreign.text()).includes(brief.prompt));
  assert.equal(
    (
      await GET(
        new Request(endpoint(p.id), { headers: headers(other.id) }),
        context(p.id),
      )
    ).status,
    409,
  );
  const response = await GET(
      new Request(endpoint(p.id), { headers: headers() }),
      context(p.id),
    ),
    value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(value.versions, 6);
  assert.equal(value.messages, 9);
  assert.equal("service" in value, false);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const selected = await preview(p.id),
    body = payload(selected);
  assert.equal(
    (
      await POST(
        cleanupRequest(p.id, body, { origin: "https://foreign.example.test" }),
        context(p.id),
      )
    ).status,
    400,
  );
  assert.equal(hash(p.id), before);
});
test("an explicit cleanup preserves the current CAS film and immutable queued export; uncertain replay remains exact once after a newer saved edit", async () => {
  const p = project(),
    film = structuredClone(p.timeline),
    base = revisionId(p),
    job = app.createJob(p),
    before = hash(p.id),
    selected = await preview(p.id),
    body = payload(selected);
  assert.equal(hash(p.id), before);
  const response = await POST(cleanupRequest(p.id, body), context(p.id));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.versionsRemoved, 4);
  assert.equal(result.messagesRemoved, 6);
  assert.deepEqual(app.getProject(p.id)!.timeline, film);
  assert.equal(revisionId(app.getProject(p.id)!), base);
  assert.equal(app.getJob(job.id)!.status, "queued");
  const next = app.reviseProject(
      app.getProject(p.id)!,
      blankTimeline(brief),
      "Later edit",
    ),
    later = hash(p.id);
  const replay = await POST(cleanupRequest(p.id, body), context(p.id));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ...result, replayed: true });
  assert.equal(hash(p.id), later);
  assert.equal(revisionId(app.getProject(p.id)!), revisionId(next));
});
test("history cleanup rechecks Trash, ownership and non-revision changes after a request body streams", async () => {
  for (const change of ["trash", "owner", "name"]) {
    const p = project(),
      selected = await preview(p.id),
      data = payload(selected),
      before = hash(p.id);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let read!: () => void;
    const reading = new Promise<void>((resolve) => (read = resolve));
    const stream = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        pull() {
          read();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request(endpoint(p.id), {
      method: "POST",
      headers: headers(),
      body: stream,
      duplex: "half",
    } as RequestInit);
    const pending = POST(request, context(p.id));
    await reading;
    if (change === "trash") app.setProjectTrashed(p.id, true);
    else if (change === "owner")
      admin
        .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
        .run(other.workspace, p.id);
    else
      app.renameOwnedProject(
        p.id,
        "Updated while receiving",
        p.name,
        owner.workspace,
      );
    controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
    controller.close();
    const response = await pending;
    assert.equal(response.status, change === "name" ? 409 : 404);
    assert.equal(app.getProject(p.id)!.revisions.length, 6);
    if (change !== "name") assert.equal(hash(p.id), before);
  }
});
test("metadata refusal preserves saved content and blocks paid planning before fetch or a usage reservation; manual saving succeeds after reviewed cleanup", async () => {
  const p = project(),
    original = process.env.REELCHEMY_PROJECT_VERSIONS,
    originalFetch = globalThis.fetch;
  const providerEnv = Object.fromEntries(
    ["AI_PROVIDER", "AI_API_KEY", "AI_BASE_URL", "AI_MODEL"].map((key) => [
      key,
      process.env[key],
    ]),
  );
  let calls = 0;
  try {
    process.env.REELCHEMY_PROJECT_VERSIONS = "6";
    const before = hash(p.id);
    const saved = await PATCH(
      new Request(endpoint(p.id).replace("/retention", ""), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          timeline: p.timeline,
          baseRevisionId: revisionId(p),
        }),
      }),
      context(p.id),
    );
    assert.equal(saved.status, 413);
    assert.equal((await saved.json()).code, "PROJECT_STORAGE_LIMIT");
    assert.equal(hash(p.id), before);
    Object.assign(process.env, {
      AI_PROVIDER: "compatible",
      AI_API_KEY: "SYNTHETIC_NEVER_SENT",
      AI_BASE_URL: "https://provider.example.test/v1",
      AI_MODEL: "private-model",
    });
    globalThis.fetch = async () => {
      calls++;
      throw new Error("No provider fetch may occur");
    };
    const generated = await plan(
      new Request(endpoint(p.id).replace("/retention", "/plan"), {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ revision: "Preserve these edits" }),
      }),
      context(p.id),
    );
    assert.equal(generated.status, 413);
    assert.equal(calls, 0);
    assert.equal(hash(p.id), before);
    const selected = await preview(p.id);
    assert.equal(
      (await POST(cleanupRequest(p.id, payload(selected)), context(p.id)))
        .status,
      200,
    );
    const retry = await PATCH(
      new Request(endpoint(p.id).replace("/retention", ""), {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({
          timeline: p.timeline,
          baseRevisionId: revisionId(p),
        }),
      }),
      context(p.id),
    );
    assert.equal(retry.status, 200);
    assert.equal(app.getProject(p.id)!.revisions.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.REELCHEMY_PROJECT_VERSIONS;
    else process.env.REELCHEMY_PROJECT_VERSIONS = original;
    for (const [key, value] of Object.entries(providerEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("invalid confirmations, selections and malformed JSON fail privately without changing saved data", async () => {
  const p = project(),
    selected = await preview(p.id),
    before = hash(p.id);
  for (const value of [
    { ...payload(selected), confirmation: "no" },
    { ...payload(selected), keepVersions: 0 },
  ])
    assert.equal(
      (await POST(cleanupRequest(p.id, value), context(p.id))).status,
      400,
    );
  const response = await POST(
    new Request(endpoint(p.id), {
      method: "POST",
      headers: headers(),
      body: '{"PRIVATE_MALFORMED_JSON_CANARY"',
    }),
    context(p.id),
  );
  assert.equal(response.status, 400);
  assert(!(await response.text()).includes("PRIVATE_MALFORMED_JSON_CANARY"));
  assert.equal(hash(p.id), before);
});
