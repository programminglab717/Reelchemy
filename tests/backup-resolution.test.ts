import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import { blankTimeline } from "../src/lib/editor";
import { initializePrivacyVault } from "../src/lib/privacy-vault";

test("native HD current/history/job-only snapshots require v6 and retain source bytes and restored settings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-hd-backup-"));
  const names = [
    "REELCHEMY_PRIVACY_DIR",
    "REELCHEMY_PRIVACY_ID",
    "REELCHEMY_PRIVACY_KEY_FINGERPRINT",
  ] as const;
  const saved = names.map((name) => process.env[name]);
  try {
    const vault = initializePrivacyVault(path.join(root, "privacy"));
    process.env.REELCHEMY_PRIVACY_DIR = vault.directory;
    process.env.REELCHEMY_PRIVACY_ID = vault.id;
    process.env.REELCHEMY_PRIVACY_KEY_FINGERPRINT = vault.keyFingerprint;
    const data = path.join(root, "source-data"),
      artifacts = path.join(root, "source-exports");
    await mkdir(data, { mode: 0o700 });
    await mkdir(artifacts, { mode: 0o700 });
    const file = path.join(data, "studio.sqlite");
    const db = new Database(file);
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE workspaces(owner_id TEXT);",
    );
    const timeline = {
      ...blankTimeline({
        prompt: "HD backup",
        duration: 5,
        format: "portrait",
      }),
      exportResolution: "1080p" as const,
    };
    const projectId = randomUUID(),
      jobId = randomUUID();
    db.prepare("INSERT INTO projects VALUES(?,?)").run(
      projectId,
      JSON.stringify({ timeline, assets: [], revisions: [] }),
    );
    db.close();
    for (const mode of ["current", "history", "job-only"] as const) {
      const edit = new Database(file);
      edit.prepare("UPDATE projects SET data=?").run(
        JSON.stringify({
          timeline: mode === "current" ? timeline : null,
          assets: [],
          revisions: mode === "history" ? [{ timeline }] : [],
        }),
      );
      if (mode === "job-only")
        edit
          .prepare("INSERT INTO jobs VALUES(?,?,'failed','{}',?)")
          .run(jobId, projectId, JSON.stringify(timeline));
      edit.close();
      const before = await readFile(file);
      const output = path.join(root, `snapshot-${mode}`);
      await createBackup({ data, artifacts, output, vault });
      const manifest = await verifyBackup(output);
      assert.equal(manifest.version, 6);
      assert(manifest.capabilities?.includes("native-hd-v1"));
      const restored = path.join(root, `restored-${mode}`);
      await restoreBackup(output, restored);
      const copy = new Database(path.join(restored, "data", "studio.sqlite"), {
        readonly: true,
      });
      try {
        const project = JSON.parse(
          (copy.prepare("SELECT data FROM projects").get() as { data: string })
            .data,
        );
        const retained =
          mode === "job-only"
            ? JSON.parse(
                (
                  copy.prepare("SELECT timeline FROM jobs").get() as {
                    timeline: string;
                  }
                ).timeline,
              )
            : mode === "history"
              ? project.revisions[0].timeline
              : project.timeline;
        assert.equal(retained.exportResolution, "1080p");
      } finally {
        copy.close();
      }
      assert.deepEqual(await readFile(file), before);
      const forged = {
        ...manifest,
        version: 5,
        capabilities: manifest.capabilities?.filter(
          (c) => c !== "native-hd-v1",
        ),
      };
      await writeFile(
        path.join(output, "manifest.json"),
        JSON.stringify(forged),
      );
      await assert.rejects(() => verifyBackup(output), /capability/);
    }
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
    await rm(root, { recursive: true, force: true });
  }
});
