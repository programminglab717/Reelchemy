import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { blankTimeline } from "../src/lib/editor";
import {
  maximumJobDocumentBytes,
  JobHistoryUnavailable,
} from "../src/lib/job-history-policy";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-legacy-job-read-")),
  data = path.join(root, "data"),
  projectId = randomUUID(),
  completed = randomUUID(),
  queued = randomUUID(),
  brief = {
    prompt: "Legacy film stays usable",
    duration: 5,
    format: "landscape" as const,
  },
  timeline = blankTimeline(brief),
  now = new Date().toISOString();
await mkdir(data);
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: data,
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
// Seed an actual pre-account database before the current migration/guards run.
// No current guard is removed or relaxed to manufacture an oversized record.
const legacy = new Database(path.join(data, "studio.sqlite"));
legacy.exec(
  "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT)",
);
legacy.prepare("INSERT INTO projects VALUES(?,?)").run(
  projectId,
  JSON.stringify({
    id: projectId,
    name: brief.prompt,
    brief,
    timeline,
    assets: [],
    messages: [],
    revisions: [
      {
        id: randomUUID(),
        source: "Legacy saved film",
        timeline,
        createdAt: now,
      },
    ],
    createdAt: now,
  }),
);
for (const [id, status] of [
  [completed, "completed"],
  [queued, "queued"],
])
  legacy.prepare("INSERT INTO jobs VALUES(?,?,?,?,?)").run(
    id,
    projectId,
    status,
    JSON.stringify({
      id,
      projectId,
      status,
      progress: 0,
      error: null,
      createdAt: now,
      issues: [],
      report: {
        private:
          "LEGACY_REPORT_CANARY" + "x".repeat(maximumJobDocumentBytes + 1),
      },
    }),
    JSON.stringify(timeline),
  );
const hashes = legacy.prepare("SELECT id,data FROM jobs ORDER BY id").all() as {
    id: string;
    data: string;
  }[],
  hash = (value: string) => createHash("sha256").update(value).digest("hex"),
  before = hashes.map((value) => ({ id: value.id, hash: hash(value.data) }));
legacy.close();
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  { GET } = await import("../src/app/api/jobs/[id]/route"),
  { GET: download } = await import("../src/app/api/jobs/[id]/history/route"),
  inspect = new Database(path.join(data, "studio.sqlite"));
after(async () => {
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Legacy-read-fixture-passphrase-8932",
    signup = await auth.api.signUpEmail({ body: { name, email, password } }),
    privateDb = new Database(path.join(root, "auth/auth.sqlite"));
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
test("oversized legacy details remain intact, cannot hydrate across owners or acquire a native lease, and leave the saved film readable", async () => {
  const owner = await account("legacy-read-owner"),
    foreign = await account("legacy-read-foreign");
  inspect
    .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
    .run(owner.workspace, projectId);
  const context = { params: Promise.resolve({ id: completed }) },
    request = (actor = owner) =>
      new Request(`http://127.0.0.1:3001/api/jobs/${completed}`, {
        headers: { cookie: actor.cookie, [ACCOUNT_HEADER]: actor.id },
      });
  const privateHeaders = (response: Response) => {
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  };
  const concealed = await GET(request(foreign), context);
  assert.equal(concealed.status, 404);
  privateHeaders(concealed);
  const own = await GET(request(), context);
  assert.equal(own.status, 503);
  privateHeaders(own);
  const body = await own.json();
  assert.equal(body.code, "JOB_HISTORY_UNAVAILABLE");
  assert(!JSON.stringify(body).includes("LEGACY_REPORT_CANARY"));
  assert(!JSON.stringify(body).includes(root));
  const archive = await download(request(), context);
  assert.equal(archive.status, 503);
  privateHeaders(archive);
  assert.equal(
    (
      inspect
        .prepare("SELECT count(*) AS n FROM export_file_reviews")
        .get() as { n: number }
    ).n,
    0,
  );
  assert.throws(() => app.claimJob(), JobHistoryUnavailable);
  assert.equal(
    (
      inspect
        .prepare("SELECT count(*) AS n FROM render_job_attempts")
        .get() as { n: number }
    ).n,
    0,
  );
  assert.equal(
    (
      inspect.prepare("SELECT status FROM jobs WHERE id=?").get(queued) as {
        status: string;
      }
    ).status,
    "queued",
  );
  assert.deepEqual(app.getProject(projectId)!.timeline, timeline);
  const queue = app.activeStudioExports(owner.workspace);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].id, queued);
  assert.equal(queue[0].projectId, projectId);
  assert.equal(queue[0].status, "queued");
  assert(JSON.stringify(queue).length < 1000);
  assert(!JSON.stringify(queue).includes("LEGACY_REPORT_CANARY"));
  const page = app.projectExportPage(projectId, owner.workspace)!;
  assert.equal(page.items.length, 2);
  assert(page.items.every((item) => item.createdAt === null));
  assert(JSON.stringify(page).length < 2000);
  const after = inspect
    .prepare("SELECT id,data FROM jobs ORDER BY id")
    .all() as { id: string; data: string }[];
  assert.deepEqual(
    after.map((value) => ({ id: value.id, hash: hash(value.data) })),
    before,
  );
});
