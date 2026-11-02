import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-archive-route-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
});
const app = await import("../src/lib/db");
const { getAuth } = await import("../src/lib/auth");
const { GET } = await import("../src/app/api/projects/[id]/archive/route");
const admin = new Database(path.join(root, "data", "studio.sqlite"));
after(async () => {
  admin.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-project-history-passphrase-4826";
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
      .map((item) => item.split(";")[0])
      .join("; "),
    workspace: app.ensureWorkspace(signup.user.id, name).id,
  };
}
const owner = await account("archive-owner"),
  other = await account("archive-other");
const brief = {
  prompt: "PRIVATE_BRIEF_SENTINEL",
  duration: 5,
  format: "landscape" as const,
};
function project() {
  return app.createProject(brief, owner.workspace);
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function request(
  id: string,
  query = "",
  cookie = owner.cookie,
  actor = owner.id,
) {
  return new Request(
    `http://127.0.0.1:3001/api/projects/${encodeURIComponent(id)}/archive?${query}`,
    { headers: { cookie, [ACCOUNT_HEADER]: actor } },
  );
}
function read(id: string, query = "", cookie = owner.cookie, actor = owner.id) {
  return GET(request(id, query, cookie, actor), context(id));
}
function hash(id: string) {
  return createHash("sha256")
    .update(
      (
        admin.prepare("SELECT data FROM projects WHERE id=?").get(id) as {
          data: string;
        }
      ).data,
    )
    .digest("hex");
}

test("archive ZIPs and every authorization/error response remain private and actor-bound", async () => {
  const p = project();
  p.timeline = blankTimeline(p.brief);
  app.saveProject(p);
  const before = hash(p.id);
  const ok = await read(p.id);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "application/zip");
  assert.equal(ok.headers.get("cache-control"), "private, no-store");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    (await ok.arrayBuffer()).byteLength,
    Number(ok.headers.get("content-length")),
  );
  for (const [response, status] of [
    [await read(p.id, "", other.cookie, owner.id), 409],
    [await read(p.id, "", other.cookie, other.id), 404],
    [await read(p.id, "", "", owner.id), 401],
    [await read("absent"), 404],
  ] as const) {
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.notEqual(response.headers.get("content-type"), "application/zip");
    assert(!JSON.stringify(await response.json()).includes(p.name));
  }
  assert.equal(hash(p.id), before);
});
test("an invalid saved project returns a private actionable error without altering its history", async () => {
  const p = project();
  p.revisions = Array(10001).fill(null);
  app.saveProject(p);
  const before = hash(p.id);
  const response = await read(p.id);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match((await response.json()).error, /10000 revisions/);
  assert.equal(hash(p.id), before);
});
