import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { blankTimeline, revisionId } from "../src/lib/editor";
import {
  activeExportLimit,
  ExportCapacityError,
} from "../src/lib/export-policy";
import { LimitConfigurationError } from "../src/lib/limits-policy";
import { failure } from "../src/lib/http";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-export-capacity-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO = "2";
after(() => rm(dir, { recursive: true, force: true }));
const db = await import("../src/lib/db");
const brief = {
  prompt: "Active export",
  duration: 5,
  format: "landscape" as const,
};
function project(owner: string) {
  const p = db.createProject(brief, owner);
  return db.reviseProject(p, blankTimeline(brief), "Initial");
}
function cleanup(projects: { id: string }[]) {
  for (const p of projects)
    for (const j of db.listJobs(p.id))
      db.updateJob(j.id, { status: "cancelled" });
}
test("bounded studio policy and capacity errors distinguish private account limits from global saturation", async () => {
  assert.equal(activeExportLimit({}), 2);
  for (const n of [1, 2, 5])
    assert.equal(
      activeExportLimit({ REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: String(n) }),
      n,
    );
  for (const n of ["0", "6", "02", " 2", "2.5", "2e0", "unlimited"])
    assert.throws(
      () => activeExportLimit({ REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: n }),
      LimitConfigurationError,
    );
  for (const scope of ["studio", "global"] as const) {
    const response = failure(new ExportCapacityError(scope));
    assert.equal(response.status, scope === "studio" ? 429 : 503);
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).code, "EXPORT_CAPACITY");
  }
});
test("queued/rendering exports share the studio cap; replay, cancellation, Trash and completion preserve admission semantics", () => {
  const alice = db.ensureWorkspace("capacity-alice", "Alice"),
    bob = db.ensureWorkspace("capacity-bob", "Bob");
  const a = [project(alice.id), project(alice.id), project(alice.id)],
    b = project(bob.id);
  const key = crypto.randomUUID(),
    retryKey = crypto.randomUUID();
  try {
    const first = db.createOwnedJob(a[0].id, alice.id, {
      key,
      baseRevisionId: revisionId(a[0]),
    })!.job;
    const second = db.createOwnedJob(a[1].id, alice.id)!.job;
    assert.throws(
      () => db.createOwnedJob(a[2].id, alice.id, { key: retryKey }),
      (e) => e instanceof ExportCapacityError && e.scope === "studio",
    );
    assert.equal(db.listJobs(a[2].id).length, 0);
    assert.equal(
      db.createOwnedJob(a[0].id, alice.id, {
        key,
        baseRevisionId: revisionId(a[0]),
      })?.job.id,
      first.id,
    );
    db.createOwnedJob(b.id, bob.id);
    const current = db.activeStudioExports(alice.id);
    assert.equal(current.length, 2);
    assert.deepEqual(Object.keys(current[0]).sort(), [
      "createdAt",
      "id",
      "progress",
      "projectId",
      "projectName",
      "stage",
      "status",
    ]);
    assert.equal(db.claimJob()?.job.id, first.id);
    assert.equal(
      db.activeStudioExports(alice.id).filter((j) => j.status === "rendering")
        .length,
      1,
    );
    db.renameProject(a[1].id, "Renamed queued video", a[1].name);
    assert(
      db
        .activeStudioExports(alice.id)
        .some((j) => j.projectName === "Renamed queued video"),
    );
    db.setProjectTrashed(a[1].id, true);
    assert.equal(db.getJob(second.id)?.status, "cancelled");
    assert.equal(db.activeStudioExports(alice.id).length, 1);
    const third = db.createOwnedJob(a[2].id, alice.id, { key: retryKey })!.job;
    db.updateJob(first.id, { status: "cancelled" });
    db.updateJob(third.id, { status: "completed" });
    assert.deepEqual(db.activeStudioExports(alice.id), []);
    assert.equal(db.activeStudioExports(bob.id).length, 1);
  } finally {
    cleanup([...a, b]);
  }
});
test("separate web processes cannot exceed a studio cap while other studios can use the remaining shared queue", async () => {
  const owner = db.ensureWorkspace("capacity-race", "Race owner").id;
  const p = project(owner);
  const program = `const {createOwnedJob}=await import(${JSON.stringify(new URL("../src/lib/db.ts", import.meta.url).href)});const [id,owner]=process.argv.slice(1);try{console.log(JSON.stringify({id:createOwnedJob(id,owner).job.id}))}catch(e){if(e.name!=='Error'||!e.scope)throw e;console.log(JSON.stringify({limited:e.scope}))}`;
  const run = () =>
    new Promise<{ id?: string; limited?: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", program, p.id, owner],
        { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "",
        errors = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (errors += c));
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve(JSON.parse(out))
          : reject(new Error(errors || `Child exited ${code}`)),
      );
    });
  const others = [];
  try {
    const results = await Promise.all(Array.from({ length: 4 }, run));
    assert.equal(results.filter((r) => r.id).length, 2);
    assert.equal(results.filter((r) => r.limited === "studio").length, 2);
    assert.equal(db.activeStudioExports(owner).length, 2);
    for (let n = 0; n < 3; n++) {
      const workspace = db.ensureWorkspace(`capacity-other-${n}`, "Other").id;
      const next = project(workspace);
      others.push(next);
      assert(db.createOwnedJob(next.id, workspace));
    }
    const extraOwner = db.ensureWorkspace("capacity-over-global", "Other").id;
    const extra = project(extraOwner);
    others.push(extra);
    assert.throws(
      () => db.createOwnedJob(extra.id, extraOwner),
      (e) => e instanceof ExportCapacityError && e.scope === "global",
    );
  } finally {
    cleanup([p, ...others]);
  }
});
test("private queue APIs enforce capacity, ignore supplied workspace IDs and fail closed on bad operator settings", async () => {
  const { getAuth } = await import("../src/lib/auth"),
    auth = await getAuth();
  const email = "capacity-api@example.test",
    password = "Test-only-capacity-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Queue owner" },
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
  const owner = db.ensureWorkspace(signup.user.id, "Queue owner").id;
  const foreign = db.ensureWorkspace("capacity-api-foreign", "Foreign").id;
  const own = [project(owner), project(owner), project(owner)],
    other = project(foreign);
  const { GET } = await import("../src/app/api/workspace/exports/route");
  const { POST } = await import("../src/app/api/projects/[id]/render/route");
  const context = { params: Promise.resolve({}) };
  const url = `http://127.0.0.1:3001/api/workspace/exports?workspaceId=${foreign}`;
  const request = () => new Request(url, { headers: { cookie } });
  const post = (id: string, key: string) =>
    POST(
      new Request(`http://127.0.0.1:3001/api/projects/${id}/render`, {
        method: "POST",
        headers: {
          cookie,
          host: "127.0.0.1:3001",
          origin: "http://127.0.0.1:3001",
          "idempotency-key": key,
        },
      }),
      { params: Promise.resolve({ id }) },
    );
  try {
    const first = db.createOwnedJob(own[0].id, owner)!.job;
    db.createOwnedJob(own[1].id, owner);
    db.createOwnedJob(other.id, foreign);
    const response = await GET(request(), context);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const payload = await response.json();
    assert.equal(payload.limit, 2);
    assert.equal(payload.exports.length, 2);
    assert(
      payload.exports.every(
        (j: { projectId: string }) => j.projectId !== other.id,
      ),
    );
    assert.equal((await GET(new Request(url), context)).status, 401);
    const key = crypto.randomUUID(),
      denied = await post(own[2].id, key);
    assert.equal(denied.status, 429);
    assert.equal((await denied.json()).scope, "studio");
    db.updateJob(first.id, { status: "cancelled" });
    assert.equal((await post(own[2].id, key)).status, 202);
    process.env.REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO = "0";
    assert.equal((await GET(request(), context)).status, 503);
    assert.equal(
      (await (await import("../src/lib/health")).readiness()).checks.limits,
      false,
    );
  } finally {
    process.env.REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO = "2";
    cleanup([...own, other]);
  }
});
