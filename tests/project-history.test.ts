import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import type { Project, Timeline } from "../src/lib/schema";
import { ACCOUNT_HEADER } from "../src/lib/account-session";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-project-history-"));
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
const { GET } = await import("../src/app/api/projects/[id]/history/route");
const { storeImage } = await import("../src/lib/assets");
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
const owner = await account("history-owner"),
  other = await account("history-other");
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
    `http://127.0.0.1:3001/api/projects/${encodeURIComponent(id)}/history?${query}`,
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
function timeline(title = "Historical private cut"): Timeline {
  const value = blankTimeline(brief);
  value.scenes[0].title = title;
  return value;
}
function versions(p: Project, count: number) {
  p.revisions = Array.from({ length: count }, (_, index) => ({
    id: `saved-${index}`,
    createdAt: new Date().toISOString(),
    source: `Manual edit ${index + 1}`,
    timeline: timeline(`Historical private cut ${index + 1}`),
  }));
  p.timeline = p.revisions.at(-1)?.timeline || null;
  app.saveProject(p);
}

test("400-version histories page bounded metadata without hydrating timelines, conversations or arbitrary revision fields", async () => {
  const p = project();
  versions(p, 400);
  p.revisions[200] = {
    ...p.revisions[200],
    privateExtra: "PRIVATE_REVISION_SENTINEL".repeat(100000),
  } as Project["revisions"][number];
  p.messages = [{ role: "user", content: "PRIVATE_CHAT_SENTINEL".repeat(200) }];
  app.saveProject(p);
  const before = hash(p.id),
    first = await read(p.id, `offset=0&workspaceId=${other.workspace}`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "private, no-store");
  assert.equal(first.headers.get("X-Content-Type-Options"), "nosniff");
  const text = await first.text(),
    page = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) < 8000);
  assert.equal(page.total, 400);
  assert.equal(page.items.length, 20);
  assert.equal(page.items[0].number, 400);
  assert.equal(page.items.at(-1).number, 381);
  assert.equal(page.nextOffset, 20);
  for (const secret of [
    "PRIVATE_BRIEF_SENTINEL",
    "PRIVATE_CHAT_SENTINEL",
    "PRIVATE_REVISION_SENTINEL",
    "Historical private cut",
    "timeline",
    "assets",
    "messages",
    owner.workspace,
  ])
    assert.ok(!text.includes(secret));
  const last = await (await read(p.id, "offset=380")).json();
  assert.equal(last.items.length, 20);
  assert.equal(last.items[0].number, 20);
  assert.equal(last.items.at(-1).number, 1);
  assert.equal(last.nextOffset, null);
  assert.deepEqual(await (await read(p.id, "offset=400")).json(), {
    items: [],
    total: 400,
    nextOffset: null,
    unavailable: 0,
  });
  assert.equal(hash(p.id), before);
});

test("one validated snapshot preserves its exact saved timeline and rights while omitting unrelated history and unknown fields", async () => {
  const p = project();
  versions(p, 4);
  const image = await storeImage(
    await sharp({
      create: { width: 48, height: 24, channels: 3, background: "#f4b53d" },
    })
      .png()
      .toBuffer(),
    "Historical badge.png",
    "Generated private fixture rights",
  );
  const legacyAsset = { ...image, privatePath: "PRIVATE_ASSET_PATH_SENTINEL" };
  p.assets = [legacyAsset];
  p.revisions[1].timeline.scenes[0].layers[0] = {
    ...p.revisions[1].timeline.scenes[0].layers[0],
    kind: "image",
    assetId: image.id,
  };
  p.revisions[1].timeline = {
    ...p.revisions[1].timeline,
    privateExtra: "PRIVATE_SNAPSHOT_SENTINEL",
  } as Timeline;
  app.saveProject(p);
  const before = hash(p.id),
    response = await read(p.id, "revisionId=saved-1");
  assert.equal(response.status, 200);
  const text = await response.text(),
    snapshot = JSON.parse(text);
  assert.equal(snapshot.projectId, p.id);
  assert.equal(snapshot.version.number, 2);
  assert.equal(snapshot.version.id, "saved-1");
  assert.equal(snapshot.timeline.scenes[0].title, "Historical private cut 2");
  assert.equal(snapshot.mediaAvailable, true);
  assert.deepEqual(snapshot.assets, [image]);
  assert.ok(Buffer.byteLength(text) < 6000);
  for (const hidden of [
    "PRIVATE_ASSET_PATH_SENTINEL",
    "PRIVATE_SNAPSHOT_SENTINEL",
    "Historical private cut 4",
    "revisions",
    "messages",
  ])
    assert.ok(!text.includes(hidden));
  assert.equal(hash(p.id), before);
});

test("history reads verify account/owner before lookup and hide Trash or permanent-deletion intent", async () => {
  const p = project();
  versions(p, 1);
  for (const [query, cookie, actor, status] of [
    ["", "", owner.id, 401],
    ["revisionId=saved-0", other.cookie, other.id, 404],
    ["", owner.cookie, other.id, 409],
  ] as const) {
    const response = await read(p.id, query, cookie, actor);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  app.setProjectTrashed(p.id, true);
  assert.equal((await read(p.id)).status, 404);
  assert.equal(app.projectVersionPage(p.id, owner.workspace, 0), undefined);
  app.requestOwnedProjectDeletion(p.id, owner.workspace);
  assert.equal((await read(p.id, "revisionId=saved-0")).status, 404);
});

test("unknown and unsafe parameters fail privately; encoded legacy revision identifiers remain usable", async () => {
  const p = project();
  versions(p, 1);
  p.revisions[0].id = "release / α 'draft'";
  app.saveProject(p);
  const valid = await read(
    p.id,
    new URLSearchParams({ revisionId: p.revisions[0].id }).toString(),
  );
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).version.id, p.revisions[0].id);
  for (const query of [
    "offset=-1",
    "offset=1e2",
    "offset=NaN",
    "offset=1000000000",
    "revisionId=",
    "revisionId=%00",
    `revisionId=${"a".repeat(81)}`,
  ])
    assert.equal((await read(p.id, query)).status, 400);
  assert.equal(
    (
      await read(
        p.id,
        new URLSearchParams({ revisionId: "' OR 1=1 --" }).toString(),
      )
    ).status,
    404,
  );
  assert.equal((await read(randomUUID())).status, 404);
});

test("missing historical media is explicit and oversized or ambiguous legacy snapshots fail closed without modifying source", async () => {
  const p = project();
  versions(p, 3);
  p.revisions[0].timeline.scenes[0].layers[0] = {
    ...p.revisions[0].timeline.scenes[0].layers[0],
    kind: "image",
    assetId: randomUUID(),
  };
  p.revisions[1].timeline = {
    ...p.revisions[1].timeline,
    privateExtra: "PRIVATE_OVERSIZE_SENTINEL".repeat(100000),
  } as Timeline;
  app.saveProject(p);
  let before = hash(p.id);
  const missing = await (await read(p.id, "revisionId=saved-0")).json();
  assert.equal(missing.mediaAvailable, false);
  assert.deepEqual(missing.assets, []);
  const large = await read(p.id, "revisionId=saved-1");
  assert.equal(large.status, 422);
  assert.ok(!(await large.text()).includes("PRIVATE_OVERSIZE_SENTINEL"));
  assert.equal((await read(p.id)).status, 200);
  assert.equal(hash(p.id), before);
  p.revisions[2].id = p.revisions[0].id;
  app.saveProject(p);
  before = hash(p.id);
  assert.equal((await read(p.id, "revisionId=saved-0")).status, 422);
  assert.equal(hash(p.id), before);
  assert.equal(
    (
      admin.prepare("SELECT count(*) AS count FROM request_limits").get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (
      admin.prepare("SELECT count(*) AS count FROM media_requests").get() as {
        count: number;
      }
    ).count,
    0,
  );
});

test("unreadable legacy entries advance the page while keeping bounded labels and no unknown values", async () => {
  const p = project();
  p.revisions = [
    null,
    17,
    "PRIVATE_SCALAR_SENTINEL",
    {
      id: "legacy-version",
      source: { secret: "PRIVATE_OBJECT_SENTINEL" },
      createdAt: "invalid",
      timeline: timeline(),
    },
  ] as unknown as Project["revisions"];
  app.saveProject(p);
  const before = hash(p.id),
    response = await read(p.id),
    text = await response.text(),
    page = JSON.parse(text);
  assert.equal(response.status, 200);
  assert.equal(page.total, 4);
  assert.equal(page.unavailable, 3);
  assert.equal(page.nextOffset, null);
  assert.deepEqual(page.items, [
    { id: "legacy-version", number: 4, source: "Saved edit", createdAt: null },
  ]);
  assert.ok(!text.includes("PRIVATE_"));
  assert.equal(hash(p.id), before);
});
