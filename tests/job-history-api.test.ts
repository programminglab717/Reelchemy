import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-history-api-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  REELCHEMY_JOB_STUDIO_COUNT: "1",
  REELCHEMY_JOB_SERVICE_COUNT: "2",
  REELCHEMY_JOB_STUDIO_RETIRED: "1",
  REELCHEMY_JOB_SERVICE_RETIRED: "2",
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  { GET: usage } = await import("../src/app/api/workspace/job-history/route"),
  { GET: list } =
    await import("../src/app/api/workspace/job-history/records/route"),
  {
    POST: review,
    GET: download,
    HEAD,
  } = await import("../src/app/api/jobs/[id]/history/route"),
  { POST: render } = await import("../src/app/api/projects/[id]/render/route"),
  inspect = new Database(path.join(root, "data/studio.sqlite"));
after(async () => {
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "History-api-fixture-passphrase-8932",
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
const owner = await account("history-owner"),
  foreign = await account("history-foreign"),
  context = (id = "unused") => ({ params: Promise.resolve({ id }) }),
  hash = (value: Buffer | string) =>
    createHash("sha256").update(value).digest("hex");
function request(
  pathname: string,
  method = "GET",
  body?: unknown,
  actor = owner,
  key?: string,
) {
  return new Request(`http://127.0.0.1:3001${pathname}`, {
    method,
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie: actor.cookie,
      [ACCOUNT_HEADER]: actor.id,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function project(workspace = owner.workspace) {
  const brief = {
    prompt: "Private activity lifecycle",
    duration: 5,
    format: "landscape" as const,
  };
  return app.reviseProject(
    app.createProject(brief, workspace),
    blankTimeline(brief),
    "Initial",
  );
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}
test("real private APIs reserve activity capacity, archive exact details, reject stale/foreign consent and replay retirement plus original render receipts without changing films or sources", async () => {
  const saved = project(),
    { storeImage } = await import("../src/lib/assets"),
    asset = await storeImage(
      await sharp({
        create: { width: 16, height: 16, channels: 3, background: "#318b75" },
      })
        .png()
        .toBuffer(),
      "owned.png",
      "Synthetic fixture artwork",
    );
  assert(app.appendOwnedAsset(saved.id, owner.workspace, asset));
  const withAsset = app.getProject(saved.id)!;
  withAsset.timeline!.scenes[0].layers[0] = {
    ...withAsset.timeline!.scenes[0].layers[0],
    kind: "image",
    assetId: asset.id,
  };
  const film = app.reviseProject(withAsset, withAsset.timeline!, "Owned image"),
    filmHash = hash(JSON.stringify(app.getProject(film.id))),
    sourcePath = path.join(root, "data/assets", asset.id),
    sourceHash = hash(await readFile(sourcePath)),
    key = randomUUID();
  const admission = await render(
    request(`/api/projects/${film.id}/render`, "POST", {}, owner, key),
    context(film.id),
  );
  assert.equal(admission.status, 202);
  const job = await admission.json();
  let response = await usage(request("/api/workspace/job-history"), context());
  privateHeaders(response);
  let own = await response.json();
  assert.equal(own.fullJobs, 1);
  assert.equal(own.pendingJobs, 1);
  assert(own.reservedBytes > 8 * 1024 ** 2);
  const premature = await review(
    request(`/api/jobs/${job.id}/history`, "POST", { action: "preview" }),
    context(job.id),
  );
  assert.equal(premature.status, 409);
  privateHeaders(premature);
  app.updateJob(job.id, {
    status: "failed",
    report: { privateCanary: "PRIVATE_ACTIVITY_REPORT" + "x".repeat(65536) },
  });
  response = await render(
    request(`/api/projects/${film.id}/render`, "POST", {}),
    context(film.id),
  );
  assert.equal(response.status, 413);
  privateHeaders(response);
  assert.equal((await response.json()).code, "JOB_HISTORY_LIMIT");
  const replay = await render(
    request(`/api/projects/${film.id}/render`, "POST", {}, owner, key),
    context(film.id),
  );
  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  assert.equal((await replay.json()).id, job.id);
  response = await list(
    request("/api/workspace/job-history/records"),
    context(),
  );
  assert.equal(response.status, 200);
  privateHeaders(response);
  const page = await response.json();
  assert.deepEqual(
    page.items.map((item: { id: string }) => item.id),
    [job.id],
  );
  assert(!JSON.stringify(page).includes("PRIVATE_ACTIVITY_REPORT"));
  assert.equal(
    (
      await list(
        request(
          `/api/workspace/job-history/records?anchor=${page.anchor}`,
          "GET",
          undefined,
          foreign,
        ),
        context(),
      )
    ).status,
    422,
  );
  const archive = await download(
    request(`/api/jobs/${job.id}/history`),
    context(job.id),
  );
  assert.equal(archive.status, 200);
  privateHeaders(archive);
  assert.match(archive.headers.get("content-disposition")!, /attachment/);
  const archiveBytes = await archive.arrayBuffer(),
    record = JSON.parse(Buffer.from(archiveBytes).toString());
  assert.equal(record.jobId, job.id);
  assert(
    record.details.report.privateCanary.includes("PRIVATE_ACTIVITY_REPORT"),
  );
  assert(JSON.stringify(record.timeline).includes(asset.id));
  assert.equal(
    Number(archive.headers.get("content-length")),
    archiveBytes.byteLength,
  );
  assert.equal(
    (
      inspect
        .prepare("SELECT count(*) AS n FROM export_file_reviews")
        .get() as { n: number }
    ).n,
    0,
  );
  const head = await HEAD(
    request(`/api/jobs/${job.id}/history`, "HEAD"),
    context(job.id),
  );
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(
    head.headers.get("content-length"),
    archive.headers.get("content-length"),
  );
  assert.equal(
    (
      inspect
        .prepare("SELECT count(*) AS n FROM export_file_reviews")
        .get() as { n: number }
    ).n,
    0,
  );
  const first = await review(
    request(`/api/jobs/${job.id}/history`, "POST", { action: "preview" }),
    context(job.id),
  );
  assert.equal(first.status, 200);
  const digest = (await first.json()).preview.digest;
  app.updateJob(job.id, {
    status: "failed",
    error: "Changed after activity review",
  });
  response = await review(
    request(`/api/jobs/${job.id}/history`, "POST", {
      action: "retire",
      digest,
      confirmation: "RETIRE EXPORT DETAILS",
    }),
    context(job.id),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "JOB_HISTORY_CONFLICT");
  assert.equal(
    (
      await review(
        request(
          `/api/jobs/${job.id}/history`,
          "POST",
          { action: "preview" },
          foreign,
        ),
        context(job.id),
      )
    ).status,
    404,
  );
  const actorMismatch = new Request(
    `http://127.0.0.1:3001/api/jobs/${job.id}/history`,
    {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        origin: "http://127.0.0.1:3001",
        cookie: owner.cookie,
        [ACCOUNT_HEADER]: foreign.id,
      },
      body: JSON.stringify({ action: "preview" }),
    },
  );
  response = await review(actorMismatch, context(job.id));
  assert.equal(response.status, 409);
  privateHeaders(response);
  const current = await review(
      request(`/api/jobs/${job.id}/history`, "POST", { action: "preview" }),
      context(job.id),
    ),
    preview = (await current.json()).preview;
  const input = {
    action: "retire",
    digest: preview.digest,
    confirmation: "RETIRE EXPORT DETAILS",
  };
  response = await review(
    request(`/api/jobs/${job.id}/history`, "POST", {
      ...input,
      confirmation: "wrong",
    }),
    context(job.id),
  );
  assert.equal(response.status, 400);
  response = await review(
    request(`/api/jobs/${job.id}/history`, "POST", input),
    context(job.id),
  );
  assert.equal(response.status, 200);
  privateHeaders(response);
  const retired = await response.json();
  assert.equal(retired.retirement.jobId, job.id);
  own = await (
    await usage(request("/api/workspace/job-history"), context())
  ).json();
  assert.equal(own.fullJobs, 0);
  assert.equal(own.retiredJobs, 1);
  assert.equal(own.reservedBytes, 0);
  const byteCount = own.bytes;
  response = await review(
    request(`/api/jobs/${job.id}/history`, "POST", input),
    context(job.id),
  );
  assert.deepEqual(await response.json(), retired);
  assert.equal(
    (
      await (
        await usage(request("/api/workspace/job-history"), context())
      ).json()
    ).bytes,
    byteCount,
  );
  const old = app.getJob(job.id)!;
  assert.equal(old.retired, true);
  assert.equal(old.report, null);
  assert.equal(old.status, "failed");
  assert(
    inspect
      .prepare("SELECT 1 FROM job_media_refs WHERE job_id=? AND asset_id=?")
      .get(job.id, asset.id),
  );
  response = await render(
    request(`/api/projects/${film.id}/render`, "POST", {}, owner, key),
    context(film.id),
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("idempotency-replayed"), "true");
  assert.equal((await response.json()).retired, true);
  response = await render(
    request(`/api/projects/${film.id}/render`, "POST", {}),
    context(film.id),
  );
  assert.equal(response.status, 202);
  assert.notEqual((await response.json()).id, job.id);
  assert.equal(hash(JSON.stringify(app.getProject(film.id))), filmHash);
  assert.equal(hash(await readFile(sourcePath)), sourceHash);
});
test("private read/write failures and a stalled activity download cannot release another actor's data or leave review leases alive", async () => {
  const saved = project(foreign.workspace),
    job = app.createOwnedJob(saved.id, foreign.workspace)!.job;
  app.updateJob(job.id, { status: "failed" });
  const stream = await download(
    request(`/api/jobs/${job.id}/history`, "GET", undefined, foreign),
    context(job.id),
  );
  assert.equal(stream.status, 200);
  const busy = await download(
    request(`/api/jobs/${job.id}/history`, "GET", undefined, foreign),
    context(job.id),
  );
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("retry-after"), "30");
  privateHeaders(busy);
  await stream.body!.cancel();
  assert.equal(
    (
      inspect
        .prepare("SELECT count(*) AS n FROM export_file_reviews")
        .get() as { n: number }
    ).n,
    0,
  );
  const another = await download(
    request(`/api/jobs/${job.id}/history`, "GET", undefined, foreign),
    context(job.id),
  );
  assert.equal(another.status, 200);
  await another.body!.cancel();
  const unsigned = await usage(
    new Request("http://127.0.0.1:3001/api/workspace/job-history"),
    context(),
  );
  assert.equal(unsigned.status, 401);
  privateHeaders(unsigned);
  const unauthorized = await download(
    request(`/api/jobs/${job.id}/history`),
    context(job.id),
  );
  assert.equal(unauthorized.status, 404);
  privateHeaders(unauthorized);
  const badOrigin = new Request(
    `http://127.0.0.1:3001/api/jobs/${job.id}/history`,
    {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        origin: "http://foreign.example.test",
        cookie: foreign.cookie,
        [ACCOUNT_HEADER]: foreign.id,
      },
      body: JSON.stringify({ action: "preview" }),
    },
  );
  assert.equal((await review(badOrigin, context(job.id))).status, 400);
  assert.equal(
    (
      await review(
        request(
          `/api/jobs/${job.id}/history`,
          "POST",
          { action: "preview", pad: "x".repeat(2000) },
          foreign,
        ),
        context(job.id),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await list(
        request("/api/workspace/job-history/records?workspace=foreign"),
        context(),
      )
    ).status,
    422,
  );
  // A foreign malformed full document must never be hydrated for authorization.
  inspect.prepare("UPDATE jobs SET data='not-json' WHERE id=?").run(job.id);
  const { GET: getJob } = await import("../src/app/api/jobs/[id]/route");
  const concealed = await getJob(
    request(`/api/jobs/${job.id}`),
    context(job.id),
  );
  assert.equal(concealed.status, 404);
  privateHeaders(concealed);
});
