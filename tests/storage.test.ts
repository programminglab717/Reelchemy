import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  truncate,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline, revisionId } from "../src/lib/editor";
import {
  DEFAULT_MEDIA_STORAGE_BYTES,
  mediaStorageLimit,
  MediaStorageLimitError,
} from "../src/lib/media-storage-policy";
import { LimitConfigurationError } from "../src/lib/limits-policy";
import type { Asset, Project } from "../src/lib/schema";
const MiB = 1024 * 1024;
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-storage-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(MiB);
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const assets = path.join(dir, "assets");
await mkdir(assets);
const brief = {
  prompt: "Private media allowance",
  duration: 5,
  format: "landscape" as const,
};
function metadata(id: string): Asset {
  return {
    id,
    name: "Synthetic media",
    source: "Fixture",
    license: "Owned",
    mime: "image/png",
    createdAt: new Date().toISOString(),
    bytes: 1,
  };
}
const legacyId = randomUUID(),
  legacyProjectId = randomUUID();
await writeFile(path.join(assets, legacyId), Buffer.alloc(128 * 1024));
const raw = new Database(path.join(dir, "studio.sqlite"));
raw.exec("CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL)");
raw.prepare("INSERT INTO projects VALUES (?,?)").run(
  legacyProjectId,
  JSON.stringify({
    id: legacyProjectId,
    name: "Legacy media",
    brief,
    timeline: null,
    revisions: [],
    messages: [],
    createdAt: new Date().toISOString(),
    assets: [metadata(legacyId)],
  }),
);
raw.close();
const db = await import("../src/lib/db");
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function asset(bytes: number) {
  const id = randomUUID();
  await writeFile(path.join(assets, id), Buffer.alloc(bytes));
  return metadata(id);
}
test("media storage policy has a bounded default and fails closed on invalid operator values", async () => {
  assert.equal(mediaStorageLimit({}), DEFAULT_MEDIA_STORAGE_BYTES);
  assert.equal(
    mediaStorageLimit({ REELCHEMY_MEDIA_STORAGE_BYTES: String(MiB) }),
    MiB,
  );
  for (const value of [
    "0",
    "-1",
    "1048575",
    "1.5",
    "unlimited",
    "1e9",
    String(1024 ** 4 + 1),
  ])
    assert.throws(
      () => mediaStorageLimit({ REELCHEMY_MEDIA_STORAGE_BYTES: value }),
      LimitConfigurationError,
    );
  const { failure } = await import("../src/lib/http");
  const response = failure(new MediaStorageLimitError(500, 1000, 600));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "MEDIA_STORAGE_LIMIT");
  assert.match(response.headers.get("cache-control")!, /private/);
});
test("legacy file census, private totals, Trash and concurrent quota admission use actual retained media bytes", async () => {
  const owner = db.ensureWorkspace("storage-fixture-owner", "Owner");
  assert.equal(db.mediaStorage(owner.id).usedBytes, 0);
  db.claimLegacyProjects(owner.id, true);
  assert.equal(db.mediaStorage(owner.id).usedBytes, 128 * 1024); // Ignores forged metadata.bytes=1.
  const p = db.createProject(brief, owner.id);
  db.reviseProject(p, blankTimeline(brief), "Fixture");
  const candidates = await Promise.all([asset(MiB / 2), asset(MiB / 2)]);
  const results = await Promise.all(
    candidates.map(
      (candidate) =>
        new Promise<string>((resolve, reject) => {
          const source = `const db=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/db.ts")).href)});try{db.appendOwnedAsset(${JSON.stringify(p.id)},${JSON.stringify(owner.id)},${JSON.stringify(candidate)});console.log('added');}catch(error){if(error.code==='MEDIA_STORAGE_LIMIT')console.log('limited');else throw error;}`;
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "--eval", source],
            { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "",
            errors = "";
          child.stdout.on("data", (value) => {
            output += value.toString();
          });
          child.stderr.on("data", (value) => {
            errors += value.toString();
          });
          child.once("error", reject);
          child.once("close", (code) =>
            code === 0 ? resolve(output.trim()) : reject(new Error(errors)),
          );
        }),
    ),
  );
  assert.deepEqual(results.sort(), ["added", "limited"]);
  assert.equal(db.getProject(p.id)!.assets!.length, 1);
  assert.equal(db.getProject(p.id)!.assets![0].bytes, MiB / 2);
  assert.equal(db.mediaStorage(owner.id).usedBytes, 128 * 1024 + MiB / 2);
  const accepted = db.getProject(p.id)!.assets![0].id;
  process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(2 * MiB);
  db.appendOwnedAsset(
    p.id,
    owner.id,
    candidates.find((entry) => entry.id !== accepted)!,
  );
  assert.equal(db.getProject(p.id)!.assets!.length, 2);
  const other = db.ensureWorkspace("another-storage-owner", "Other");
  const otherProject = db.createProject(brief, other.id);
  assert.throws(
    () =>
      db.appendOwnedAsset(
        otherProject.id,
        other.id,
        db.getProject(p.id)!.assets![0],
      ),
    /Invalid media reference/,
  );
  assert.equal(db.mediaStorage(other.id).usedBytes, 0);
  const used = db.mediaStorage(owner.id).usedBytes;
  db.setProjectTrashed(p.id, true);
  assert.equal(db.mediaStorage(owner.id).usedBytes, used);
  db.setProjectTrashed(p.id, false);
  assert.equal(db.mediaStorage(other.id).usedBytes, 0);
  process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(MiB);
  assert.equal(db.mediaStorage(owner.id).remainingBytes, 0); // Existing over-limit data is retained/readable.
  await truncate(path.join(assets, legacyId), 256 * 1024);
  db.recountMediaStorage();
  assert.equal(db.mediaStorage(owner.id).usedBytes, 256 * 1024 + MiB);
  const later = await asset(64 * 1024),
    laterProject = db.createProject(brief, owner.id);
  laterProject.assets = [later]; // Models a snapshot/admin record added after the initial census.
  db.saveProject(laterProject);
  assert.equal(db.mediaStorage(owner.id).usedBytes, 320 * 1024 + MiB);
});
test("guarded upload/import routes reject excess processed bytes, clean new files and preserve private/manual work", async () => {
  const { getAuth } = await import("../src/lib/auth");
  const auth = await getAuth();
  const email = "storage-creator@example.test",
    password = "Test-only-storage-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: "Storage creator", email, password },
  });
  const admin = new Database(path.join(dir, "auth.sqlite"));
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert(cookie);
  const owner = db.ensureWorkspace(signup.user.id, "Storage creator");
  const p = db.createProject(brief, owner.id);
  db.reviseProject(p, blankTimeline(brief), "Initial manual scene");
  const { POST: upload } =
    await import("../src/app/api/projects/[id]/assets/route");
  const { POST: importProject } =
    await import("../src/app/api/projects/import/route");
  const { GET: usage } = await import("../src/app/api/workspace/storage/route");
  const { PATCH } = await import("../src/app/api/projects/[id]/route");
  const headers = {
    host: "127.0.0.1:3001",
    origin: "http://127.0.0.1:3001",
    cookie,
  };
  const context = { params: Promise.resolve({ id: p.id }) };
  const request = (url: string, method = "GET", body?: BodyInit) =>
    new Request(`http://127.0.0.1:3001${url}`, { method, headers, body });
  const uploadRequest = (bytes: Buffer, name: string, mime: string) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], name, { type: mime }));
    form.set("license", "Owned generated fixture");
    return request(`/api/projects/${p.id}/assets`, "POST", form);
  };
  const originalFiles = (await readdir(assets)).sort();
  const jpeg = await sharp(randomBytes(1024 * 1024 * 3), {
    raw: { width: 1024, height: 1024, channels: 3 },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  assert(jpeg.length < MiB);
  const denied = await upload(
    uploadRequest(jpeg, "compressed.jpg", "image/jpeg"),
    context,
  );
  assert.equal(denied.status, 413);
  const denial = await denied.json();
  assert.equal(denial.code, "MEDIA_STORAGE_LIMIT");
  assert(denial.requiredBytes > MiB);
  assert.deepEqual((await readdir(assets)).sort(), originalFiles);
  assert.equal(db.getProject(p.id)!.assets?.length || 0, 0);
  assert.equal(db.mediaStorage(owner.id).usedBytes, 0);
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  const added = await upload(
    uploadRequest(png, "small.png", "image/png"),
    context,
  );
  assert.equal(added.status, 201);
  const saved = (await added.json()) as Project;
  const media = saved.assets![0];
  assert.equal(
    media.bytes,
    (await readFile(path.join(assets, media.id))).length,
  );
  assert.equal(db.mediaStorage(owner.id).usedBytes, media.bytes);
  const filled = await asset(MiB - media.bytes!);
  db.appendOwnedAsset(p.id, owner.id, filled);
  const latest = db.getProject(p.id)!;
  const edited = structuredClone(latest.timeline!);
  edited.scenes[0].title = "Manual editing still works at the media ceiling";
  assert.equal(
    (
      await PATCH(
        request(
          `/api/projects/${p.id}`,
          "PATCH",
          JSON.stringify({
            timeline: edited,
            baseRevisionId: revisionId(latest),
          }),
        ),
        context,
      )
    ).status,
    200,
  );
  const privateUsage = await usage(
    request("/api/workspace/storage?workspaceId=another-storage-owner"),
    { params: Promise.resolve({}) },
  );
  assert.equal(privateUsage.status, 200);
  assert.equal((await privateUsage.json()).usedBytes, MiB);
  assert.match(privateUsage.headers.get("cache-control")!, /private/);
  assert.equal(
    (
      await usage(new Request("http://127.0.0.1:3001/api/workspace/storage"), {
        params: Promise.resolve({}),
      })
    ).status,
    401,
  );
  const { exportArchive } = await import("../src/lib/archive");
  const { storeImage } = await import("../src/lib/assets");
  const sourceMedia = await storeImage(png, "archive.png", "Owned fixture");
  const template: Project = {
    ...db.getProject(p.id)!,
    id: randomUUID(),
    assets: [{ ...sourceMedia, bytes: 1 }],
  };
  const archive = await exportArchive(template);
  const beforeImport = (await readdir(assets)).sort(),
    projectCount = db.countProjects(owner.id);
  const rejectedImport = await importProject(
    request("/api/projects/import", "POST", new Uint8Array(archive)),
    { params: Promise.resolve({}) },
  );
  assert.equal(rejectedImport.status, 413);
  assert((await rejectedImport.json()).requiredBytes > 1);
  assert.deepEqual((await readdir(assets)).sort(), beforeImport);
  assert.equal(db.countProjects(owner.id), projectCount);
  const noMedia = await exportArchive({ ...template, assets: [] });
  assert.equal(
    (
      await importProject(
        request("/api/projects/import", "POST", new Uint8Array(noMedia)),
        { params: Promise.resolve({}) },
      )
    ).status,
    201,
  );
  assert.equal(db.mediaStorage(owner.id).usedBytes, MiB);
  process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(4 * MiB);
  const rawUpload = uploadRequest(png, "late.png", "image/png");
  const reader = rawUpload.body!.getReader();
  let trashed = false;
  const lateBody = new ReadableStream(
    {
      async pull(controller) {
        if (!trashed) {
          db.setProjectTrashed(p.id, true);
          trashed = true;
        }
        const chunk = await reader.read();
        if (chunk.done) controller.close();
        else controller.enqueue(chunk.value);
      },
    },
    { highWaterMark: 0 },
  );
  const beforeLateUpload = (await readdir(assets)).sort(),
    savedBeforeLateUpload = db.getProject(p.id);
  const lateRequest = new Request(rawUpload.url, {
    method: "POST",
    headers: rawUpload.headers,
    body: lateBody,
    duplex: "half",
  } as RequestInit & { duplex: string });
  assert.equal((await upload(lateRequest, context)).status, 404);
  assert(trashed);
  assert.deepEqual((await readdir(assets)).sort(), beforeLateUpload);
  assert.deepEqual(db.getProject(p.id), savedBeforeLateUpload);
  assert.equal(db.mediaStorage(owner.id).usedBytes, MiB);
  db.setProjectTrashed(p.id, false);
  process.env.REELCHEMY_MEDIA_STORAGE_BYTES = "invalid";
  try {
    assert.equal(
      (
        await usage(request("/api/workspace/storage"), {
          params: Promise.resolve({}),
        })
      ).status,
      503,
    );
    assert.equal(
      (await upload(uploadRequest(png, "blocked.png", "image/png"), context))
        .status,
      503,
    );
    const { readiness } = await import("../src/lib/health");
    assert.equal((await readiness()).checks.limits, false);
  } finally {
    process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(MiB);
  }
});
