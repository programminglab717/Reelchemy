import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { blankTimeline, revisionId } from "../src/lib/editor";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-export-admission-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.EMAIL_DELIVERY = "file";
after(() => rm(dir, { recursive: true, force: true }));
const db = await import("../src/lib/db");
const { POST } = await import("../src/app/api/projects/[id]/render/route");
const { getAuth } = await import("../src/lib/auth");
const auth = await getAuth();
const email = "export-admission@example.test",
  password = "Test-only-export-passphrase-4826";
const signup = await auth.api.signUpEmail({
  body: { name: "Export owner", email, password },
});
const admin = new Database(path.join(dir, "auth.sqlite"));
admin
  .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
  .run(signup.user.id);
admin.close();
const login = await auth.api.signInEmail({
  body: { email, password },
  asResponse: true,
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const owner = db.ensureWorkspace(signup.user.id, "Owner").id;
function project(workspaceId = owner) {
  const p = db.createProject(
    { prompt: "Approved video", duration: 5, format: "landscape" },
    workspaceId,
  );
  return db.reviseProject(p, blankTimeline(p.brief), "Initial");
}
function request(id: string, data?: unknown, key?: string) {
  return new Request(`http://127.0.0.1:3001/api/projects/${id}/render`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie,
      ...(data ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
test("export rechecks active ownership after the route's initial authorization", async () => {
  const p = project();
  let reads = 0;
  const context = {
    get params() {
      if (++reads === 2) db.setProjectTrashed(p.id, true);
      return Promise.resolve({ id: p.id });
    },
  };
  const result = await POST(request(p.id), context);
  assert.equal(
    reads,
    2,
    "the fixture must trash after secureRoute authorization",
  );
  assert.equal(result.status, 404);
  assert.equal(
    db.listJobs(p.id).length,
    0,
    "late export must not escape Trash cancellation",
  );
});

test("streamed admission rechecks Trash and saved revision without partial jobs", async () => {
  for (const mutation of ["trash", "edit"] as const) {
    const p = project();
    let pulled = false;
    const stream = new ReadableStream(
      {
        pull(controller) {
          pulled = true;
          if (mutation === "trash") db.setProjectTrashed(p.id, true);
          else {
            const t = structuredClone(p.timeline!);
            t.scenes[0].title = "Another tab changed the saved video";
            db.reviseProject(db.getProject(p.id)!, t, "Concurrent edit");
          }
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({ baseRevisionId: revisionId(p) }),
            ),
          );
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const input = new Request(request(p.id), {
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await POST(input, { params: Promise.resolve({ id: p.id }) });
    assert(pulled);
    assert.equal(result.status, mutation === "trash" ? 404 : 409);
    assert.equal(db.listJobs(p.id).length, 0);
  }
});
test("export receipts replay the original terminal job, reject changed requests and remain private", async () => {
  const p = project(),
    key = crypto.randomUUID(),
    input = { baseRevisionId: revisionId(p) };
  const call = (data: unknown = input, id = p.id) =>
    POST(request(id, data, key), { params: Promise.resolve({ id }) });
  const first = await call();
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("idempotency-replayed"), "false");
  assert.match(first.headers.get("cache-control")!, /private, no-store/);
  const job = await first.json();
  db.updateJob(job.id, { status: "completed" });
  const t = structuredClone(p.timeline!);
  t.scenes[0].title = "Later work must not change a receipt";
  const latest = db.reviseProject(db.getProject(p.id)!, t, "Later edit");
  const replay = await call();
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal((await replay.json()).id, job.id);
  assert.equal(db.getJob(job.id)?.status, "completed");
  assert.equal(
    (await call({ baseRevisionId: revisionId(latest) })).status,
    409,
  );
  assert.equal(db.listJobs(p.id).length, 1);
  db.setProjectTrashed(p.id, true);
  assert.equal((await call()).status, 404);
  db.setProjectTrashed(p.id, false);
  const other = db.createProject(
    p.brief,
    db.ensureWorkspace("foreign-export-user", "Other").id,
  );
  assert.equal((await call(input, other.id)).status, 404);
  const anonymous = new Request(request(p.id, input, key));
  anonymous.headers.delete("cookie");
  assert.equal(
    (await POST(anonymous, { params: Promise.resolve({ id: p.id }) })).status,
    401,
  );
});
test("body/key validation, legacy bodyless requests and failed admissions preserve queue capacity", async () => {
  const p = project(),
    context = { params: Promise.resolve({ id: p.id }) };
  assert.equal(
    (await POST(request(p.id, {}, "not-a-uuid"), context)).status,
    400,
  );
  assert.equal(
    (await POST(request(p.id, { baseRevisionId: "x".repeat(81) }), context))
      .status,
    400,
  );
  assert.equal(db.listJobs(p.id).length, 0);
  const legacy = await POST(request(p.id), context);
  assert.equal(legacy.status, 202);
  db.updateJob((await legacy.json()).id, { status: "cancelled" });
  const emptyStream = new ReadableStream(
    {
      pull(controller) {
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const streamed = await POST(
    new Request(request(p.id), {
      body: emptyStream,
      duplex: "half",
    } as RequestInit),
    context,
  );
  assert.equal(
    streamed.status,
    202,
    "an empty readable stream is a bodyless request too",
  );
  db.updateJob((await streamed.json()).id, { status: "cancelled" });
  const key = crypto.randomUUID();
  const rejected = await POST(
    request(p.id, { baseRevisionId: "stale-version" }, key),
    context,
  );
  assert.equal(rejected.status, 409);
  const accepted = await POST(
    request(p.id, { baseRevisionId: revisionId(p) }, key),
    context,
  );
  assert.equal(
    accepted.status,
    202,
    "a rejected attempt must not reserve its key",
  );
  const job = await accepted.json();
  db.updateJob(job.id, {
    status: "failed",
    error: "Synthetic terminal failure",
  });
  const replay = await POST(
    request(p.id, { baseRevisionId: revisionId(p) }, key),
    context,
  );
  assert.equal((await replay.json()).status, "failed");
  assert.equal(db.listJobs(p.id).length, 3);
});
test("independent web processes atomically admit one snapshot and replay it even when the queue is full", async () => {
  const p = project(),
    key = crypto.randomUUID();
  const program = `const {createOwnedJob}=await import(${JSON.stringify(new URL("../src/lib/db.ts", import.meta.url).href)});const [id,owner,key,version]=process.argv.slice(1);console.log(JSON.stringify(createOwnedJob(id,owner,{key,baseRevisionId:version})));`;
  async function run() {
    return new Promise<{ job: { id: string }; replayed: boolean }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "-e",
            program,
            p.id,
            owner,
            key,
            revisionId(p)!,
          ],
          { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "",
          errors = "";
        child.stdout.on("data", (c) => (output += c));
        child.stderr.on("data", (c) => (errors += c));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0
            ? resolve(JSON.parse(output))
            : reject(new Error(errors || `Child exited ${code}`)),
        );
      },
    );
  }
  const results = await Promise.all(Array.from({ length: 4 }, run));
  assert.equal(new Set(results.map((r) => r.job.id)).size, 1);
  assert.equal(results.filter((r) => !r.replayed).length, 1);
  assert.equal(db.listJobs(p.id).length, 1);
  const otherProjects = ["queue-filler-a", "queue-filler-b"].map((user) => {
    const workspace = db.ensureWorkspace(user, user).id;
    return { workspace, project: project(workspace) };
  });
  const filling = Array.from({ length: 4 }, (_, index) => {
    const other = otherProjects[index % 2];
    return db.createOwnedJob(other.project.id, other.workspace)!.job;
  });
  assert.equal(
    db.createOwnedJob(p.id, owner, { key, baseRevisionId: revisionId(p) })?.job
      .id,
    results[0].job.id,
  );
  assert.throws(
    () =>
      db.createOwnedJob(p.id, owner, {
        key: crypto.randomUUID(),
        baseRevisionId: revisionId(p),
      }),
    /queue is full/,
  );
  const denied = db.createOwnedJob(
    p.id,
    db.ensureWorkspace("wrong-workspace", "Other").id,
    { key },
  );
  assert.equal(denied, undefined);
  for (const job of [...filling, results[0].job])
    db.updateJob(job.id, { status: "cancelled" });
});
