import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  readRetiredJob,
  retiredJobManifest,
  type RetiredJobManifest,
} from "./job-history-references";
import { admitJobHistoryRetirement } from "./job-history-store";
import {
  maximumJobDocumentBytes,
  maximumJobTimelineBytes,
  JobHistoryUnavailable,
  JobHistoryConflict,
  JobHistoryBusy,
  type JobHistoryPolicy,
} from "./job-history-policy";
export type JobHistoryRetirement = {
  jobId: string;
  projectId: string;
  digest: string;
  retiredAt: string;
  sourceFiles: number;
};
export type JobHistoryPreview = {
  jobId: string;
  projectId: string;
  digest: string;
  detailsBytes: number;
  retainedBytes: number;
  reclaimedBytes: number;
  sourceFiles: number;
};
const receipt = (value: RetiredJobManifest): JobHistoryRetirement => ({
  jobId: value.jobId,
  projectId: value.projectId,
  digest: value.digest,
  retiredAt: value.retiredAt,
  sourceFiles: value.sourceIds.length,
});
function owns(db: Database.Database, id: string, workspaceId: string) {
  return !!db
    .prepare(
      "SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=p.id)",
    )
    .get(id, workspaceId);
}
function candidate(db: Database.Database, id: string, workspaceId: string) {
  const row = db
    .prepare(
      `SELECT j.project_id AS projectId,j.status,
    CASE WHEN length(CAST(j.data AS BLOB))<=${maximumJobDocumentBytes} THEN j.data END AS data,
    CASE WHEN length(CAST(j.timeline AS BLOB))<=${maximumJobTimelineBytes} THEN j.timeline END AS timeline,
    s.bytes,s.reservation_bytes,
    e.retained_bytes,e.retained_files,e.reservation_bytes AS output_reservation,e.dirty,
    EXISTS(SELECT 1 FROM render_job_attempts WHERE job_id=j.id) AS processing,
    EXISTS(SELECT 1 FROM export_file_removals WHERE job_id=j.id AND state<>'completed') AS removing,
    COALESCE((SELECT sum(length(CAST(project_id AS BLOB))+length(CAST(request_key AS BLOB))+length(CAST(job_id AS BLOB))+length(CAST(request_version AS BLOB))) FROM export_requests WHERE job_id=j.id),0) AS receiptBytes
    FROM jobs j JOIN projects p ON p.id=j.project_id JOIN job_history_sizes s ON s.job_id=j.id AND s.project_id=j.project_id AND s.workspace_id IS p.workspace_id
    JOIN export_storage_entries e ON e.job_id=j.id AND e.project_id=j.project_id AND e.workspace_id IS p.workspace_id WHERE j.id=? AND p.workspace_id=?`,
    )
    .get(id, workspaceId) as
    | {
        projectId: string;
        status: string;
        data: string | null;
        timeline: string | null;
        bytes: number;
        reservation_bytes: number;
        retained_bytes: number;
        retained_files: number;
        output_reservation: number;
        dirty: number;
        processing: number;
        removing: number;
        receiptBytes: number;
      }
    | undefined;
  if (!row || row.data === null || row.timeline === null)
    throw new JobHistoryUnavailable();
  if (
    !["completed", "failed", "cancelled"].includes(row.status) ||
    row.reservation_bytes ||
    row.retained_bytes ||
    row.retained_files ||
    row.output_reservation ||
    row.dirty ||
    row.processing ||
    row.removing
  )
    throw new JobHistoryBusy();
  if (
    Buffer.byteLength(row.data) +
      Buffer.byteLength(row.timeline) +
      row.receiptBytes !==
    row.bytes
  )
    throw new JobHistoryUnavailable();
  const indexed = db
    .prepare(
      "SELECT asset_id FROM job_media_refs WHERE job_id=? ORDER BY asset_id LIMIT 1025",
    )
    .all(id) as { asset_id: string }[];
  const sources = indexed.map((value) => value.asset_id);
  if (
    sources.length > 1024 ||
    sources.some((value) => !z.uuid().safeParse(value).success)
  )
    throw new JobHistoryUnavailable();
  let document: Record<string, unknown>;
  try {
    document = JSON.parse(row.data);
    JSON.parse(row.timeline);
    if (!document || typeof document !== "object" || Array.isArray(document))
      throw new JobHistoryUnavailable();
    const actual = db
      .prepare(
        "SELECT DISTINCT value AS id FROM json_tree(?) WHERE key='assetId' AND type='text' ORDER BY value LIMIT 1025",
      )
      .all(row.timeline) as { id: string }[];
    if (
      actual.length !== sources.length ||
      actual.some((value, index) => value.id !== sources[index])
    )
      throw new JobHistoryUnavailable();
  } catch {
    throw new JobHistoryUnavailable();
  }
  const hash = createHash("sha256");
  for (const value of [
    "reelchemy-retire-export-v1",
    id,
    row.projectId,
    workspaceId,
    row.status,
    row.data,
    row.timeline,
    ...sources,
  ]) {
    const bytes = Buffer.from(value);
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  const retiredAt = new Date().toISOString(),
    digest = hash.digest("hex"),
    manifest = retiredJobManifest.parse({
      format: "reelchemy-retired-export-v1",
      jobId: id,
      projectId: row.projectId,
      workspaceId,
      retiredAt,
      digest,
      sourceIds: sources,
    });
  const date = z.iso.datetime({ offset: true }).safeParse(document.createdAt),
    shell = JSON.stringify({
      id,
      projectId: row.projectId,
      status: row.status,
      progress: row.status === "completed" ? 1 : 0,
      error: null,
      createdAt: date.success ? new Date(date.data).toISOString() : retiredAt,
      issues: [],
      report: null,
      attempts: 0,
      retryCount: 0,
      stage: "Details retired",
      events: [],
      retired: true,
    });
  const manifestData = JSON.stringify(manifest),
    after =
      2 * Buffer.byteLength(shell) +
      4 +
      row.receiptBytes +
      Buffer.byteLength(manifestData);
  return {
    manifest,
    shell,
    manifestData,
    preview: {
      jobId: id,
      projectId: row.projectId,
      digest,
      detailsBytes: row.bytes,
      retainedBytes: after,
      reclaimedBytes: Math.max(0, row.bytes - after),
      sourceFiles: sources.length,
    } satisfies JobHistoryPreview,
  };
}
export function previewJobHistoryRetirement(
  db: Database.Database,
  id: string,
  workspaceId: string,
  policy: JobHistoryPolicy,
) {
  return db
    .transaction(() => {
      if (!owns(db, id, workspaceId)) return;
      const previous = readRetiredJob(db, id);
      if (previous) return { retirement: receipt(previous) };
      const current = candidate(db, id, workspaceId);
      admitJobHistoryRetirement(
        db,
        workspaceId,
        current.preview.detailsBytes,
        current.preview.retainedBytes,
        policy,
      );
      return { preview: current.preview };
    })
    .deferred();
}
export function applyJobHistoryRetirement(
  db: Database.Database,
  id: string,
  workspaceId: string,
  digest: string,
  policy: JobHistoryPolicy,
) {
  return db
    .transaction(() => {
      if (!owns(db, id, workspaceId)) return;
      const previous = readRetiredJob(db, id);
      if (previous) {
        if (previous.digest !== digest) throw new JobHistoryConflict();
        return receipt(previous);
      }
      const current = candidate(db, id, workspaceId);
      if (current.manifest.digest !== digest) throw new JobHistoryConflict();
      admitJobHistoryRetirement(
        db,
        workspaceId,
        current.preview.detailsBytes,
        current.preview.retainedBytes,
        policy,
      );
      db.prepare(
        "INSERT INTO job_history_retirements(job_id,project_id,workspace_id,manifest,retired_data) VALUES(?,?,?,?,?)",
      ).run(
        id,
        current.manifest.projectId,
        workspaceId,
        current.manifestData,
        current.shell,
      );
      db.prepare("UPDATE jobs SET data=?,timeline='null' WHERE id=?").run(
        current.shell,
        id,
      );
      const stored = readRetiredJob(db, id);
      if (!stored) throw new JobHistoryUnavailable();
      return receipt(stored);
    })
    .immediate();
}
export function downloadJobHistory(
  db: Database.Database,
  id: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!owns(db, id, workspaceId)) return;
      const row = db
        .prepare(
          `SELECT project_id AS projectId,CASE WHEN length(CAST(data AS BLOB))<=${maximumJobDocumentBytes} THEN data END AS data,CASE WHEN length(CAST(timeline AS BLOB))<=${maximumJobTimelineBytes} THEN timeline END AS timeline FROM jobs WHERE id=?`,
        )
        .get(id) as
        | { projectId: string; data: string | null; timeline: string | null }
        | undefined;
      if (!row || row.data === null || row.timeline === null)
        throw new JobHistoryUnavailable();
      try {
        JSON.parse(row.data);
        JSON.parse(row.timeline);
      } catch {
        throw new JobHistoryUnavailable();
      }
      return `{"format":"reelchemy-export-activity-v1","jobId":${JSON.stringify(id)},"projectId":${JSON.stringify(row.projectId)},"details":${row.data},"timeline":${row.timeline}}`;
    })
    .deferred();
}
