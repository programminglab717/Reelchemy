import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, lstat, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(
  path.join(tmpdir(), "reelchemy-export-storage-api-"),
);
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  REELCHEMY_EXPORT_RESERVATION_BYTES: "1048576",
  REELCHEMY_EXPORT_STUDIO_BYTES: "2097152",
  REELCHEMY_EXPORT_SERVICE_BYTES: "3145728",
  REELCHEMY_EXPORT_STUDIO_COUNT: "10",
  REELCHEMY_EXPORT_SERVICE_COUNT: "20",
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  { GET } = await import("../src/app/api/workspace/export-storage/route"),
  { POST: render } = await import("../src/app/api/projects/[id]/render/route"),
  { DELETE: cancel } = await import("../src/app/api/jobs/[id]/route"),
  inspect = new Database(path.join(root, "data", "studio.sqlite"));
after(async () => {
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "History-fixture-passphrase-8932";
  const signup = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  const privateDb = new Database(path.join(root, "auth", "auth.sqlite"));
  privateDb
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  privateDb.close();
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
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
const owner = await account("export-budget-owner"),
  foreign = await account("export-budget-foreign"),
  third = await account("export-budget-third");
const brief = {
  prompt: "Private export history",
  duration: 5,
  format: "landscape" as const,
};
function project(workspaceId = owner.workspace) {
  return app.reviseProject(
    app.createProject(brief, workspaceId),
    blankTimeline(brief),
    "Initial",
  );
}

const MiB = 1024 ** 2,
  context = (id: string) => ({ params: Promise.resolve({ id }) }),
  hash = (value: string) => createHash("sha256").update(value).digest("hex");
function request(
  pathname: string,
  method = "GET",
  body?: unknown,
  actor = owner,
  key?: string,
) {
  return new Request(`http://127.0.0.1:3001${pathname}`, {
    method,
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie: actor.cookie,
      [ACCOUNT_HEADER]: actor.id,
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function usage(actor = owner) {
  const response = await GET(
    request("/api/workspace/export-storage", "GET", undefined, actor),
    context("unused"),
  );
  assert.equal(response.status, 200);
  return response.json();
}
function privateHeaders(r: Response) {
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
}
test("private usage, atomic capacity, receipt replay and actual reviewed cleanup preserve films and free only deleted bytes", async () => {
  const saved = project(),
    before = hash(JSON.stringify(app.getProject(saved.id))),
    key = randomUUID(),
    first = await render(
      request(`/api/projects/${saved.id}/render`, "POST", {}, owner, key),
      context(saved.id),
    );
  assert.equal(first.status, 202);
  const job = await first.json();
  assert.equal((await usage()).reservedBytes, MiB);
  const directory = path.join(app.artifactDir, job.id);
  await mkdir(directory, { recursive: true });
  const file = await open(path.join(directory, "video.mp4"), "w");
  await file.truncate(MiB + 1);
  await file.close();
  app.updateJob(job.id, { status: "completed" });
  app.finishJobAttempt(job.id, { bytes: MiB + 1, files: 1 });
  assert.equal((await usage()).usedBytes, MiB + 1);
  assert.equal((await usage()).reservedBytes, 0);
  const rejected = await render(
    request(`/api/projects/${saved.id}/render`, "POST", {}),
    context(saved.id),
  );
  assert.equal(rejected.status, 413);
  privateHeaders(rejected);
  assert.equal((await rejected.json()).code, "EXPORT_STORAGE_LIMIT");
  const replay = await render(
    request(`/api/projects/${saved.id}/render`, "POST", {}, owner, key),
    context(saved.id),
  );
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal((await replay.json()).id, job.id);
  const b = project(foreign.workspace),
    admitted = await render(
      request(`/api/projects/${b.id}/render`, "POST", {}, foreign),
      context(b.id),
    );
  assert.equal(admitted.status, 202);
  assert.equal((await usage(foreign)).usedBytes, 0);
  assert.equal((await usage(foreign)).reservedBytes, MiB);
  const c = project(third.workspace),
    shared = await render(
      request(`/api/projects/${c.id}/render`, "POST", {}, third),
      context(c.id),
    );
  assert.equal(shared.status, 503);
  assert.equal(shared.headers.get("retry-after"), "30");
  const error = await shared.json();
  assert.equal(error.scope, "service");
  assert(!JSON.stringify(error).includes(owner.workspace));
  assert.equal(error.usedBytes, undefined);
  const { POST: files } = await import("../src/app/api/jobs/[id]/files/route"),
    preview = await files(
      request(`/api/jobs/${job.id}/files`, "POST", { action: "preview" }),
      context(job.id),
    );
  assert.equal(preview.status, 200);
  const digest = (await preview.json()).preview.digest;
  const queued = await files(
    request(`/api/jobs/${job.id}/files`, "POST", {
      action: "remove",
      confirmation: "REMOVE EXPORT",
      digest,
    }),
    context(job.id),
  );
  assert.equal(queued.status, 202);
  assert.equal((await usage()).usedBytes, MiB + 1);
  const { processExportFileRemoval } =
    await import("../src/lib/export-file-cleanup");
  assert.equal(await processExportFileRemoval(() => false), true);
  assert.equal((await usage()).usedBytes, 0);
  assert.equal((await usage()).retainedExports, 0);
  await assert.rejects(lstat(directory), { code: "ENOENT" });
  assert.equal(hash(JSON.stringify(app.getProject(saved.id))), before);
  const after = await render(
    request(`/api/projects/${c.id}/render`, "POST", {}, third),
    context(c.id),
  );
  assert.equal(after.status, 202);
  assert.equal((await usage(third)).reservedBytes, MiB);
});
test("queued cancellation frees its pristine hold and actor/origin failures cannot reserve or release another studio", async () => {
  const saved = project(),
    admitted = await render(
      request(`/api/projects/${saved.id}/render`, "POST", {}),
      context(saved.id),
    );
  assert.equal(admitted.status, 202);
  const job = await admitted.json();
  assert.equal((await usage()).reservedBytes, MiB);
  const wrong = new Request(`http://127.0.0.1:3001/api/jobs/${job.id}`, {
    method: "DELETE",
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie: owner.cookie,
      [ACCOUNT_HEADER]: foreign.id,
    },
  });
  assert.equal((await cancel(wrong, context(job.id))).status, 409);
  assert.equal((await usage()).reservedBytes, MiB);
  const stopped = await cancel(
    request(`/api/jobs/${job.id}`, "DELETE"),
    context(job.id),
  );
  assert.equal(stopped.status, 200);
  assert.equal((await usage()).reservedBytes, 0);
  const read = await GET(
    new Request("http://127.0.0.1:3001/api/workspace/export-storage"),
    context("unused"),
  );
  assert.equal(read.status, 401);
  privateHeaders(read);
  const mismatch = await GET(
    new Request("http://127.0.0.1:3001/api/workspace/export-storage", {
      headers: { cookie: owner.cookie, [ACCOUNT_HEADER]: foreign.id },
    }),
    context("unused"),
  );
  assert.equal(mismatch.status, 409);
  privateHeaders(mismatch);
});
test("retained-file pages use the authenticated studio, refuse foreign cursors and return no report or timeline", async () => {
  const { GET: list } =
    await import("../src/app/api/workspace/export-storage/files/route");
  const saved = project(),
    job = app.createOwnedJob(saved.id, owner.workspace)!.job;
  app.updateJob(job.id, { status: "failed" });
  app.finishJobAttempt(job.id, { bytes: 4, files: 1 });
  const response = await list(
    request("/api/workspace/export-storage/files"),
    context("unused"),
  );
  assert.equal(response.status, 200);
  privateHeaders(response);
  const page = await response.json();
  assert.deepEqual(
    page.items.map((item: { id: string }) => item.id),
    [job.id],
  );
  assert.equal(page.items[0].projectId, saved.id);
  assert.equal(page.items[0].bytes, 4);
  for (const field of ["timeline", "report", "workspaceId", "position", "data"])
    assert.equal(page.items[0][field], undefined);
  const foreignRead = await list(
    request("/api/workspace/export-storage/files", "GET", undefined, foreign),
    context("unused"),
  );
  assert.equal(foreignRead.status, 200);
  assert.equal((await foreignRead.json()).items.length, 0);
  const tampered = await list(
    request(
      `/api/workspace/export-storage/files?anchor=${page.anchor}`,
      "GET",
      undefined,
      foreign,
    ),
    context("unused"),
  );
  assert.equal(tampered.status, 422);
  privateHeaders(tampered);
  assert.equal(
    (
      await list(
        request(
          `/api/workspace/export-storage/files?workspace=${foreign.workspace}`,
        ),
        context("unused"),
      )
    ).status,
    422,
  );
  const signedOut = await list(
    new Request("http://127.0.0.1:3001/api/workspace/export-storage/files"),
    context("unused"),
  );
  assert.equal(signedOut.status, 401);
  privateHeaders(signedOut);
  app.finishJobAttempt(job.id, { bytes: 0, files: 0 });
});
test("an untracked legacy row fails closed for new export admission while private saved work remains readable", async () => {
  const saved = project(),
    id = randomUUID();
  inspect
    .prepare("INSERT INTO jobs VALUES(?,?,'cancelled',?,?)")
    .run(
      id,
      saved.id,
      JSON.stringify({ id, projectId: saved.id, status: "cancelled" }),
      JSON.stringify(saved.timeline),
    );
  const blocked = await GET(
    request("/api/workspace/export-storage"),
    context("unused"),
  );
  assert.equal(blocked.status, 503);
  privateHeaders(blocked);
  assert.equal((await blocked.json()).code, "EXPORT_STORAGE_UNAVAILABLE");
  const rejected = await render(
    request(`/api/projects/${saved.id}/render`, "POST", {}),
    context(saved.id),
  );
  assert.equal(rejected.status, 503);
  assert(app.projectInWorkspace(saved.id, owner.workspace));
  assert.deepEqual(app.getProject(saved.id)?.timeline, saved.timeline);
});
