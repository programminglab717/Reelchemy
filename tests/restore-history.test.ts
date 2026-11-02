import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-restore-history-"));
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
const { POST } = await import("../src/app/api/projects/[id]/restore/route");
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
const owner = await account("restore-owner"),
  other = await account("restore-other");
const brief = {
  prompt: "PRIVATE_BRIEF_SENTINEL",
  duration: 5,
  format: "landscape" as const,
};
function project() {
  const p = app.createProject(brief, owner.workspace);
  app.reviseProject(p, blankTimeline(brief), "First cut");
  const next = blankTimeline(brief);
  next.scenes[0].title = "Current saved film";
  app.reviseProject(p, next, "Latest cut");
  return p;
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

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
function restore(
  p: ReturnType<typeof project>,
  data: unknown = {
    revisionId: p.revisions[0].id,
    baseRevisionId: p.revisions.at(-1)!.id,
  },
  options: { cookie?: string; actor?: string; duringBody?: () => void } = {},
) {
  const headers = {
    cookie: options.cookie ?? owner.cookie,
    [ACCOUNT_HEADER]: options.actor ?? owner.id,
    origin: "http://127.0.0.1:3001",
    host: "127.0.0.1:3001",
    "content-type": "application/json",
  };
  let body: BodyInit = JSON.stringify(data);
  if (options.duringBody)
    body = new ReadableStream(
      {
        pull(controller) {
          options.duringBody!();
          controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
  return POST(
    new Request(`http://127.0.0.1:3001/api/projects/${p.id}/restore`, {
      method: "POST",
      headers,
      body,
      ...(options.duringBody ? { duplex: "half" } : {}),
    } as RequestInit),
    context(p.id),
  );
}
function privateResponse(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
test("restoring an owned saved film appends exactly once and retains current metadata, messages and every earlier version", async () => {
  const p = project();
  p.revisions[0].id = 'old/α?"edit';
  p.messages.push({ role: "assistant", content: "Retain this conversation" });
  app.saveProject(p);
  const earlier = structuredClone(p.revisions);
  const response = await restore(p);
  privateResponse(response, 200);
  const result = await response.json();
  assert.equal(result.revisions.length, 3);
  assert.deepEqual(result.revisions.slice(0, 2), earlier);
  assert.deepEqual(result.timeline, earlier[0].timeline);
  assert.deepEqual(result.messages, p.messages);
  assert.equal(result.name, p.name);
  assert.equal(result.revisions[2].source, `Restored ${earlier[0].id}`);
  assert.notEqual(result.revisions[2].id, earlier[0].id);
  const committed = hash(p.id);
  privateResponse(await restore(p), 409);
  assert.equal(hash(p.id), committed);
});
test("restore ownership, rendered-account, authentication and malformed-body refusals remain private", async () => {
  const p = project();
  const before = hash(p.id);
  privateResponse(
    await restore(p, undefined, { cookie: other.cookie, actor: other.id }),
    404,
  );
  privateResponse(await restore(p, undefined, { cookie: other.cookie }), 409);
  privateResponse(await restore(p, undefined, { cookie: "" }), 401);
  privateResponse(await restore(p, {}), 400);
  const malformed = await POST(
    new Request(`http://127.0.0.1:3001/api/projects/${p.id}/restore`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        [ACCOUNT_HEADER]: owner.id,
        "content-type": "application/json",
      },
      body: '{"private":"PRIVATE_REQUEST_SENTINEL',
    }),
    context(p.id),
  );
  privateResponse(malformed, 400);
  assert(!(await malformed.text()).includes("PRIVATE_REQUEST_SENTINEL"));
  assert.equal(hash(p.id), before);
});
test("moving to Trash during a streamed restore body prevents its late save", async () => {
  const p = project();
  const before = hash(p.id);
  let pulled = false;
  const response = await restore(p, undefined, {
    duringBody: () => {
      pulled = true;
      app.setProjectTrashed(p.id, true);
    },
  });
  assert.equal(pulled, true);
  privateResponse(response, 404);
  assert.equal(hash(p.id), before);
});
test("ownership transferred while a restore body streams is checked again before selecting or writing history", async () => {
  const p = project();
  const before = hash(p.id);
  const response = await restore(p, undefined, {
    duringBody: () =>
      admin
        .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
        .run(other.workspace, p.id),
  });
  privateResponse(response, 404);
  assert.equal(hash(p.id), before);
});
test("a newer saved film wins over a streamed restore, retaining the new revision without another append", async () => {
  const p = project();
  let committed = "";
  const response = await restore(p, undefined, {
    duringBody: () => {
      const next = blankTimeline(brief);
      next.scenes[0].title = "Concurrent film wins";
      app.reviseProject(app.getProject(p.id)!, next, "Concurrent edit");
      committed = hash(p.id);
    },
  });
  privateResponse(response, 409);
  assert.equal(hash(p.id), committed);
  assert.equal(app.getProject(p.id)!.revisions.length, 3);
});
test("current media is validated after receiving the restore body, with no partial revision", async () => {
  const p = project();
  const asset = {
    id: randomUUID(),
    name: "Owned.png",
    source: "Test",
    license: "Owned by this test",
    mime: "image/png" as const,
    createdAt: p.createdAt,
  };
  p.assets = [asset];
  p.revisions[0].timeline.scenes[0].layers[0].kind = "image";
  p.revisions[0].timeline.scenes[0].layers[0].assetId = asset.id;
  app.saveProject(p);
  let committed = "";
  const response = await restore(p, undefined, {
    duringBody: () => {
      const next = app.getProject(p.id)!;
      next.assets = [];
      app.saveProject(next);
      committed = hash(p.id);
    },
  });
  privateResponse(response, 422);
  assert.equal(hash(p.id), committed);
  assert.equal(app.getProject(p.id)!.revisions.length, 2);
});
test("ambiguous, invalid, oversized and unavailable retained snapshots fail closed without changing the current film", async () => {
  for (const mutate of [
    (p: ReturnType<typeof project>) => {
      p.revisions[1].id = p.revisions[0].id;
    },
    (p: ReturnType<typeof project>) => {
      p.revisions[0].timeline.scenes = [];
    },
    (p: ReturnType<typeof project>) => {
      Object.assign(p.revisions[0].timeline, {
        privateExtra: "PRIVATE_SNAPSHOT_SENTINEL".repeat(100000),
      });
    },
    (p: ReturnType<typeof project>) => {
      p.revisions[0].timeline.scenes[0].layers[0].assetId = randomUUID();
    },
  ]) {
    const p = project();
    mutate(p);
    app.saveProject(p);
    const before = hash(p.id);
    const response = await restore(p);
    privateResponse(response, 422);
    assert(!(await response.text()).includes("PRIVATE_SNAPSHOT_SENTINEL"));
    assert.equal(hash(p.id), before);
  }
});
