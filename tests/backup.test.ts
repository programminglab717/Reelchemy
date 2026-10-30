import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import sharp from "sharp";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import { blankTimeline, revisionId } from "../src/lib/editor";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-backup-drill-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "source/data");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "source/artifacts");
process.env.EMAIL_DELIVERY = "file";

test("backup/restore drill preserves accounts, private workspaces/media and exports while revoking sessions and active jobs", async () => {
  const db = await import("../src/lib/db");
  const { getAuth } = await import("../src/lib/auth");
  const auth = await getAuth();
  const email = "backup-creator@example.test",
    password = "Test-only-backup-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: "Backup creator", email, password },
  });
  const admin = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "auth.sqlite"),
  );
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const oldCookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(oldCookie);
  const workspace = db.ensureWorkspace(signup.user.id, "Creator");
  const brief = {
    prompt: "Restorable story",
    duration: 5,
    format: "landscape" as const,
  };
  const p = db.createProject(brief, workspace.id);
  db.reviseProject(p, blankTimeline(brief), "Initial");
  const { storeImage } = await import("../src/lib/assets");
  const image = await storeImage(
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer(),
    "logo.png",
    "Owned synthetic image",
  );
  p.assets = [image];
  db.saveProject(p);
  const job = db.createJob(p);
  db.claimJob();
  const exports = path.join(process.env.REELCHEMY_ARTIFACT_DIR!, job.id);
  await mkdir(exports);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path.join(exports, "video.mp4"),
  ]);
  db.updateJob(job.id, {
    status: "completed",
    progress: 1,
    report: { export: { path: path.join(exports, "video.mp4") } },
  });
  const requestKey = crypto.randomUUID();
  const queued = db.createOwnedJob(p.id, workspace.id, {
    key: requestKey,
    baseRevisionId: revisionId(p),
  })!.job;
  await writeFile(
    path.join(process.env.REELCHEMY_DATA_DIR!, "private-config"),
    "must not be copied",
  );
  const output = path.join(root, "snapshot");
  const options = {
    data: process.env.REELCHEMY_DATA_DIR!,
    artifacts: process.env.REELCHEMY_ARTIFACT_DIR!,
    output,
  };
  try {
    const made = await createBackup(options);
    assert(made.files >= 5);
    const manifest = await verifyBackup(output);
    assert(
      !manifest.entries.some((e) =>
        /mail|lock|heartbeat|private-config|scene-cache/.test(e.path),
      ),
    );
    assert.equal((await stat(output)).mode & 0o777, 0o700);
    for (const entry of manifest.entries)
      assert.equal(
        (await stat(path.join(output, entry.path))).mode & 0o777,
        0o600,
      );
    const oldManifest = await readFile(path.join(output, "manifest.json"));
    await assert.rejects(() => createBackup(options), /EEXIST/);
    assert.deepEqual(
      await readFile(path.join(output, "manifest.json")),
      oldManifest,
    );
    const restored = await restoreBackup(output, path.join(root, "restored"));
    assert.deepEqual(
      await readFile(path.join(restored.data, "assets", image.id)),
      await readFile(path.join(options.data, "assets", image.id)),
    );
    assert.deepEqual(
      await readFile(path.join(restored.artifacts, job.id, "video.mp4")),
      await readFile(path.join(exports, "video.mp4")),
    );
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      path.join(restored.artifacts, job.id, "video.mp4"),
      "-f",
      "null",
      "-",
    ]);
    const target = new Database(path.join(restored.data, "studio.sqlite"));
    const pending = target
      .prepare("SELECT status FROM jobs WHERE id=?")
      .get(queued.id) as { status: string };
    assert.equal(pending.status, "failed");
    assert.equal(
      JSON.parse(
        (
          target.prepare("SELECT data FROM jobs WHERE id=?").get(job.id) as {
            data: string;
          }
        ).data,
      ).report.export.path,
      path.join(restored.artifacts, job.id, "video.mp4"),
    );
    target.close();
    const accounts = new Database(path.join(restored.auth, "auth.sqlite"));
    assert.equal(
      (
        accounts.prepare('SELECT count(*) as n FROM "session"').get() as {
          n: number;
        }
      ).n,
      0,
    );
    accounts.close();
    // A fresh process exercises restored Better Auth credentials and project authorization.
    const result = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      const {getAuth} = await import('./src/lib/auth.ts');
      const {secureRoute} = await import('./src/lib/access.ts');
      const {createOwnedJob,listJobs} = await import('./src/lib/db.ts');
      const auth = await getAuth();
      const route = secureRoute(() => Response.json({ok:true}), 'project');
      const url = 'http://127.0.0.1:3001/api/projects/${p.id}';
      const ctx = {params: Promise.resolve({id:'${p.id}'})};
      const old = await route(new Request(url, {headers: {cookie:process.env.TEST_OLD_COOKIE}}),ctx);
      const signed = await auth.api.signInEmail({body:{email:'${email}',password:'${password}'},asResponse:true});
      const cookie = signed.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
      const fresh = await route(new Request(url,{headers:{cookie}}),ctx);
      const replay = createOwnedJob('${p.id}', '${workspace.id}', {key:'${requestKey}',baseRevisionId:'${revisionId(p)}'});
      console.log(JSON.stringify({old:old.status,login:signed.status,fresh:fresh.status,replayed:replay.replayed,same:replay.job.id==='${queued.id}',status:replay.job.status,jobs:listJobs('${p.id}').length}));
    `,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          REELCHEMY_DATA_DIR: restored.data,
          REELCHEMY_AUTH_DIR: restored.auth,
          REELCHEMY_ARTIFACT_DIR: restored.artifacts,
          TEST_OLD_COOKIE: oldCookie,
        },
      },
    );
    assert.deepEqual(JSON.parse(result), {
      old: 401,
      login: 200,
      fresh: 200,
      replayed: true,
      same: true,
      status: "failed",
      jobs: 2,
    });
    await assert.rejects(
      () => restoreBackup(output, path.join(root, "restored")),
      /EEXIST/,
    );
    await writeFile(path.join(output, "data/assets", image.id), "corrupt");
    await assert.rejects(() => verifyBackup(output), /checksum/);
    await assert.rejects(
      () => restoreBackup(output, path.join(root, "bad-restore")),
      /checksum/,
    );
    await assert.rejects(() => access(path.join(root, "bad-restore")));
    assert.equal(
      db.getJob(queued.id)?.status,
      "queued",
      "restore must not mutate the source installation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup paths and symbolic links cannot cause overwrite or recursive copying", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "reelchemy-backup-paths-"));
  try {
    const data = path.join(base, "data"),
      artifacts = path.join(base, "artifacts");
    await mkdir(data);
    await mkdir(artifacts);
    await symlink(data, path.join(base, "alias"));
    for (const output of [
      path.join(data, "nested"),
      path.join(base, "alias/nested"),
    ])
      await assert.rejects(
        () => createBackup({ data, artifacts, output }),
        /outside/,
      );
    await writeFile(path.join(data, "worker.lock"), "fixture");
    await assert.rejects(
      () =>
        createBackup({ data, artifacts, output: path.join(base, "locked") }),
      /Stop the render worker/,
    );
    await assert.rejects(() => access(path.join(base, "locked")));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("verification rejects traversal entries, unexpected files and symbolic-link payloads", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "reelchemy-backup-invalid-"));
  try {
    const data = path.join(base, "data"),
      artifacts = path.join(base, "artifacts"),
      output = path.join(base, "snapshot");
    await mkdir(data);
    await mkdir(artifacts);
    const source = new Database(path.join(data, "studio.sqlite"));
    source.exec(
      "CREATE TABLE projects(data TEXT); CREATE TABLE jobs(id TEXT,status TEXT); CREATE TABLE workspaces(owner_id TEXT)",
    );
    source.close();
    await createBackup({ data, artifacts, output });
    const manifestFile = path.join(output, "manifest.json"),
      original = await readFile(manifestFile);
    const manifest = JSON.parse(original.toString());
    manifest.entries[0].path = "../outside";
    await writeFile(manifestFile, JSON.stringify(manifest));
    await assert.rejects(() => verifyBackup(output));
    await writeFile(manifestFile, original);
    await writeFile(path.join(output, "extra"), "not listed");
    await assert.rejects(() => verifyBackup(output), /unexpected/);
    await rm(path.join(output, "extra"));
    await rm(path.join(output, "data/studio.sqlite"));
    await symlink(
      path.join(data, "studio.sqlite"),
      path.join(output, "data/studio.sqlite"),
    );
    await assert.rejects(() => verifyBackup(output), /symbolic link/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
