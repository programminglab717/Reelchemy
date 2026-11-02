import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { startMediaWorker } from "./helpers/media-worker";
import { mediaInputFingerprint } from "../src/lib/media-processing-store";
import { readLimitedBody, RequestBodyError } from "../src/lib/http";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import { encodeRecording } from "../src/lib/recording";
import {
  submitMedia,
  MediaStillProcessing,
  type MediaSubmissionRef,
} from "../src/lib/media-processing-client";
import type { AccountFetch } from "../src/lib/account-fetch";
import {
  cachedWaveform,
  removeCachedWaveform,
} from "../src/lib/waveform-cache";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-media-http-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(root, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const app = await import("../src/lib/db");
const { getAuth } = await import("../src/lib/auth");
const { POST: upload, GET: catalogueGET } =
  await import("../src/app/api/projects/[id]/assets/route");
const { GET: status } =
  await import("../src/app/api/media-requests/[id]/route");
const { POST: cancel } =
  await import("../src/app/api/media-requests/[id]/cancel/route");
const { GET: list } =
  await import("../src/app/api/workspace/media-requests/route");
const { GET: projectGET } = await import("../src/app/api/projects/[id]/route");
let ingestion: Awaited<ReturnType<typeof startMediaWorker>> | undefined;
after(async () => {
  await ingestion?.stop();
  await rm(root, { recursive: true, force: true });
});
const origin = "http://127.0.0.1:3001";
async function account(name: string) {
  const auth = await getAuth(),
    email = `${name}@example.test`,
    password = "Private-media-http-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  const admin = new Database(path.join(root, "auth", "auth.sqlite"));
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
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
type Account = Awaited<ReturnType<typeof account>>;
const owner = await account("media-owner"),
  other = await account("media-other");
function request(actor: Account, url: string, init: RequestInit = {}) {
  return new Request(`${origin}${url}`, {
    ...init,
    headers: {
      host: "127.0.0.1:3001",
      origin,
      cookie: actor.cookie,
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
}
function project() {
  return app.createProject(
    { prompt: "Queued media fixture", duration: 5, format: "landscape" },
    owner.workspace,
  );
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const image = await sharp({
  create: { width: 48, height: 24, channels: 3, background: "#eab33c" },
})
  .png()
  .toBuffer();
function form(bytes = image, name = "Brand.png") {
  const data = new FormData();
  data.set(
    "file",
    new File([new Uint8Array(bytes)], name, { type: "image/png" }),
  );
  data.set("license", "Private generated fixture rights");
  return data;
}
async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(label);
}

test("verified global/studio admission rejects before reading a body, and actor mismatch consumes no queue capacity", async () => {
  const p = project(),
    held: { receipt: { id: string }; token: string }[] = [];
  let pulled = false;
  const unread = (headers: Record<string, string> = {}) =>
    request(owner, `/api/projects/${p.id}/assets`, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=unread",
        ...headers,
      },
      body: new ReadableStream(
        {
          pull() {
            pulled = true;
            throw new Error("Body must not be read");
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit);
  try {
    for (let i = 0; i < 4; i++) {
      const workspace = app.ensureWorkspace(
        `held-private-${i}`,
        "Capacity fixture",
      ).id;
      const target = app.createProject(p.brief, workspace);
      const reservation = app.mediaProcessing.reserve({
        workspaceId: workspace,
        projectId: target.id,
        operation: "upload",
        requestKey: randomUUID(),
      });
      assert.ok(reservation.created);
      held.push(reservation);
    }
    const full = await upload(unread(), context(p.id));
    assert.equal(full.status, 503);
    assert.equal((await full.json()).scope, "global");
    assert.equal(full.headers.get("retry-after"), "5");
    assert.equal(pulled, false);
    const stale = await upload(
      unread({ [ACCOUNT_HEADER]: other.id }),
      context(p.id),
    );
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "ACCOUNT_CHANGED");
    assert.equal(pulled, false);
  } finally {
    for (const reservation of held) {
      app.mediaProcessing.abandonReceiver(
        reservation.receipt.id,
        reservation.token,
      );
      app.cleanupMediaRequest(reservation.receipt.id);
    }
  }
  const reserved = app.mediaProcessing.reserve({
    workspaceId: owner.workspace,
    projectId: p.id,
    operation: "upload",
    requestKey: randomUUID(),
  });
  assert.ok(reserved.created);
  try {
    const busy = await upload(unread(), context(p.id));
    assert.equal(busy.status, 429);
    assert.equal((await busy.json()).scope, "studio");
    assert.equal(pulled, false);
  } finally {
    app.mediaProcessing.abandonReceiver(reserved.receipt.id, reserved.token);
    app.cleanupMediaRequest(reserved.receipt.id);
  }
});

test("async receipts are private and intent-bound; a lost response replays one result after the project fills", async () => {
  const p = project(),
    key = randomUUID();
  const fingerprint = mediaInputFingerprint({
    operation: "upload",
    name: "Brand.png",
    kind: "image",
    license: "Private generated fixture rights",
    bytes: image.length,
    sha256: createHash("sha256").update(image).digest("hex"),
  });
  const headers = {
    Prefer: "respond-async",
    "Idempotency-Key": key,
    "X-Reelchemy-Media-Intent": fingerprint,
  };
  const first = await upload(
    request(owner, `/api/projects/${p.id}/assets`, {
      method: "POST",
      headers,
      body: form(),
    }),
    context(p.id),
  );
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("preference-applied"), "respond-async");
  const receipt = (await first.json()).request;
  assert.equal(receipt.state, "queued");
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
  assert.equal(
    (
      await status(
        request(other, `/api/media-requests/${receipt.id}`),
        context(receipt.id),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await cancel(
        request(other, `/api/media-requests/${receipt.id}/cancel`, {
          method: "POST",
        }),
        context(receipt.id),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await status(
        new Request(`${origin}/api/media-requests/${receipt.id}`),
        context(receipt.id),
      )
    ).status,
    401,
  );
  const catalog = await list(
    request(
      owner,
      `/api/workspace/media-requests?workspaceId=${other.workspace}`,
    ),
    context(""),
  );
  assert.equal(catalog.status, 200);
  const publicJson = JSON.stringify(await catalog.json());
  for (const secret of [
    fingerprint,
    "Brand.png",
    "Private generated fixture rights",
    owner.workspace,
    "token",
    "reserved_bytes",
    "sha256",
  ])
    assert.ok(!publicJson.includes(secret));
  const mismatch = await upload(
    request(owner, `/api/projects/${p.id}/assets`, {
      method: "POST",
      headers: { ...headers, "X-Reelchemy-Media-Intent": "b".repeat(64) },
      body: form(),
    }),
    context(p.id),
  );
  assert.equal(mismatch.status, 409);
  ingestion = await startMediaWorker();
  await until(
    () =>
      app.mediaProcessing.get(receipt.id, owner.workspace)?.state ===
      "completed",
    "Queued image did not complete",
  );
  const result = app.getProject(p.id)!;
  assert.equal(result.assets!.length, 1);
  assert.deepEqual(
    await readFile(path.join(root, "data", "assets", result.assets![0].id)),
    image,
  );
  const { storeImage } = await import("../src/lib/assets");
  for (let i = 0; i < 29; i++)
    app.appendOwnedAsset(
      p.id,
      owner.workspace,
      await storeImage(image, `Retained ${i}.png`, "Generated fixture rights"),
    );
  const replay = await upload(
    request(owner, `/api/projects/${p.id}/assets`, {
      method: "POST",
      headers: { ...headers, Prefer: "" },
      body: form(),
    }),
    context(p.id),
  );
  assert.equal(replay.status, 201);
  assert.equal((await replay.json()).assets.length, 30);
  assert.equal(app.getProject(p.id)!.assets!.length, 30);
  assert.equal(
    (
      await cancel(
        request(owner, `/api/media-requests/${receipt.id}/cancel`, {
          method: "POST",
        }),
        context(receipt.id),
      )
    ).status,
    200,
  );
  assert.equal(
    app.mediaProcessing.get(receipt.id, owner.workspace)?.state,
    "completed",
  );
  await ingestion.stop();
  ingestion = undefined;
});

test("queued cancellation removes private raw files without creating an asset", async () => {
  const p = project();
  const queued = await upload(
    request(owner, `/api/projects/${p.id}/assets`, {
      method: "POST",
      headers: { Prefer: "respond-async" },
      body: form(),
    }),
    context(p.id),
  );
  assert.equal(queued.status, 202);
  const receipt = (await queued.json()).request;
  const cancelled = await cancel(
    request(owner, `/api/media-requests/${receipt.id}/cancel`, {
      method: "POST",
    }),
    context(receipt.id),
  );
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).request.state, "cancelling");
  ingestion = await startMediaWorker();
  await until(
    () =>
      app.mediaProcessing.get(receipt.id, owner.workspace)?.state ===
        "cancelled" &&
      !app.mediaProcessing.get(receipt.id, owner.workspace)?.cleanupPending,
    "Cancelled raw input was not cleaned",
  );
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
  assert.deepEqual(await readdir(path.join(root, "data", "media-inputs")), []);
});

test("stalled body deadlines and aborts cancel readers; interrupted uploads retain no queued input", async () => {
  let cancelled = false;
  const stalled = new Request(`${origin}/raw`, {
    method: "POST",
    body: new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    duplex: "half",
  } as RequestInit);
  await assert.rejects(
    () => readLimitedBody(stalled, 100, { timeoutMs: 10 }),
    (error: unknown) =>
      error instanceof RequestBodyError && error.status === 408,
  );
  assert.equal(cancelled, true);
  const p = project(),
    controller = new AbortController();
  const req = request(owner, `/api/projects/${p.id}/assets`, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=interrupted" },
    signal: controller.signal,
    body: new ReadableStream({
      start() {
        setTimeout(() => controller.abort(), 10);
      },
    }),
    duplex: "half",
  } as RequestInit);
  assert.equal((await upload(req, context(p.id))).status, 408);
  await until(
    () => !app.mediaProcessing.projectBusy(p.id),
    "Interrupted receiver retained capacity",
  );
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
});

test("legacy waveform requests queue once, isolate ownership, meter new analysis and keep cached results available", async () => {
  await ingestion?.stop();
  ingestion = undefined;
  const p = project();
  const { storeAudio } = await import("../src/lib/audio");
  const bytes = Buffer.from(
    encodeRecording([new Float32Array(8000).fill(0.3)], 8000),
  );
  const first = await storeAudio(
    bytes,
    "Legacy voice.wav",
    "Generated private fixture",
  );
  const second = await storeAudio(
    bytes,
    "Another voice.wav",
    "Generated private fixture",
  );
  app.appendOwnedAsset(p.id, owner.workspace, first);
  app.appendOwnedAsset(p.id, owner.workspace, second);
  assert.equal(cachedWaveform(first.id), undefined);
  const { GET: waveform } =
    await import("../src/app/api/projects/[id]/assets/[assetId]/waveform/route");
  const ctx = (assetId: string) => ({
    params: Promise.resolve({ id: p.id, assetId }),
  });
  const url = (assetId: string) =>
    `/api/projects/${p.id}/assets/${assetId}/waveform`;
  const beforeLimit = process.env.REELCHEMY_WAVEFORMS_PER_HOUR;
  process.env.REELCHEMY_WAVEFORMS_PER_HOUR = "1";
  try {
    assert.equal(
      (await waveform(request(other, url(first.id)), ctx(first.id))).status,
      404,
    );
    const pending = await waveform(
      request(owner, url(first.id)),
      ctx(first.id),
    );
    assert.equal(
      pending.status,
      202,
      "An uncached legacy waveform must not decode in the web handler",
    );
    const receipt = await pending.json();
    const duplicate = await waveform(
      request(owner, url(first.id)),
      ctx(first.id),
    );
    assert.equal((await duplicate.json()).requestId, receipt.requestId);
    const limited = await waveform(
      request(owner, url(second.id)),
      ctx(second.id),
    );
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "MEDIA_ANALYSIS_LIMIT");
    assert.ok(Number(limited.headers.get("Retry-After")) > 0);
    ingestion = await startMediaWorker();
    await until(
      () => !!cachedWaveform(first.id),
      "Worker did not publish the legacy waveform",
    );
    const cached = await waveform(request(owner, url(first.id)), ctx(first.id));
    assert.equal(cached.status, 200);
    const result = await cached.json();
    assert.equal(result.fps, 30);
    assert.equal(result.peaks.length, 30);
    assert.ok(result.peaks.some((peak: number) => peak > 0.2));
    process.env.REELCHEMY_WAVEFORMS_PER_HOUR = "120";
    await until(
      () =>
        app.mediaProcessing.get(receipt.requestId, owner.workspace)?.state ===
        "completed",
      "Waveform receipt did not complete",
    );
    removeCachedWaveform(first.id);
    const rebuilt = await waveform(
      request(owner, url(first.id)),
      ctx(first.id),
    );
    assert.equal(rebuilt.status, 202);
    assert.notEqual((await rebuilt.json()).requestId, receipt.requestId);
    await until(
      () => !!cachedWaveform(first.id),
      "Rebuildable waveform cache did not recover",
    );
    app.setProjectTrashed(p.id, true);
    assert.equal(
      (await waveform(request(owner, url(first.id)), ctx(first.id))).status,
      404,
    );
  } finally {
    if (beforeLimit === undefined)
      delete process.env.REELCHEMY_WAVEFORMS_PER_HOUR;
    else process.env.REELCHEMY_WAVEFORMS_PER_HOUR = beforeLimit;
  }
});

function clientTransport(
  intercept?: (
    url: string,
    init: RequestInit,
    response: Response,
  ) => Promise<Response>,
) {
  const counts = { posts: 0, catalogues: 0, projects: 0 };
  const transport: AccountFetch = async (url, init = {}) => {
    const req = request(owner, url, init);
    const uploadMatch = url.match(/^\/api\/projects\/([^/]+)\/assets$/);
    const receiptMatch = url.match(/^\/api\/media-requests\/([^/]+)$/);
    const projectMatch = url.match(/^\/api\/projects\/([^/]+)$/);
    let response: Response;
    if (uploadMatch && init.method === "POST") {
      counts.posts++;
      response = await upload(req, context(uploadMatch[1]));
    } else if (uploadMatch) {
      counts.catalogues++;
      response = await catalogueGET(req, context(uploadMatch[1]));
    } else if (receiptMatch)
      response = await status(req, context(receiptMatch[1]));
    else if (projectMatch) {
      counts.projects++;
      response = await projectGET(req, context(projectMatch[1]));
    } else throw new Error("Unexpected private client test destination");
    return intercept ? intercept(url, init, response) : response;
  };
  return { transport, counts };
}

test("the browser submission transport retries an uncertain accepted upload with the same intent and one actual attachment", async () => {
  const p = project(),
    endpoint = `/api/projects/${p.id}/assets`;
  let interrupted = false;
  const keys: string[] = [];
  const client = clientTransport(async (_url, init, response) => {
    if (init.method === "POST") {
      keys.push(new Headers(init.headers).get("Idempotency-Key")!);
      if (!interrupted) {
        interrupted = true;
        assert.equal(response.status, 202);
        throw new TypeError("Synthetic response lost after queue admission");
      }
    }
    return response;
  });
  const pending: MediaSubmissionRef = { current: null };
  const controller = new AbortController();
  await assert.rejects(
    () =>
      submitMedia(
        client.transport,
        endpoint,
        form(),
        pending,
        controller.signal,
      ),
    /Synthetic response lost/,
  );
  assert.ok(pending.current?.key);
  const result = await submitMedia(
    client.transport,
    endpoint,
    form(),
    pending,
    controller.signal,
  );
  assert.equal(result.id, p.id);
  assert.equal(result.assets?.length, 1);
  assert.equal(client.counts.posts, 2);
  assert.equal(client.counts.projects, 0);
  assert.ok(client.counts.catalogues > 0);
  assert.deepEqual(Object.keys(result).sort(), ["assets", "id"]);
  assert.equal(keys[0], keys[1]);
  assert.equal(pending.current, null);
  assert.equal(app.getProject(p.id)?.assets?.length, 1);
});

test("accepted client requests survive a refresh failure or local wait deadline without uploading again", async () => {
  const p = project(),
    endpoint = `/api/projects/${p.id}/assets`;
  let failRefresh = true;
  const client = clientTransport(async (url, _init, response) => {
    if (
      url === `/api/projects/${p.id}/assets` &&
      _init.method !== "POST" &&
      failRefresh
    ) {
      failRefresh = false;
      return Response.json(
        { error: "Synthetic result refresh outage" },
        { status: 503 },
      );
    }
    return response;
  });
  const pending: MediaSubmissionRef = { current: null };
  const controller = new AbortController();
  await assert.rejects(
    () =>
      submitMedia(
        client.transport,
        endpoint,
        form(),
        pending,
        controller.signal,
      ),
    /Synthetic result refresh outage/,
  );
  assert.ok(pending.current?.requestId);
  assert.equal(
    (
      await submitMedia(
        client.transport,
        endpoint,
        form(),
        pending,
        controller.signal,
      )
    ).assets?.length,
    1,
  );
  assert.equal(client.counts.posts, 1);

  const next = project(),
    nextClient = clientTransport();
  const waiting: MediaSubmissionRef = { current: null };
  await assert.rejects(
    () =>
      submitMedia(
        nextClient.transport,
        `/api/projects/${next.id}/assets`,
        form(),
        waiting,
        controller.signal,
        () => {},
        0,
      ),
    MediaStillProcessing,
  );
  assert.ok(waiting.current?.requestId);
  assert.equal(
    (
      await submitMedia(
        nextClient.transport,
        `/api/projects/${next.id}/assets`,
        form(),
        waiting,
        controller.signal,
      )
    ).assets?.length,
    1,
  );
  assert.equal(nextClient.counts.posts, 1);
});

test("a confirmed processing failure permits a fresh explicit retry while an already-aborted client sends nothing", async () => {
  const p = project(),
    endpoint = `/api/projects/${p.id}/assets`,
    client = clientTransport();
  const pending: MediaSubmissionRef = { current: null },
    controller = new AbortController();
  const bad = Buffer.from("Private invalid image payload");
  await assert.rejects(
    () =>
      submitMedia(
        client.transport,
        endpoint,
        form(bad),
        pending,
        controller.signal,
      ),
    /could not be processed/,
  );
  assert.equal(pending.current, null);
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
  assert.equal(
    (
      await submitMedia(
        client.transport,
        endpoint,
        form(),
        pending,
        controller.signal,
      )
    ).assets?.length,
    1,
  );
  assert.equal(client.counts.posts, 2);
  controller.abort();
  await assert.rejects(
    () =>
      submitMedia(
        client.transport,
        endpoint,
        form(),
        pending,
        controller.signal,
      ),
    { name: "AbortError" },
  );
  assert.equal(client.counts.posts, 2);
});

test("cancelling a stalled receiving upload stops its reader before the receive deadline", async () => {
  const p = project();
  let stopped = false;
  const req = request(owner, `/api/projects/${p.id}/assets`, {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=cancel-receiving",
    },
    body: new ReadableStream(
      {
        cancel() {
          stopped = true;
        },
      },
      { highWaterMark: 0 },
    ),
    duplex: "half",
  } as RequestInit);
  const receiving = upload(req, context(p.id));
  await until(
    () =>
      app.mediaProcessing
        .list(owner.workspace)
        .requests.some(
          (item) => item.projectId === p.id && item.state === "receiving",
        ),
    "Receiver did not reserve capacity",
  );
  const item = app.mediaProcessing
    .list(owner.workspace)
    .requests.find((item) => item.projectId === p.id)!;
  assert.equal(
    (
      await cancel(
        request(owner, `/api/media-requests/${item.id}/cancel`, {
          method: "POST",
        }),
        context(item.id),
      )
    ).status,
    200,
  );
  const response = await receiving;
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("X-Reelchemy-Media-Not-Queued"), "1");
  assert.equal(stopped, true);
  await until(
    () => !app.mediaProcessing.projectBusy(p.id),
    "Cancelled receiver retained its raw reservation",
  );
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
});

test("the admitted media cap and the worker cap can each restrict a request, and client fields cannot raise either", async () => {
  const original = process.env.REELCHEMY_MEDIA_STORAGE_BYTES;
  const jpeg = await sharp(randomBytes(1024 * 1024 * 3), {
    raw: { width: 1024, height: 1024, channels: 3 },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  assert.ok(jpeg.length < 1024 * 1024);
  try {
    for (const smaller of ["web", "worker"]) {
      const cap = String(1024 * 1024);
      process.env.REELCHEMY_MEDIA_STORAGE_BYTES =
        smaller === "web" ? cap : original;
      await ingestion?.stop();
      ingestion = await startMediaWorker({
        ...process.env,
        REELCHEMY_MEDIA_STORAGE_BYTES: smaller === "worker" ? cap : original,
      });
      const target = project(),
        client = clientTransport(),
        pending: MediaSubmissionRef = { current: null };
      const body = form(jpeg, "Compressed photo.jpg");
      body.set("storageLimitBytes", String(1024 ** 4));
      await assert.rejects(
        () =>
          submitMedia(
            client.transport,
            `/api/projects/${target.id}/assets`,
            body,
            pending,
            new AbortController().signal,
          ),
        /exceeds your studio's remaining allowance/,
      );
      const denied = app.mediaProcessing
        .list(owner.workspace)
        .requests.find((item) => item.projectId === target.id)!;
      assert.equal(denied.error, "STORAGE_LIMIT");
      assert.equal(denied.storage?.limitBytes, 1024 * 1024);
      assert.ok(denied.storage!.requiredBytes > 1024 * 1024);
      assert.equal(app.getProject(target.id)?.assets?.length || 0, 0);
      assert.equal(pending.current, null);
    }
  } finally {
    if (original === undefined)
      delete process.env.REELCHEMY_MEDIA_STORAGE_BYTES;
    else process.env.REELCHEMY_MEDIA_STORAGE_BYTES = original;
    await ingestion?.stop();
    ingestion = await startMediaWorker();
  }
});

test("client multipart intent remains stable when filenames and rights contain encoded line breaks", async () => {
  const target = project(),
    client = clientTransport(),
    pending: MediaSubmissionRef = { current: null };
  const body = form(image, "../📷 Badge\r\n.png");
  body.set("license", "I own this\nclip");
  const result = await submitMedia(
    client.transport,
    `/api/projects/${target.id}/assets`,
    body,
    pending,
    new AbortController().signal,
  );
  assert.equal(result.assets?.[0].name, "__ Badge__.png");
  assert.equal(result.assets?.[0].license, "I own this\r\nclip");
  assert.equal(client.counts.posts, 1);
});

test("an open upload client can recover its receipt when a server rollback lacks catalogue GET", async () => {
  const target = project(),
    endpoint = `/api/projects/${target.id}/assets`,
    pending: MediaSubmissionRef = { current: null };
  const client = clientTransport(async (url, init, response) =>
    url === endpoint && init.method !== "POST"
      ? new Response(null, { status: 405 })
      : response,
  );
  const result = await submitMedia(
    client.transport,
    endpoint,
    form(),
    pending,
    new AbortController().signal,
  );
  assert.equal(result.id, target.id);
  assert.equal(result.assets?.length, 1);
  assert.deepEqual(Object.keys(result).sort(), ["assets", "id"]);
  assert.equal(client.counts.posts, 1);
  assert.equal(client.counts.projects, 1);
  assert.ok(client.counts.catalogues > 0);
  assert.equal(app.getProject(target.id)?.assets?.length, 1);
});

test("a completed upload retains its receipt until the catalogue contains that exact asset", async () => {
  const target = project(),
    endpoint = `/api/projects/${target.id}/assets`,
    pending: MediaSubmissionRef = { current: null };
  let missing = true;
  const client = clientTransport(async (url, init, response) =>
    missing && url === endpoint && init.method !== "POST"
      ? Response.json({ id: target.id, assets: [] })
      : response,
  );
  const signal = new AbortController().signal;
  await assert.rejects(
    () => submitMedia(client.transport, endpoint, form(), pending, signal),
    /catalogue could not be refreshed/,
  );
  const acceptedId = pending.current?.requestId;
  assert.ok(acceptedId);
  assert.equal(app.getProject(target.id)?.assets?.length, 1);
  assert.equal(client.counts.posts, 1);
  assert.equal(client.counts.projects, 0);
  missing = false;
  const result = await submitMedia(
    client.transport,
    endpoint,
    form(),
    pending,
    signal,
  );
  assert.equal(
    result.assets?.[0].id,
    app.mediaProcessing.get(acceptedId, owner.workspace)?.resultId,
  );
  assert.equal(pending.current, null);
  assert.equal(client.counts.posts, 1);
  assert.equal(client.counts.projects, 0);
});
