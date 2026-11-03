import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import { ExportHistoryUnavailable } from "../src/lib/export-history";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-export-history-"));
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
  { GET } = await import("../src/app/api/projects/[id]/render/route"),
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
const owner = await account("export-history-owner"),
  foreign = await account("export-history-foreign");
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
const saved = project(),
  prototype = app.createOwnedJob(saved.id, owner.workspace)!.job;
app.updateJob(prototype.id, { status: "completed" });
const original = app.getJob(prototype.id)!,
  privateReport = "PRIVATE_REPORT_CANARY" + "x".repeat(65536);
const timeline = JSON.stringify(saved.timeline);
const insert = inspect.prepare(
  "INSERT INTO jobs(id,project_id,status,data,timeline) VALUES(?,?,?,?,?)",
);
const ids = [prototype.id];
inspect
  .transaction(() => {
    for (let i = 0; i < 85; i++) {
      const id = i ? randomUUID() : prototype.id,
        data = JSON.stringify({
          ...original,
          id,
          report: { privateReport, timeline: saved.timeline },
          createdAt: new Date(Date.UTC(2026, 10, 3, 0, 0, i)).toISOString(),
        });
      if (i) {
        insert.run(id, saved.id, "completed", data, timeline);
        ids.push(id);
      } else inspect.prepare("UPDATE jobs SET data=? WHERE id=?").run(data, id);
    }
  })
  .immediate();
function hashRows() {
  const hash = createHash("sha256");
  for (const row of inspect
    .prepare(
      "SELECT id,data,timeline FROM jobs WHERE project_id=? ORDER BY rowid",
    )
    .iterate(saved.id) as Iterable<{
    id: string;
    data: string;
    timeline: string;
  }>)
    hash.update(row.id).update(row.data).update(row.timeline);
  return hash.digest("hex");
}
function request(
  id = saved.id,
  query = "?view=history",
  cookie = owner.cookie,
  expected = owner.id,
) {
  return new Request(
    `http://127.0.0.1:3001/api/projects/${id}/render${query}`,
    { headers: { cookie, [ACCOUNT_HEADER]: expected } },
  );
}
const context = (id = saved.id) => ({ params: Promise.resolve({ id }) });
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
test("large export history projects only bounded owned metadata and leaves original reports/timelines and legacy API intact", async () => {
  const before = hashRows(),
    response = await GET(request(), context());
  assert.equal(response.status, 200);
  privateHeaders(response);
  const text = await response.text(),
    page = JSON.parse(text);
  assert(text.length < 10000);
  assert(!text.includes("PRIVATE_REPORT_CANARY"));
  assert.equal(page.total, 85);
  assert.equal(page.items.length, 20);
  assert.deepEqual(
    page.items.map((item: { id: string }) => item.id),
    ids.slice(-20).reverse(),
  );
  assert.deepEqual(Object.keys(page.items[0]).sort(), [
    "createdAt",
    "id",
    "projectId",
    "status",
  ]);
  const legacy = await GET(request(saved.id, ""), context());
  assert.equal(legacy.status, 200);
  const full = await legacy.json();
  assert.equal(full.length, 30);
  assert.equal(full[0].report.privateReport, privateReport);
  assert.equal(hashRows(), before);
});
test("cursor pages remain stable across appended jobs, cover all older exports exactly once and refresh explicitly", () => {
  const first = app.projectExportPage(saved.id, owner.workspace)!,
    seen = [...first.items.map((item) => item.id)];
  const added = randomUUID();
  insert.run(
    added,
    saved.id,
    "completed",
    JSON.stringify({ ...original, id: added }),
    timeline,
  );
  let next = first.nextBefore;
  while (next !== null) {
    const page = app.projectExportPage(saved.id, owner.workspace, {
      anchor: first.anchor,
      before: next,
    })!;
    assert.equal(page.total, 85);
    seen.push(...page.items.map((item) => item.id));
    next = page.nextBefore;
  }
  assert.equal(seen.length, 85);
  assert.equal(new Set(seen).size, 85);
  assert.deepEqual(seen, [...ids].reverse());
  assert(!seen.includes(added));
  assert.deepEqual(
    app.projectExportPage(saved.id, owner.workspace, { anchor: first.anchor })!
      .items,
    first.items,
  );
  assert.equal(
    app.projectExportPage(saved.id, owner.workspace)!.items[0].id,
    added,
  );
});
test("malformed legacy records cannot transfer oversized/private metadata or prevent raw cursor progress", () => {
  const p = project();
  const good = randomUUID();
  insert.run(
    good,
    p.id,
    "completed",
    JSON.stringify({ createdAt: "2026-11-03T08:00:00+05:00", privateReport }),
    timeline,
  );
  insert.run(randomUUID(), p.id, "completed", "{broken", timeline);
  for (let i = 0; i < 22; i++)
    insert.run(
      randomUUID(),
      p.id,
      "PRIVATE_STATUS_CANARY",
      JSON.stringify({ createdAt: "PRIVATE_DATE_CANARY".repeat(10000) }),
      timeline,
    );
  const first = app.projectExportPage(p.id, owner.workspace)!;
  assert.equal(first.items.length, 0);
  assert.equal(first.unavailable, 20);
  assert(first.nextBefore);
  const second = app.projectExportPage(p.id, owner.workspace, {
    anchor: first.anchor,
    before: first.nextBefore,
  })!;
  assert.equal(second.unavailable, 2);
  assert.equal(second.items.length, 2);
  assert.equal(second.nextBefore, null);
  assert.equal(second.items[0].createdAt, null);
  assert.equal(second.items[1].createdAt, "2026-11-03T03:00:00.000Z");
  assert(!JSON.stringify([first, second]).includes("PRIVATE_"));
});
test("verified ownership/account binding and active-project checks precede export history and retain private headers", async () => {
  for (const [cookie, actor, status] of [
    ["", "", 401],
    [foreign.cookie, foreign.id, 404],
    [owner.cookie, foreign.id, 409],
  ] as const) {
    const response = await GET(
      request(saved.id, "?view=history", cookie, actor),
      context(),
    );
    assert.equal(response.status, status);
    privateHeaders(response);
    assert(!(await response.text()).includes(prototype.id));
  }
  app.setProjectTrashed(saved.id, true);
  try {
    const response = await GET(request(), context());
    assert.equal(response.status, 404);
    privateHeaders(response);
  } finally {
    app.setProjectTrashed(saved.id, false);
  }
  const p = project();
  app.setProjectTrashed(p.id, true);
  app.requestOwnedProjectDeletion(p.id, owner.workspace);
  assert.equal(app.projectExportPage(p.id, owner.workspace), undefined);
  assert.equal(app.projectExportPage(saved.id, foreign.workspace), undefined);
});
test("invalid cursors/views fail privately without exposing content or changing saved export rows", async () => {
  const before = hashRows();
  for (const query of [
    "?view=all",
    "?view=history&before=-1",
    "?view=history&anchor=1e3",
    "?view=history&anchor=9007199254740992",
    "?view=history&before=01",
    "?view=history&before=1&before=2",
    "?view=history&extra=PRIVATE_QUERY_CANARY",
  ]) {
    const response = await GET(request(saved.id, query), context());
    assert.equal(response.status, 400);
    privateHeaders(response);
    assert(!(await response.text()).includes("PRIVATE_"));
  }
  for (const cursor of [
    { before: "-1" },
    { anchor: "Infinity" },
    { before: "1.5" },
  ])
    assert.throws(
      () => app.projectExportPage(saved.id, owner.workspace, cursor),
      ExportHistoryUnavailable,
    );
  assert.equal(hashRows(), before);
});
test("opaque cursors resist modification and bind both the owner/project and snapshot without leaking shared sequence numbers", async () => {
  const first = app.projectExportPage(saved.id, owner.workspace)!;
  assert.match(first.anchor, /^v1\.[A-Za-z0-9_-]+$/);
  assert.match(first.nextBefore!, /^v1\.[A-Za-z0-9_-]+$/);
  const p = project();
  const added = randomUUID();
  insert.run(
    added,
    saved.id,
    "completed",
    JSON.stringify({ ...original, id: added }),
    timeline,
  );
  const newerAnchor = app.projectExportPage(saved.id, owner.workspace)!.anchor;
  const token = first.anchor;
  const modified =
    token.slice(0, 10) + (token[10] === "A" ? "B" : "A") + token.slice(11);
  for (const [id, anchor, before] of [
    [saved.id, modified, first.nextBefore!],
    [p.id, first.anchor, first.nextBefore!],
    [saved.id, first.nextBefore!, first.anchor],
    [saved.id, newerAnchor, first.nextBefore!],
    [
      saved.id,
      app.projectExportPage(p.id, owner.workspace)!.anchor,
      first.nextBefore!,
    ],
  ]) {
    const query = `?view=history&anchor=${encodeURIComponent(anchor)}&before=${encodeURIComponent(before)}`;
    const response = await GET(request(id, query), context(id));
    assert.equal(response.status, 422);
    privateHeaders(response);
    assert(!(await response.text()).includes(anchor));
  }
});
