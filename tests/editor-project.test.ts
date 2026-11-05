import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import type { Project, Timeline } from "../src/lib/schema";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import {
  PROJECT_VIEW_HEADER,
  EDITOR_PROJECT_VIEW,
} from "../src/lib/project-view";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-editor-project-"));
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
const { GET, PATCH } = await import("../src/app/api/projects/[id]/route");
const { GET: conversation } =
  await import("../src/app/api/projects/[id]/conversation/route");
const { POST: restore } =
  await import("../src/app/api/projects/[id]/restore/route");
const { POST: plan } = await import("../src/app/api/projects/[id]/plan/route");
const { PATCH: rename } =
  await import("../src/app/api/projects/[id]/name/route");
const { projectResponse } = await import("../src/lib/project-http");
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
const owner = await account("editor-owner"),
  other = await account("editor-other");
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
    `http://127.0.0.1:3001/api/projects/${encodeURIComponent(id)}?${query}`,
    {
      headers: {
        cookie,
        [ACCOUNT_HEADER]: actor,
        [PROJECT_VIEW_HEADER]: EDITOR_PROJECT_VIEW,
      },
    },
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

function messages(p: Project, count: number) {
  p.messages = Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `Direction ${index}`,
  }));
  app.saveProject(p);
}
function mutation(
  p: Project,
  data: unknown,
  duringBody?: () => void,
  method = "PATCH",
) {
  const body = duringBody
    ? new ReadableStream(
        {
          pull(controller) {
            duringBody();
            controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      )
    : JSON.stringify(data);
  return new Request(`http://127.0.0.1:3001/api/projects/${p.id}`, {
    method,
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie: owner.cookie,
      [ACCOUNT_HEADER]: owner.id,
      [PROJECT_VIEW_HEADER]: EDITOR_PROJECT_VIEW,
      "content-type": "application/json",
    },
    body,
    ...(duringBody ? { duplex: "half" } : {}),
  } as RequestInit);
}
function privateResponse(response: Response, status = 200) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
function conversationRead(id: string, before?: number) {
  return conversation(
    new Request(
      `http://127.0.0.1:3001/api/projects/${id}/conversation${before === undefined ? "" : `?before=${before}`}`,
      { headers: { cookie: owner.cookie, [ACCOUNT_HEADER]: owner.id } },
    ),
    context(id),
  );
}
test("editor reads project a bounded current film and metadata without full history, old conversations or arbitrary legacy fields", async () => {
  const p = project();
  versions(p, 600);
  messages(p, 2000);
  const asset = await storeImage(
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#246f8a" },
    })
      .png()
      .toBuffer(),
    "Owned artwork.png",
    "Owned by this test",
  );
  p.assets = [
    {
      ...asset,
      privateExtra: "PRIVATE_ASSET_SENTINEL".repeat(50000),
    } as typeof asset,
  ];
  Object.assign(p, { privateExtra: "PRIVATE_ROOT_SENTINEL".repeat(50000) });
  Object.assign(p.revisions[590], {
    privateExtra: "PRIVATE_HISTORY_SENTINEL".repeat(50000),
  });
  Object.assign(p.messages[1999], {
    privateExtra: "PRIVATE_MESSAGE_SENTINEL".repeat(50000),
  });
  app.saveProject(p);
  const before = hash(p.id);
  const response = await read(p.id);
  privateResponse(response);
  const text = await response.text();
  assert(Buffer.byteLength(text) < 20000);
  for (const sentinel of [
    "PRIVATE_ASSET_SENTINEL",
    "PRIVATE_ROOT_SENTINEL",
    "PRIVATE_HISTORY_SENTINEL",
    "PRIVATE_MESSAGE_SENTINEL",
    '"content":"Direction 0"',
  ])
    assert(!text.includes(sentinel));
  const result = JSON.parse(text);
  assert.equal(result.revisionCount, 600);
  assert.equal(result.revisions.length, 20);
  assert.equal(result.revisions[0].number, 581);
  assert.equal(result.revisions.at(-1).id, p.revisions.at(-1)!.id);
  assert(
    result.revisions.every(
      (revision: Record<string, unknown>) => !("timeline" in revision),
    ),
  );
  assert.deepEqual(result.timeline, p.timeline);
  assert.equal(result.messageCount, 2000);
  assert.equal(result.messageStart, 1950);
  assert.equal(result.messages.length, 50);
  assert.equal(result.messages[0].index, 1950);
  assert.equal(result.messages.at(-1).content, "Direction 1999");
  assert.equal(result.assets[0].license, asset.license);
  assert.equal(hash(p.id), before);
  const legacy = await GET(
    new Request(`http://127.0.0.1:3001/api/projects/${p.id}`, {
      headers: { cookie: owner.cookie },
    }),
    context(p.id),
  );
  assert.equal(legacy.status, 200);
  const complete = await legacy.json();
  assert.equal(complete.revisions.length, 600);
  assert.equal(complete.messages.length, 2000);
  assert.deepEqual(complete.revisions[0].timeline, p.revisions[0].timeline);
});
test("absolute conversation cursors page every old direction while concurrent appends leave earlier ranges stable", async () => {
  const p = project();
  versions(p, 1);
  messages(p, 123);
  const latest = await conversationRead(p.id);
  privateResponse(latest);
  const page = await latest.json();
  assert.equal(page.rangeStart, 73);
  assert.equal(page.rangeEnd, 123);
  assert.equal(page.items.length, 50);
  const next = app.getProject(p.id)!;
  next.messages.push(
    { role: "user", content: "Concurrent direction 123" },
    { role: "assistant", content: "Concurrent direction 124" },
  );
  app.saveProject(next);
  const before = hash(p.id);
  const older = await (await conversationRead(p.id, page.nextBefore)).json();
  assert.equal(older.total, 125);
  assert.equal(older.rangeStart, 23);
  assert.equal(older.rangeEnd, 73);
  const oldest = await (await conversationRead(p.id, older.nextBefore)).json();
  assert.equal(oldest.rangeStart, 0);
  assert.equal(oldest.rangeEnd, 23);
  assert.equal(oldest.nextBefore, null);
  assert.deepEqual(
    [...oldest.items, ...older.items, ...page.items].map((item) => item.index),
    Array.from({ length: 123 }, (_, index) => index),
  );
  const fresh = await (await conversationRead(p.id)).json();
  assert.equal(fresh.items.at(-1).content, "Concurrent direction 124");
  assert.equal(hash(p.id), before);
});
test("editor save responses remain bounded and stale writes preserve the entire retained history", async () => {
  const p = project();
  versions(p, 400);
  messages(p, 80);
  const before = structuredClone(p.revisions);
  const next = timeline("Compact save");
  const request = mutation(p, {
    timeline: next,
    baseRevisionId: p.revisions.at(-1)!.id,
  });
  const response = await PATCH(request, context(p.id));
  privateResponse(response);
  const text = await response.text();
  assert(Buffer.byteLength(text) < 20000);
  const result = JSON.parse(text);
  assert.equal(result.revisionCount, 401);
  assert.equal(result.revisions.length, 20);
  assert.equal(result.messages.length, 50);
  assert.deepEqual(app.getProject(p.id)!.revisions.slice(0, 400), before);
  const committed = hash(p.id);
  privateResponse(
    await PATCH(
      mutation(p, { timeline: next, baseRevisionId: p.revisions.at(-1)!.id }),
      context(p.id),
    ),
    409,
  );
  assert.equal(hash(p.id), committed);
});
test("planning and forward restore return typed compact views without truncating saved messages or versions", async () => {
  const p = project();
  versions(p, 60);
  messages(p, 100);
  const planned = await plan(mutation(p, {}, undefined, "POST"), context(p.id));
  privateResponse(planned);
  const first = await planned.json();
  assert.equal(first.revisionCount, 61);
  assert.equal(first.revisions.length, 20);
  assert.equal(first.messageCount, 101);
  assert.equal(first.messages.length, 50);
  const restored = await restore(
    mutation(
      p,
      {
        revisionId: p.revisions[0].id,
        baseRevisionId: first.revisions.at(-1).id,
      },
      undefined,
      "POST",
    ),
    context(p.id),
  );
  privateResponse(restored);
  const second = await restored.json();
  assert.equal(second.revisionCount, 62);
  assert.equal(second.messageCount, 101);
  assert.deepEqual(second.timeline, p.revisions[0].timeline);
  assert.equal(app.getProject(p.id)!.revisions.length, 62);
  assert.equal(app.getProject(p.id)!.messages.length, 101);
});
test("a compact mutation response cannot silently adopt a revision committed by another writer", async () => {
  const p = project();
  versions(p, 25);
  const saved = structuredClone(p);
  app.reviseProject(
    app.getProject(p.id)!,
    timeline("Concurrent later film"),
    "Concurrent edit",
  );
  const before = hash(p.id);
  const response = projectResponse(request(p.id), saved, owner.workspace);
  privateResponse(response, 409);
  assert.equal((await response.json()).code, "REVISION_CONFLICT");
  assert.equal(hash(p.id), before);
  const current = await (await read(p.id)).json();
  assert.equal(current.timeline.scenes[0].title, "Concurrent later film");
});
test("rename responses are bounded and delayed bodies cannot rename trashed or transferred projects", async () => {
  const p = project();
  versions(p, 40);
  messages(p, 60);
  const response = await rename(
    mutation(p, { name: "Compact renamed film", baseName: p.name }),
    context(p.id),
  );
  privateResponse(response);
  const renamed = await response.json();
  assert.equal(renamed.name, "Compact renamed film");
  assert.equal(renamed.revisions.length, 20);
  assert.equal(renamed.revisionCount, 40);
  privateResponse(
    await rename(
      mutation(p, { name: "Stale rename", baseName: p.name }),
      context(p.id),
    ),
    409,
  );
  for (const change of [
    (id: string) => app.setProjectTrashed(id, true),
    (id: string) =>
      admin
        .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
        .run(other.workspace, id),
  ]) {
    const target = project();
    versions(target, 1);
    const before = hash(target.id);
    privateResponse(
      await rename(
        mutation(target, { name: "Late rename", baseName: target.name }, () =>
          change(target.id),
        ),
        context(target.id),
      ),
      404,
    );
    assert.equal(hash(target.id), before);
  }
});
test("editor and conversation authorization and invalid cursors fail privately without source changes", async () => {
  const p = project();
  versions(p, 1);
  messages(p, 75);
  const before = hash(p.id);
  for (const [cookie, actor, status] of [
    [other.cookie, other.id, 404],
    [other.cookie, owner.id, 409],
    ["", owner.id, 401],
  ] as const) {
    privateResponse(await read(p.id, "", cookie, actor), status);
    privateResponse(
      await conversation(
        new Request(`http://127.0.0.1:3001/api/projects/${p.id}/conversation`, {
          headers: { cookie, [ACCOUNT_HEADER]: actor },
        }),
        context(p.id),
      ),
      status,
    );
  }
  for (const query of [
    "before=-1",
    "before=1.5",
    "before=1&before=2",
    "workspaceId=other",
    "before=NaN",
  ])
    privateResponse(
      await conversation(
        new Request(
          `http://127.0.0.1:3001/api/projects/${p.id}/conversation?${query}`,
          { headers: { cookie: owner.cookie, [ACCOUNT_HEADER]: owner.id } },
        ),
        context(p.id),
      ),
      400,
    );
  assert.equal(hash(p.id), before);
});
test("invalid legacy conversation entries advance raw cursors without exposing unknown fields", async () => {
  const p = project();
  versions(p, 1);
  messages(p, 55);
  Object.assign(p.messages, {
    50: null,
    51: "invalid scalar",
    52: { role: "system", content: "PRIVATE_INVALID_DIRECTION" },
    53: { role: "user", content: "x".repeat(24001) },
    54: { role: "user", content: null },
  });
  app.saveProject(p);
  const before = hash(p.id);
  const response = await read(p.id);
  privateResponse(response);
  const result = await response.json();
  assert.equal(result.messageStart, 5);
  assert.equal(result.messageCount, 55);
  assert.equal(result.messageUnavailable, 5);
  assert.equal(result.messages.length, 45);
  const old = await (await conversationRead(p.id, 5)).json();
  assert.equal(old.items.length, 5);
  assert.equal(old.nextBefore, null);
  assert(!JSON.stringify(result).includes("PRIVATE_INVALID_DIRECTION"));
  assert.equal(hash(p.id), before);
});
test("unusable latest revision and oversized current films refuse privately without falling back to an older CAS base", async () => {
  for (const corrupt of [
    (p: Project) => {
      Object.assign(p.revisions, { 1: "bad latest revision" });
    },
    (p: Project) => {
      Object.assign(p.timeline!, {
        privateExtra: "PRIVATE_CURRENT_SENTINEL".repeat(100000),
      });
    },
  ]) {
    const p = project();
    versions(p, 2);
    corrupt(p);
    app.saveProject(p);
    const before = hash(p.id);
    const response = await read(p.id);
    privateResponse(response, 503);
    assert(!(await response.text()).includes("PRIVATE_CURRENT_SENTINEL"));
    assert.equal(hash(p.id), before);
  }
});

test("detailed longer films cross the ordinary JSON body limit without losing save/reopen or stale-write protection", async () => {
  const p = project();
  const timeline = blankTimeline({ ...brief, duration: 300 });
  const keys = Array.from({ length: 30 }, (_, frame) => ({
    frame,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
  }));
  for (const scene of timeline.scenes)
    scene.layers = Array.from({ length: 10 }, (_, i) => ({
      ...scene.layers[0],
      id: `layer-${i}`,
      keyframes: keys,
    }));
  const data = { timeline, baseRevisionId: null };
  assert(Buffer.byteLength(JSON.stringify(data)) > 100000);
  const response = await PATCH(mutation(p, data), context(p.id));
  privateResponse(response);
  const saved = await response.json();
  assert.equal(saved.timeline.scenes.length, 15);
  assert.equal(saved.timeline.scenes.at(-1).layers.length, 10);
  const readback = await read(p.id);
  privateResponse(readback);
  assert.deepEqual((await readback.json()).timeline, saved.timeline);
  const before = hash(p.id);
  privateResponse(await PATCH(mutation(p, data), context(p.id)), 409);
  assert.equal(hash(p.id), before);
});
