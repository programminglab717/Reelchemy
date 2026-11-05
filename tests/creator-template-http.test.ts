import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import {
  creatorTemplates,
  creatorTemplateTimeline,
} from "../src/lib/creator-templates";
import { timelineSchema } from "../src/lib/schema";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import { ProjectStorageLimit } from "../src/lib/project-storage-policy";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-template-http-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  { POST } = await import("../src/app/api/projects/route");
after(() => rm(root, { recursive: true, force: true }));
async function account(label: string) {
  const auth = await getAuth(),
    password = "Synthetic-creator-template-passphrase-7612",
    email = `${label}@example.test`;
  const signed = await auth.api.signUpEmail({
    body: { name: label, email, password },
  });
  const db = new Database(path.join(root, "auth/auth.sqlite"));
  db.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').run(
    signed.user.id,
  );
  db.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  return {
    id: signed.user.id,
    workspace: app.ensureWorkspace(signed.user.id, label).id,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const owner = await account("template-owner"),
  other = await account("template-other");
function request(data: unknown, cookie = owner.cookie, actor = owner.id) {
  return new Request("http://127.0.0.1:3001/api/projects", {
    method: "POST",
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie,
      [ACCOUNT_HEADER]: actor,
      "content-type": "application/json",
    },
    body: JSON.stringify(data),
  });
}
const context = { params: Promise.resolve({}) };
test("starter creation stores one complete owned film/version and never plans or retains client-only template fields", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected network use");
  };
  try {
    for (const template of creatorTemplates) {
      const response = await POST(
        request({
          prompt: template.name,
          duration: template.duration,
          format: template.format,
          templateId: template.id,
          workspaceId: other.workspace,
        }),
        context,
      );
      assert.equal(response.status, 201);
      assert(response.headers.get("cache-control")?.includes("no-store"));
      const project = await response.json();
      assert(app.projectInWorkspace(project.id, owner.workspace));
      assert(!app.projectInWorkspace(project.id, other.workspace));
      assert.deepEqual(project.brief, {
        prompt: template.name,
        duration: template.duration,
        format: template.format,
      });
      assert.deepEqual(project.timeline, creatorTemplateTimeline(template.id));
      assert.equal(project.revisions.length, 1);
      assert.equal(
        project.revisions[0].source,
        `Starter template: ${template.name}`,
      );
      assert.deepEqual(app.getProject(project.id)!.timeline, project.timeline);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("invalid template choices and stale identity cannot create partial films or consume another workspace's data", async () => {
  const template = creatorTemplates[1],
    base = {
      prompt: template.name,
      duration: template.duration,
      format: template.format,
      templateId: template.id,
    };
  const before = app.studioProjectDataUsage(owner.workspace);
  for (const data of [
    { ...base, templateId: "__proto__" },
    { ...base, templateId: "https://outside.invalid" },
    { ...base, blank: true },
    { ...base, duration: 5 },
    { ...base, format: "portrait" },
  ])
    assert.equal((await POST(request(data), context)).status, 400);
  assert.equal(
    (await POST(request(base, other.cookie, owner.id), context)).status,
    409,
  );
  assert.equal((await POST(request(base, "", owner.id), context)).status, 401);
  assert.deepEqual(app.studioProjectDataUsage(owner.workspace), before);
});
test("initial film admission is atomic when its first saved version exceeds the captured project allowance", () => {
  const template = creatorTemplates[1],
    film = creatorTemplateTimeline(template.id);
  const keys = Array.from({ length: 30 }, (_, frame) => ({
    frame,
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
  }));
  film.scenes = Array.from({ length: 15 }, (_, i) => ({
    ...structuredClone(film.scenes[0]),
    id: `dense-${i}`,
    durationFrames: 600,
    layers: Array.from({ length: 20 }, (_, j) => ({
      ...structuredClone(film.scenes[0].layers[0]),
      id: `layer-${j}`,
      keyframes: keys,
    })),
  }));
  film.captions = [];
  const valid = timelineSchema.parse(film);
  assert(Buffer.byteLength(JSON.stringify(valid)) * 2 > 1024 ** 2);
  const before = app.studioProjectDataUsage(owner.workspace),
    previous = process.env.REELCHEMY_PROJECT_DATA_BYTES;
  process.env.REELCHEMY_PROJECT_DATA_BYTES = String(1024 ** 2);
  try {
    assert.throws(
      () =>
        app.createComposedProject(
          {
            prompt: "Must not leave an empty film",
            duration: 300,
            format: "landscape",
          },
          owner.workspace,
          valid,
          "Starter template",
        ),
      ProjectStorageLimit,
    );
    assert.deepEqual(app.studioProjectDataUsage(owner.workspace), before);
  } finally {
    if (previous === undefined) delete process.env.REELCHEMY_PROJECT_DATA_BYTES;
    else process.env.REELCHEMY_PROJECT_DATA_BYTES = previous;
  }
});
