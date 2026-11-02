import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  symlink,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-private-route-"));
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
  download = await import("../src/app/api/jobs/[id]/download/route"),
  thumbnail = await import("../src/app/api/jobs/[id]/thumbnail/route"),
  evidence = await import("../src/app/api/jobs/[id]/evidence/[file]/route"),
  media = await import("../src/app/api/projects/[id]/assets/[assetId]/route");
after(() => rm(root, { recursive: true, force: true }));
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-file-fixture-passphrase-9261";
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
const owner = await account("file-owner"),
  foreign = await account("file-foreign");
const brief = {
  prompt: "Private file delivery",
  duration: 5,
  format: "landscape" as const,
};
const project = app.reviseProject(
  app.createProject(brief, owner.workspace),
  blankTimeline(brief),
  "Initial",
);
const assetId = randomUUID();
await mkdir(path.join(root, "data", "assets"), { recursive: true });
await writeFile(
  path.join(root, "data", "assets", assetId),
  "OWNED_SOURCE_BYTES",
);
app.appendOwnedAsset(project.id, owner.workspace, {
  id: assetId,
  name: "Private source",
  mime: "image/png",
  source: "Owned fixture",
  license: "Owned",
  createdAt: new Date().toISOString(),
});
const job = app.createOwnedJob(project.id, owner.workspace)!.job;
app.updateJob(job.id, { status: "completed", progress: 1 });
const directory = path.join(root, "artifacts", job.id);
await mkdir(directory, { recursive: true });
for (const [file, bytes] of [
  ["video.mp4", "OWNED_MP4_BYTES"],
  ["thumbnail.png", "OWNED_THUMBNAIL"],
  ["report.json", '{"owned":true}'],
  ["captions.vtt", "WEBVTT\n\nOwned captions"],
])
  await writeFile(path.join(directory, file), bytes);
const calls = [
  { route: download, params: { id: job.id }, bytes: "OWNED_MP4_BYTES" },
  { route: thumbnail, params: { id: job.id }, bytes: "OWNED_THUMBNAIL" },
  {
    route: evidence,
    params: { id: job.id, file: "report.json" },
    bytes: '{"owned":true}',
  },
  {
    route: media,
    params: { id: project.id, assetId },
    bytes: "OWNED_SOURCE_BYTES",
  },
];
function request(
  cookie = owner.cookie,
  expected = owner.id,
  method = "GET",
  range?: string,
) {
  return new Request("http://127.0.0.1:3001/private", {
    method,
    headers: {
      cookie,
      [ACCOUNT_HEADER]: expected,
      ...(range ? { range } : {}),
    },
  });
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
test("verified private source/export/evidence delivery preserves bytes, ranges and explicit HEAD without changing saved work", async () => {
  for (const call of calls) {
    const context = { params: Promise.resolve(call.params) };
    const response = await call.route.GET(request(), context as never);
    assert.equal(response.status, 200);
    privateHeaders(response);
    assert.equal(await response.text(), call.bytes);
    const range = await call.route.GET(
      request(undefined, undefined, "GET", "bytes=2-6"),
      context as never,
    );
    assert.equal(range.status, 206);
    assert.equal(await range.text(), call.bytes.slice(2, 7));
    const head = await call.route.HEAD(
      request(undefined, undefined, "HEAD"),
      context as never,
    );
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    assert.equal(
      head.headers.get("content-length"),
      String(Buffer.byteLength(call.bytes)),
    );
  }
  // Consume the attachment, including its descriptor, rather than abandoning it.
  const attachment = await download.GET(request(), {
    params: Promise.resolve({ id: job.id }),
  });
  assert.match(
    attachment.headers.get("content-disposition")!,
    new RegExp(job.id),
  );
  await attachment.body!.cancel();
});
test("unauthenticated, foreign, stale-actor and trashed resources fail before file delivery with private headers", async () => {
  for (const call of calls) {
    for (const [req, status] of [
      [request("", ""), 401],
      [request(foreign.cookie, foreign.id), 404],
      [request(owner.cookie, foreign.id), 409],
    ] as const) {
      const response = await call.route.GET(req, {
        params: Promise.resolve(call.params),
      } as never);
      assert.equal(response.status, status);
      privateHeaders(response);
      assert(!(await response.text()).includes(call.bytes));
    }
  }
  app.setProjectTrashed(project.id, true);
  try {
    for (const call of calls) {
      const response = await call.route.HEAD(
        request(undefined, undefined, "HEAD"),
        { params: Promise.resolve(call.params) } as never,
      );
      assert.equal(response.status, 404);
      privateHeaders(response);
    }
  } finally {
    app.setProjectTrashed(project.id, false);
  }
});
test("job status and the evidence allowlist remain enforced for GET and HEAD", async () => {
  const failed = app.createOwnedJob(project.id, owner.workspace)!.job;
  app.updateJob(failed.id, { status: "failed" });
  await mkdir(path.join(root, "artifacts", failed.id), { recursive: true });
  await writeFile(
    path.join(root, "artifacts", failed.id, "report.json"),
    '{"owned":true}',
  );
  assert.equal(
    (
      await download.HEAD(request(undefined, undefined, "HEAD"), {
        params: Promise.resolve({ id: failed.id }),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await thumbnail.HEAD(request(undefined, undefined, "HEAD"), {
        params: Promise.resolve({ id: failed.id }),
      })
    ).status,
    404,
  );
  const report = await evidence.GET(request(), {
    params: Promise.resolve({ id: failed.id, file: "report.json" }),
  });
  assert.equal(report.status, 200);
  assert.equal(await report.text(), '{"owned":true}');
  for (const file of [
    "video.mp4",
    "../video.mp4",
    "scene-13-middle.png",
    "private.sqlite",
  ]) {
    const denied = await evidence.GET(request(), {
      params: Promise.resolve({ id: failed.id, file }),
    });
    assert.equal(denied.status, 404);
    privateHeaders(denied);
  }
});
test("authorized routes reject substituted source, job-directory and artifact-root pointers without touching external canaries", async () => {
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "video.mp4"), "PRIVATE_EXTERNAL_CANARY");
  const source = path.join(root, "data", "assets", assetId);
  await rename(source, `${source}-held`);
  await symlink(path.join(outside, "video.mp4"), source);
  try {
    assert.equal(
      (
        await media.GET(request(), {
          params: Promise.resolve({ id: project.id, assetId }),
        })
      ).status,
      404,
    );
  } finally {
    await rm(source);
    await rename(`${source}-held`, source);
  }
  await rename(directory, `${directory}-held`);
  await symlink(outside, directory);
  try {
    assert.equal(
      (
        await download.GET(request(), {
          params: Promise.resolve({ id: job.id }),
        })
      ).status,
      404,
    );
  } finally {
    await rm(directory);
    await rename(`${directory}-held`, directory);
  }
  const artifacts = path.join(root, "artifacts");
  await rename(artifacts, `${artifacts}-held`);
  await symlink(outside, artifacts);
  try {
    assert.equal(
      (
        await download.GET(request(), {
          params: Promise.resolve({ id: job.id }),
        })
      ).status,
      404,
    );
  } finally {
    await rm(artifacts);
    await rename(`${artifacts}-held`, artifacts);
  }
  assert.equal(
    await readFile(path.join(outside, "video.mp4"), "utf8"),
    "PRIVATE_EXTERNAL_CANARY",
  );
});
