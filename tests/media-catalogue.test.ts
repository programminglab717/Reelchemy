import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import type { Asset, Project } from "../src/lib/schema";
import { ownedMediaCatalogue } from "../src/lib/media-catalogue";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-media-catalogue-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(root, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const app = await import("../src/lib/db");
const { getAuth } = await import("../src/lib/auth");
const { GET } = await import("../src/app/api/projects/[id]/assets/route");
const { storeImage } = await import("../src/lib/assets");
const admin = new Database(path.join(root, "data", "studio.sqlite"));
after(async () => {
  admin.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-catalogue-passphrase-4826";
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
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
const owner = await account("catalogue-owner"),
  other = await account("catalogue-other");
function request(id: string, cookie = owner.cookie, expected?: string) {
  return new Request(
    `http://127.0.0.1:3001/api/projects/${id}/assets?workspaceId=${other.workspace}`,
    {
      headers: { cookie, ...(expected ? { [ACCOUNT_HEADER]: expected } : {}) },
    },
  );
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
function project() {
  return app.createProject(
    { prompt: "Private catalogue fixture", duration: 5, format: "landscape" },
    owner.workspace,
  );
}
function sourceHash(id: string) {
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
function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: randomUUID(),
    name: "Retained clip.mp4",
    mime: "video/mp4",
    source: "User upload",
    license: "Owned private fixture",
    bytes: 900,
    width: 160,
    height: 90,
    durationFrames: 30,
    hasAudio: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("catalogues return only bounded owned media despite large histories, conversations and arbitrary legacy fields", async () => {
  const p = project();
  const image = await storeImage(
    await sharp({
      create: { width: 48, height: 24, channels: 3, background: "#eab33c" },
    })
      .png()
      .toBuffer(),
    "Badge.png",
    "Generated private fixture",
  );
  const legacy = {
    ...image,
    privatePath: "/private/do-not-expose",
    extraBlob: "private-extra-field".repeat(100000),
  };
  p.assets = [
    legacy,
    asset(),
    asset({
      mime: "audio/wav",
      name: "Voice.wav",
      width: undefined,
      height: undefined,
      hasAudio: undefined,
    }),
  ];
  const timeline = blankTimeline(p.brief);
  p.timeline = timeline;
  p.revisions = Array.from({ length: 400 }, (_, i) => ({
    id: `catalogue-revision-${i}`,
    createdAt: new Date().toISOString(),
    source: "Private history must not enter the catalogue".repeat(8),
    timeline,
  }));
  p.messages = [
    { role: "user", content: "Private conversation sentinel".repeat(200) },
  ];
  app.saveProject(p);
  const before = sourceHash(p.id);
  const response = await GET(request(p.id), context(p.id));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control")!, /private, no-store/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  const body = await response.text(),
    result = JSON.parse(body);
  assert.ok(Buffer.byteLength(body) < 6000);
  assert.deepEqual(Object.keys(result).sort(), ["assets", "id"]);
  assert.equal(result.id, p.id);
  assert.equal(result.assets.length, 3);
  assert.deepEqual(result.assets[0], image);
  assert.equal(result.assets[1].hasAudio, false);
  assert.equal(result.assets[2].mime, "audio/wav");
  for (const secret of [
    "catalogue-revision",
    "Private history",
    "Private conversation",
    "private-extra-field",
    "/private/do-not-expose",
    owner.workspace,
    "timeline",
    "revisions",
    "messages",
  ])
    assert.ok(!body.includes(secret));
  assert.equal(sourceHash(p.id), before);
  assert.equal(
    (
      admin.prepare("SELECT count(*) AS count FROM media_requests").get() as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (
      admin.prepare("SELECT count(*) AS count FROM request_limits").get() as {
        count: number;
      }
    ).count,
    0,
  );
});

test("verified ownership and actor binding precede catalogue access, including Trash and permanent intent", async () => {
  const p = project();
  for (const [cookie, status] of [
    ["", 401],
    [other.cookie, 404],
  ] as const) {
    const response = await GET(request(p.id, cookie), context(p.id));
    assert.equal(response.status, status);
    assert.match(response.headers.get("Cache-Control")!, /private, no-store/);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  }
  const mismatch = await GET(
    request(p.id, owner.cookie, other.id),
    context(p.id),
  );
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, "ACCOUNT_CHANGED");
  const unknown = randomUUID();
  assert.equal((await GET(request(unknown), context(unknown))).status, 404);
  assert.deepEqual(await (await GET(request(p.id), context(p.id))).json(), {
    id: p.id,
    assets: [],
  });
  app.setProjectTrashed(p.id, true);
  assert.equal((await GET(request(p.id), context(p.id))).status, 404);
  assert.equal(app.projectMediaCatalogue(p.id, owner.workspace), undefined);
  app.requestOwnedProjectDeletion(p.id, owner.workspace);
  assert.equal((await GET(request(p.id), context(p.id))).status, 404);
  assert.equal(app.projectMediaCatalogue(p.id, owner.workspace), undefined);
});

test("unreadable legacy JSON is rejected before projection without changing its source", () => {
  // Normal project-reference triggers reject malformed JSON on write. A tiny
  // legacy database models an already-damaged record without disabling them.
  const legacy = new Database(":memory:");
  try {
    legacy.exec(`CREATE TABLE projects(id TEXT,workspace_id TEXT,trashed_at TEXT,data TEXT);
      CREATE TABLE project_deletions(project_id TEXT);
      INSERT INTO projects VALUES('legacy','owner',NULL,'broken-json');`);
    assert.throws(
      () => ownedMediaCatalogue(legacy, "legacy", "owner"),
      /Project metadata is unavailable/,
    );
    assert.equal(ownedMediaCatalogue(legacy, "legacy", "other"), undefined);
    assert.deepEqual(legacy.prepare("SELECT data FROM projects").get(), {
      data: "broken-json",
    });
  } finally {
    legacy.close();
  }
});

test("scalar, malformed and oversized legacy fields never escape the fixed metadata projection", async () => {
  const p = project(),
    good = asset();
  const candidates: unknown[] = [
    good,
    "not a JSON object",
    null,
    17,
    { ...asset(), name: { private: "hidden legacy object" } },
    { ...asset(), name: "\0" + "hidden-after-NUL".repeat(100000) },
    { ...asset(), width: "invalid" },
    { ...asset(), hasAudio: "false" },
    { ...asset(), bytes: { private: "hidden numeric object" } },
    {
      ...good,
      name: "Duplicate ID must not overwrite rights",
      license: "Different duplicate rights",
    },
  ];
  p.assets = candidates as Asset[];
  app.saveProject(p);
  const before = sourceHash(p.id),
    response = await GET(request(p.id), context(p.id));
  assert.equal(response.status, 200);
  const text = await response.text(),
    result = JSON.parse(text);
  assert.ok(Buffer.byteLength(text) < 2000);
  assert.deepEqual(result.assets, [good]);
  assert.ok(!text.includes("hidden"));
  assert.equal(sourceHash(p.id), before);
});

test("legacy project identifiers and the 30-entry response bound remain safe and read-only", async () => {
  const p: Project = {
    ...project(),
    id: "seed-Media_Catalogue",
    assets: Array.from({ length: 31 }, (_, i) =>
      asset({ name: `Retained ${i}.mp4` }),
    ),
  };
  app.saveProject(p, owner.workspace);
  const before = sourceHash(p.id);
  const response = await GET(request(p.id), context(p.id));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, p.id);
  assert.equal(result.assets.length, 30);
  assert.equal(result.assets.at(-1).name, "Retained 29.mp4");
  assert.equal(sourceHash(p.id), before);
});
