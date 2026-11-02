import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  previewProjectRetention,
  applyProjectRetention,
  ProjectRetentionConflict,
  ProjectRetentionUnavailable,
} from "../src/lib/project-retention";
import {
  storageFixture,
  writeProject,
  projectDocument,
} from "./project-storage-fixture";
const selection = { keepVersions: 2, keepMessages: 3 };
test("cleanup preview is read-only and explicit apply retains exact latest snapshots, film, owned media, provenance, other data and immutable jobs", () => {
  const db = storageFixture(),
    original = projectDocument(),
    data = JSON.stringify(original);
  try {
    writeProject(db, "p", "owner", data);
    writeProject(db, "other", "owner", data);
    db.prepare("INSERT INTO jobs VALUES('immutable',?,?)").run(
      "Preserve export report",
      JSON.stringify(original.revisions[0].timeline),
    );
    const changes = () =>
      (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const before = changes(),
      plan = previewProjectRetention(db, "p", "owner", selection)!;
    assert.equal(changes(), before);
    assert.equal(plan.versionsAfter, 2);
    assert.equal(plan.messagesAfter, 3);
    assert.equal(plan.latestRevisionId, "version-4");
    assert(plan.bytesAfter < plan.bytesBefore);
    const result = applyProjectRetention(
      db,
      "p",
      "owner",
      selection,
      plan.digest,
      randomUUID(),
    )!;
    assert.equal(result.versionsRemoved, 3);
    assert.equal(result.messagesRemoved, 5);
    const current = JSON.parse(
      (
        db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
          data: string;
        }
      ).data,
    );
    assert.deepEqual(current, {
      ...original,
      revisions: original.revisions.slice(-2),
      messages: original.messages.slice(-3),
    });
    assert.equal(
      (
        db.prepare("SELECT data FROM projects WHERE id='other'").get() as {
          data: string;
        }
      ).data,
      data,
    );
    assert.equal(
      (
        db.prepare("SELECT data FROM jobs WHERE id='immutable'").get() as {
          data: string;
        }
      ).data,
      "Preserve export report",
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT versions FROM project_data_sizes WHERE project_id='p'",
          )
          .get() as { versions: number }
      ).versions,
      2,
    );
  } finally {
    db.close();
  }
});
test("preview binds exact retained counts and all project data; intervening saves, assets, directions or names prevent a stale cleanup", () => {
  const db = storageFixture();
  try {
    for (const patch of [
      { name: "Renamed" },
      { assets: [] },
      { messages: [] },
      { revisions: projectDocument(6).revisions },
    ]) {
      const original = projectDocument();
      writeProject(db, "p", "owner", JSON.stringify(original));
      const plan = previewProjectRetention(db, "p", "owner", selection)!;
      assert.throws(
        () =>
          applyProjectRetention(
            db,
            "p",
            "owner",
            { ...selection, keepVersions: 1 },
            plan.digest,
            randomUUID(),
          ),
        ProjectRetentionConflict,
      );
      const data = JSON.stringify({ ...original, ...patch });
      db.prepare("UPDATE projects SET data=? WHERE id='p'").run(data);
      assert.throws(
        () =>
          applyProjectRetention(
            db,
            "p",
            "owner",
            selection,
            plan.digest,
            randomUUID(),
          ),
        ProjectRetentionConflict,
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
  } finally {
    db.close();
  }
});
test("ownership, Trash and pending deletion are checked again at apply, including before replaying a receipt", () => {
  const db = storageFixture();
  try {
    writeProject(db, "p", "owner", JSON.stringify(projectDocument()));
    const plan = previewProjectRetention(db, "p", "owner", selection)!,
      id = randomUUID();
    assert.equal(
      previewProjectRetention(db, "p", "foreign", selection),
      undefined,
    );
    assert.equal(
      applyProjectRetention(db, "p", "foreign", selection, plan.digest, id),
      undefined,
    );
    db.exec("UPDATE projects SET trashed_at='private-time' WHERE id='p'");
    assert.equal(
      applyProjectRetention(db, "p", "owner", selection, plan.digest, id),
      undefined,
    );
    db.exec(
      "UPDATE projects SET trashed_at=NULL; INSERT INTO project_deletions VALUES('p')",
    );
    assert.equal(
      applyProjectRetention(db, "p", "owner", selection, plan.digest, id),
      undefined,
    );
    db.exec("DELETE FROM project_deletions");
    applyProjectRetention(db, "p", "owner", selection, plan.digest, id);
    db.exec("UPDATE projects SET workspace_id='foreign' WHERE id='p'");
    assert.equal(
      applyProjectRetention(db, "p", "owner", selection, plan.digest, id),
      undefined,
    );
  } finally {
    db.close();
  }
});
test("an uncertain apply replays one bounded receipt after later edits without deleting newer history or exposing a new CAS base", () => {
  const db = storageFixture();
  try {
    writeProject(db, "p", "owner", JSON.stringify(projectDocument()));
    const plan = previewProjectRetention(db, "p", "owner", selection)!,
      id = randomUUID();
    const first = applyProjectRetention(
      db,
      "p",
      "owner",
      selection,
      plan.digest,
      id,
    )!;
    const later = JSON.stringify(projectDocument(7, 9));
    writeProject(db, "p", "owner", later);
    const replay = applyProjectRetention(
      db,
      "p",
      "owner",
      selection,
      plan.digest,
      id,
    )!;
    assert.deepEqual(replay, { ...first, replayed: true });
    assert.equal("latestRevisionId" in replay, false);
    assert.equal(
      (
        db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
          data: string;
        }
      ).data,
      later,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM project_retention_receipts")
          .get() as { n: number }
      ).n,
      1,
    );
    assert.throws(
      () =>
        applyProjectRetention(
          db,
          "p",
          "owner",
          { ...selection, keepMessages: 1 },
          plan.digest,
          id,
        ),
      ProjectRetentionConflict,
    );
    db.exec("DELETE FROM projects WHERE id='p'");
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM project_retention_receipts")
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("a no-op preserves byte-identical legacy formatting and invalid history cannot be cleaned or echoed", () => {
  const db = storageFixture();
  try {
    const data = JSON.stringify(projectDocument(1, 1), null, 2);
    writeProject(db, "p", "owner", data);
    const plan = previewProjectRetention(db, "p", "owner", selection)!;
    assert.equal(plan.bytesBefore, plan.bytesAfter);
    assert.equal(
      applyProjectRetention(
        db,
        "p",
        "owner",
        selection,
        plan.digest,
        randomUUID(),
      )!.bytesFreed,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
          data: string;
        }
      ).data,
      data,
    );
    db.prepare("UPDATE projects SET data=? WHERE id='p'").run(
      JSON.stringify({ ...projectDocument(), revisions: [{ id: "" }] }),
    );
    assert.throws(
      () => previewProjectRetention(db, "p", "owner", selection),
      ProjectRetentionUnavailable,
    );
    assert.throws(() =>
      previewProjectRetention(db, "p", "owner", {
        keepVersions: 0,
        keepMessages: 1,
      }),
    );
  } finally {
    db.close();
  }
});
test("a corrupt cleanup receipt cannot return stored private fields or perform a second removal", () => {
  const db = storageFixture();
  try {
    writeProject(db, "p", "owner", JSON.stringify(projectDocument()));
    const plan = previewProjectRetention(db, "p", "owner", selection)!,
      id = randomUUID();
    applyProjectRetention(db, "p", "owner", selection, plan.digest, id);
    const before = (
      db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
        data: string;
      }
    ).data;
    db.prepare(
      "UPDATE project_retention_receipts SET result=? WHERE project_id='p'",
    ).run(JSON.stringify({ PRIVATE_UNKNOWN_FIELD: "Private receipt canary" }));
    assert.throws(
      () => applyProjectRetention(db, "p", "owner", selection, plan.digest, id),
      (error: unknown) =>
        error instanceof ProjectRetentionUnavailable &&
        !error.message.includes("Private receipt canary"),
    );
    assert.equal(
      (
        db.prepare("SELECT data FROM projects WHERE id='p'").get() as {
          data: string;
        }
      ).data,
      before,
    );
  } finally {
    db.close();
  }
});
