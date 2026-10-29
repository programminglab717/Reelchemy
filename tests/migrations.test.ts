import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("parallel service startup migrates legacy ownership/Trash columns without losing records", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "reelchemy-migration-"));
  try {
    const file = path.join(directory, "studio.sqlite"),
      db = new Database(file);
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL)",
    );
    db.prepare("INSERT INTO projects VALUES (?,?)").run(
      "legacy-id",
      JSON.stringify({ name: "Preserve this legacy record" }),
    );
    db.close();
    const results = await Promise.all(
      Array.from(
        { length: 3 },
        () =>
          new Promise<number>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                "await import('./src/lib/db.ts')",
              ],
              {
                env: {
                  ...process.env,
                  REELCHEMY_DATA_DIR: directory,
                  REELCHEMY_ARTIFACT_DIR: path.join(directory, "artifacts"),
                },
                stdio: ["ignore", "ignore", "pipe"],
              },
            );
            let error = "";
            child.stderr.on("data", (b) => {
              error += b.toString();
            });
            child.once("error", reject);
            child.once("close", (code) =>
              code === 0 ? resolve(code) : reject(new Error(error)),
            );
          }),
      ),
    );
    assert.deepEqual(results, [0, 0, 0]);
    const migrated = new Database(file, { readonly: true });
    try {
      const columns = migrated.pragma("table_info(projects)") as {
        name: string;
      }[];
      assert.equal(columns.filter((c) => c.name === "workspace_id").length, 1);
      assert.equal(columns.filter((c) => c.name === "trashed_at").length, 1);
      assert.deepEqual(
        migrated.prepare("SELECT * FROM projects WHERE id=?").get("legacy-id"),
        {
          id: "legacy-id",
          data: JSON.stringify({ name: "Preserve this legacy record" }),
          workspace_id: null,
          trashed_at: null,
        },
      );
    } finally {
      migrated.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
