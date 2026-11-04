import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import { migrateMediaReferences } from "../src/lib/media-references";
import {
  migrateExportFileRemovals,
  requestExportFileRemoval,
} from "../src/lib/export-file-store";
test("new snapshots omit consented export files and preserve history/job-only sources without mutating the installation", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "reelchemy-export-backup-")),
    data = path.join(base, "source/data"),
    artifacts = path.join(base, "source/artifacts"),
    output = path.join(base, "snapshot"),
    jobId = randomUUID(),
    otherJob = randomUUID(),
    sourceId = randomUUID(),
    historyId = randomUUID(),
    projectId = randomUUID();
  try {
    await mkdir(path.join(data, "assets"), { recursive: true });
    for (const id of [jobId, otherJob])
      await mkdir(path.join(artifacts, id), { recursive: true });
    await writeFile(path.join(data, "assets", sourceId), "JOB-ONLY SOURCE");
    await writeFile(
      path.join(data, "assets", historyId),
      "HISTORY-ONLY SOURCE",
    );
    await writeFile(
      path.join(artifacts, jobId, "video.mp4"),
      "REMOVE-ON-SNAPSHOT",
    );
    await writeFile(path.join(artifacts, otherJob, "video.mp4"), "KEEP-EXPORT");
    const file = path.join(data, "studio.sqlite"),
      db = new Database(file);
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE workspaces(owner_id TEXT);CREATE TABLE project_deletions(project_id TEXT,state TEXT)",
    );
    migrateMediaReferences(db);
    migrateExportFileRemovals(db);
    db.prepare("INSERT INTO projects VALUES(?,?,'studio',NULL)").run(
      projectId,
      JSON.stringify({
        assets: [],
        revisions: [{ timeline: { assetId: historyId } }],
      }),
    );
    for (const id of [jobId, otherJob])
      db.prepare("INSERT INTO jobs VALUES(?,?,'completed',?,?)").run(
        id,
        projectId,
        JSON.stringify({ id, projectId, status: "completed" }),
        JSON.stringify({ assetId: sourceId }),
      );
    requestExportFileRemoval(db, {
      format: "reelchemy-export-files-v1",
      jobId,
      projectId,
      workspaceId: "studio",
      root: null,
      directory: null,
      files: [],
    });
    db.close();
    const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
      before = hash(await readFile(file));
    await createBackup({ data, artifacts, output });
    const manifest = await verifyBackup(output);
    assert.equal(manifest.version, 5);
    assert.deepEqual(manifest.capabilities, [
      "removed-export-files-v1",
      "account-erasure-v1",
    ]);
    assert(
      !manifest.entries.some((e) => e.path.startsWith(`artifacts/${jobId}/`)),
    );
    assert(
      manifest.entries.some(
        (e) => e.path === `artifacts/${otherJob}/video.mp4`,
      ),
    );
    for (const id of [sourceId, historyId])
      assert(manifest.entries.some((e) => e.path === `data/assets/${id}`));
    assert.equal(hash(await readFile(file)), before);
    assert.equal(
      await readFile(path.join(artifacts, jobId, "video.mp4"), "utf8"),
      "REMOVE-ON-SNAPSHOT",
    );
    const restored = await restoreBackup(output, path.join(base, "restored"));
    await assert.rejects(access(path.join(restored.artifacts, jobId)), {
      code: "ENOENT",
    });
    const copy = new Database(path.join(restored.data, "studio.sqlite"));
    assert.deepEqual(
      copy
        .prepare(
          "SELECT state,token,manifest FROM export_file_removals WHERE job_id=?",
        )
        .get(jobId),
      { state: "completed", token: null, manifest: null },
    );
    assert.equal(
      (copy.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n,
      2,
    );
    copy.close();
    for (const id of [sourceId, historyId])
      assert.deepEqual(
        await readFile(path.join(restored.data, "assets", id)),
        await readFile(path.join(data, "assets", id)),
      );
    const manifestFile = path.join(output, "manifest.json"),
      saved = await readFile(manifestFile, "utf8");
    await writeFile(
      manifestFile,
      JSON.stringify({ ...manifest, capabilities: undefined }),
    );
    await assert.rejects(verifyBackup(output), /capability/);
    await writeFile(
      manifestFile,
      JSON.stringify({ ...manifest, version: 1, capabilities: undefined }),
    );
    await assert.rejects(verifyBackup(output), /capability/);
    await writeFile(manifestFile, saved);
    assert.equal(hash(await readFile(file)), before);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
