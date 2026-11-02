import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectStoragePolicy,
  ProjectStorageLimit,
} from "../src/lib/project-storage-policy";
import {
  admitProjectData,
  projectDataUsage,
  migrateProjectStorage,
} from "../src/lib/project-storage";
import {
  storageFixture,
  writeProject,
  projectDocument,
} from "./project-storage-fixture";
test("project storage policy is bounded and refuses disabled, fractional, overflowing and inconsistent budgets", () => {
  assert.equal(projectStoragePolicy({}).versions, 10000);
  for (const raw of [
    "0",
    "-1",
    "1.5",
    " 1048576",
    "1e9",
    "9999999999999999999",
  ])
    assert.throws(() =>
      projectStoragePolicy({ REELCHEMY_PROJECT_DATA_BYTES: raw }),
    );
  assert.throws(() =>
    projectStoragePolicy({ REELCHEMY_STUDIO_DATA_BYTES: "1048576" }),
  );
  assert.throws(() =>
    projectStoragePolicy({ REELCHEMY_PROJECT_VERSIONS: "10001" }),
  );
});
test("derived sizes use UTF-8 bytes, follow legacy writes/ownership/Trash/deletion and migrate without changing documents", () => {
  const db = storageFixture();
  try {
    const data = JSON.stringify(projectDocument());
    writeProject(db, "p", "owner", data);
    assert.deepEqual(projectDataUsage(db, "owner"), {
      bytes: Buffer.byteLength(data),
      projects: 1,
    });
    db.prepare(
      "UPDATE projects SET workspace_id='other',trashed_at='private-time' WHERE id='p'",
    ).run();
    assert.equal(projectDataUsage(db, "owner").bytes, 0);
    assert.equal(projectDataUsage(db, "other").projects, 1);
    migrateProjectStorage(db);
    assert.equal(
      (db.prepare("SELECT data FROM projects").get() as { data: string }).data,
      data,
    );
    const larger = JSON.stringify({
      ...projectDocument(),
      legacy: "保留".repeat(20),
    });
    db.prepare("UPDATE projects SET data=? WHERE id='p'").run(larger);
    assert.equal(
      projectDataUsage(db, "other").bytes,
      Buffer.byteLength(larger),
    );
    db.exec("DELETE FROM projects");
    assert.equal(projectDataUsage(db, "other").projects, 0);
  } finally {
    db.close();
  }
});
test("project byte/version/message limits refuse growth without partial writes and allow reductions of legacy overages", () => {
  const db = storageFixture(),
    policy = {
      ...projectStoragePolicy(),
      projectBytes: 1024 ** 2,
      versions: 2,
      messages: 3,
    };
  try {
    const data = JSON.stringify(projectDocument(2, 3));
    writeProject(db, "p", "owner", data, policy);
    for (const next of [
      projectDocument(3, 3),
      projectDocument(2, 4),
      { ...projectDocument(2, 3), large: "保".repeat(400000) },
    ]) {
      assert.throws(
        () => writeProject(db, "p", "owner", JSON.stringify(next), policy),
        ProjectStorageLimit,
      );
      assert.equal(
        (
          db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
            data: string;
          }
        ).data,
        data,
      );
    }
    const legacy = JSON.stringify({
      ...projectDocument(9, 10),
      large: "x".repeat(2 * 1024 ** 2),
    });
    db.prepare("UPDATE projects SET data=? WHERE id='p'").run(legacy);
    writeProject(
      db,
      "p",
      "owner",
      JSON.stringify(projectDocument(8, 9)),
      policy,
    );
    assert.equal(
      (
        db.prepare("SELECT versions FROM project_data_sizes").get() as {
          versions: number;
        }
      ).versions,
      8,
    );
  } finally {
    db.close();
  }
});
test("studio counts include Trash and byte admission counts retained data while isolated studios keep their own allowance", () => {
  const db = storageFixture(),
    policy = {
      ...projectStoragePolicy(),
      studioProjects: 1,
      studioBytes: 1024 ** 2,
      projectBytes: 1024 ** 2,
    };
  try {
    const data = JSON.stringify({
      ...projectDocument(1, 1),
      padding: "x".repeat(600000),
    });
    writeProject(db, "p", "one", data, policy);
    db.exec("UPDATE projects SET trashed_at='private-time' WHERE id='p'");
    assert.throws(
      () =>
        writeProject(db, "q", "one", '{"revisions":[],"messages":[]}', policy),
      (e: unknown) =>
        e instanceof ProjectStorageLimit &&
        e.kind === "projects" &&
        e.scope === "studio",
    );
    writeProject(db, "other", "two", data, policy);
    assert.equal(projectDataUsage(db, "two").projects, 1);
    db.exec("DELETE FROM projects WHERE id='p'");
    writeProject(db, "q", "one", data, policy);
  } finally {
    db.close();
  }
});
test("service budgets include unassigned legacy content, do not leak its usage, and permit shrinking after admission closes", () => {
  const db = storageFixture(),
    policy = { ...projectStoragePolicy(), serviceProjects: 1 };
  try {
    const data = JSON.stringify(projectDocument(1, 1));
    writeProject(db, "legacy", null, data, policy);
    assert.throws(
      () => writeProject(db, "new", "owner", data, policy),
      (e: unknown) =>
        e instanceof ProjectStorageLimit &&
        e.scope === "service" &&
        !e.message.includes(String(Buffer.byteLength(data))),
    );
    writeProject(
      db,
      "legacy",
      null,
      JSON.stringify({ revisions: [], messages: [] }),
      policy,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) n FROM project_data_sizes").get() as {
          n: number;
        }
      ).n,
      1,
    );
    assert.throws(
      () =>
        admitProjectData(
          db,
          "new",
          "owner",
          { bytes: 5 * 1024 ** 3, versions: 1, messages: 1 },
          projectStoragePolicy(),
        ),
      ProjectStorageLimit,
    );
  } finally {
    db.close();
  }
});
