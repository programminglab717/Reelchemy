import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-export-files-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  { GET, POST } = await import("../src/app/api/jobs/[id]/files/route"),
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
const owner = await account("export-files-owner"),
  foreign = await account("export-files-foreign");
const brief = {
  prompt: "Private export history",
  duration: 5,
  format: "landscape" as const,
};
function project() {
  return app.reviseProject(
    app.createProject(brief, owner.workspace),
    blankTimeline(brief),
    "Initial",
  );
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(
  id: string,
  body: unknown,
  cookie = owner.cookie,
  expected = owner.id,
  origin = "http://127.0.0.1:3001",
) {
  return new Request(`http://127.0.0.1:3001/api/jobs/${id}/files`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3001",
      origin,
      cookie,
      [ACCOUNT_HEADER]: expected,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function completed() {
  const saved = project(),
    job = app.createOwnedJob(saved.id, owner.workspace)!.job;
  app.updateJob(job.id, { status: "completed", progress: 1 });
  const dir = path.join(app.artifactDir, job.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "video.mp4"), "owned export bytes");
  await writeFile(path.join(dir, "report.json"), "owned review");
  return { saved, job, dir };
}
function privateHeaders(r: Response) {
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
}
test("authenticated cleanup reviews before typed confirmation, rejects stale files, replays lost responses and preserves the saved film", async () => {
  const { saved, job, dir } = await completed(),
    original = JSON.stringify(app.getProject(saved.id));
  const preview = await POST(
    request(job.id, { action: "preview" }),
    context(job.id),
  );
  assert.equal(preview.status, 200);
  privateHeaders(preview);
  const reviewed = (await preview.json()).preview;
  assert.equal(reviewed.files, 2);
  assert(!JSON.stringify(reviewed).includes("workspaceId"));
  assert.equal(
    (
      await POST(
        request(job.id, {
          action: "remove",
          digest: reviewed.digest,
          confirmation: "remove",
        }),
        context(job.id),
      )
    ).status,
    400,
  );
  await writeFile(path.join(dir, "video.mp4"), "changed export bytes");
  assert.equal(
    (
      await POST(
        request(job.id, {
          action: "remove",
          digest: reviewed.digest,
          confirmation: "REMOVE EXPORT",
        }),
        context(job.id),
      )
    ).status,
    409,
  );
  assert.equal(app.exportFileRemoval(job.id, owner.workspace), undefined);
  const current = (
      await (
        await POST(request(job.id, { action: "preview" }), context(job.id))
      ).json()
    ).preview,
    command = {
      action: "remove",
      digest: current.digest,
      confirmation: "REMOVE EXPORT",
    };
  const accepted = await POST(request(job.id, command), context(job.id));
  assert.equal(accepted.status, 202);
  privateHeaders(accepted);
  const receipt = (await accepted.json()).removal;
  assert.equal(app.getJob(job.id)?.files?.state, "queued");
  assert.equal(
    app.projectExportPage(saved.id, owner.workspace)!.items[0].fileState,
    "queued",
  );
  const { GET: download } =
      await import("../src/app/api/jobs/[id]/download/route"),
    denied = await download(
      new Request(`http://127.0.0.1:3001/api/jobs/${job.id}/download`, {
        headers: { cookie: owner.cookie },
      }),
      context(job.id),
    );
  assert.equal(denied.status, 404);
  privateHeaders(denied);
  const repeated = await POST(request(job.id, command), context(job.id));
  assert.equal(repeated.status, 200);
  assert.deepEqual((await repeated.json()).removal, receipt);
  const { processExportFileRemoval } =
    await import("../src/lib/export-file-cleanup");
  assert.equal(await processExportFileRemoval(() => false), true);
  assert.equal(app.getJob(job.id)?.files?.state, "completed");
  await assert.rejects(lstat(dir), { code: "ENOENT" });
  assert.equal(JSON.stringify(app.getProject(saved.id)), original);
  assert.equal(app.getJob(job.id)?.status, "completed");
  assert(app.createOwnedJob(saved.id, owner.workspace)?.job.id !== job.id);
});
test("auth, actor, origin, body limits and cancelled-attempt guard precede filesystem reads", async () => {
  const { job, dir } = await completed();
  for (const [cookie, actor, status] of [
    ["", owner.id, 401],
    [foreign.cookie, foreign.id, 404],
    [owner.cookie, foreign.id, 409],
  ] as const) {
    const r = await POST(
      request(job.id, { action: "preview" }, cookie, actor),
      context(job.id),
    );
    assert.equal(r.status, status);
    privateHeaders(r);
  }
  assert.equal(
    (
      await POST(
        request(
          job.id,
          { action: "preview" },
          owner.cookie,
          owner.id,
          "https://foreign.test",
        ),
        context(job.id),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await POST(
        request(job.id, { action: "preview", oversized: "x".repeat(2000) }),
        context(job.id),
      )
    ).status,
    400,
  );
  inspect.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);
  inspect
    .prepare("INSERT INTO render_job_attempts VALUES(?,?)")
    .run(job.id, new Date().toISOString());
  assert.equal(
    (await POST(request(job.id, { action: "preview" }), context(job.id)))
      .status,
    409,
  );
  assert.equal(app.exportFileRemoval(job.id, owner.workspace), undefined);
  app.finishJobAttempt(job.id);
  assert.equal(
    (await POST(request(job.id, { action: "preview" }), context(job.id)))
      .status,
    200,
  );
  assert.equal(
    await readFile(path.join(dir, "video.mp4"), "utf8"),
    "owned export bytes",
  );
  const r = await GET(
    new Request(`http://127.0.0.1:3001/api/jobs/${job.id}/files`, {
      headers: { cookie: owner.cookie },
    }),
    context(job.id),
  );
  assert.equal(r.status, 200);
  privateHeaders(r);
});
test("indexed job ownership overrides forged legacy JSON", async () => {
  const { job } = await completed(),
    foreignProject = app.createProject(brief, foreign.workspace),
    data = app.getJob(job.id)!;
  inspect
    .prepare("UPDATE jobs SET data=? WHERE id=?")
    .run(
      JSON.stringify({
        ...data,
        projectId: foreignProject.id,
        status: "queued",
        files: { state: "completed" },
      }),
      job.id,
    );
  assert.equal(app.getJob(job.id)?.projectId, data.projectId);
  assert.equal(app.getJob(job.id)?.status, "completed");
  assert.equal(app.getJob(job.id)?.files, undefined);
  const r = await POST(
    request(job.id, { action: "preview" }, foreign.cookie, foreign.id),
    context(job.id),
  );
  assert.equal(r.status, 404);
  privateHeaders(r);
});
