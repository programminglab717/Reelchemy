import { timelineSchema, totalFrames } from "./schema";
import {
  migrateRenderQueue,
  assignRenderQueueKey,
  renderQueueOrder,
  renderQueueAhead,
} from "./render-queue";
import { enableSecureDeletion } from "./sqlite-private";
import Database from "better-sqlite3";
import { assertRestoreComplete } from "./restore-state";
import { mkdirSync, lstatSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  migrateExportFileRemovals,
  getExportFileRemoval,
  assertExportFileSource,
  requestExportFileRemoval,
  acquireExportFileReview,
  releaseExportFileReview,
  claimExportFileRemoval,
  finishExportFileRemoval,
  failExportFileRemoval,
  recoverExportFileRemovals,
  type ExportFileTask,
} from "./export-file-store";
import type { ExportFileManifest } from "./export-file-policy";
import {
  migrateExportStorage,
  reserveExportStorage,
  exportStorageUsage,
  assertExportStorageComplete,
  exportOutputCeiling,
  settleExportStorage,
  markExportStorageUncertain,
  releaseKnownTerminalHolds,
} from "./export-storage-store";
import {
  exportStoragePolicy,
  ExportStorageUnavailable,
} from "./export-storage-policy";
import { ownedExportPage } from "./export-history";
import { boundedProjectLabelSql } from "./project-label";
import {
  migrateJobHistoryStorage,
  reserveJobHistory,
  jobHistoryUsage,
} from "./job-history-store";
import {
  jobHistoryPolicy,
  maximumJobDocumentBytes,
  maximumJobTimelineBytes,
  JobHistoryUnavailable,
} from "./job-history-policy";
import { readRetiredJob } from "./job-history-references";
import { ownedJobHistoryPage } from "./job-history-page";
import {
  previewJobHistoryRetirement,
  applyJobHistoryRetirement,
  downloadJobHistory,
} from "./job-history-retention";
import { retainedExportPage } from "./retained-exports";
import type {
  Asset,
  Project,
  ProjectSummary,
  ActiveStudioExport,
  RenderJob,
  Timeline,
  CreativeBrief,
} from "./schema";
import { revisionId, RevisionConflict } from "./editor";
import { inspectTimeline } from "./qc";
import {
  ExportRequestConflict,
  ExportCapacityError,
  activeExportLimit,
} from "./export-policy";
import { validateProjectAssets, validAssetId } from "./project-assets";
import {
  migrateMediaReferences,
  rebuildMediaReferences,
} from "./media-references";
import {
  migrateProjectDeletions,
  requestProjectDeletion as requestDeletion,
  getProjectDeletion as deletionForOwner,
  listProjectDeletions as deletionsForOwner,
  claimProjectDeletion as claimDeletion,
  reserveDeletionMedia,
  finishProjectDeletion as completeDeletion,
  failProjectDeletion as failedDeletion,
  type DeletionTask,
} from "./project-deletion-store";
import { ProjectDeletionConflict } from "./project-deletion-policy";
import {
  listLibraryMedia,
  libraryAssetSchema,
  type LibraryQuery,
} from "./media-library";
export type { ProjectDeletion, DeletionTask } from "./project-deletion-store";
import {
  mediaStorageLimit,
  MediaStorageLimitError,
  sharedMediaStorageLimit,
  validatedSharedMediaBytes,
} from "./media-storage-policy";
import { MediaProcessingStore } from "./media-processing-store";
import { MediaInputFiles } from "./media-input-files";
import { withPrivateDirectory } from "./private-directory";
import { removeCachedWaveform } from "./waveform-cache";
import { ownedMediaCatalogue } from "./media-catalogue";
import { ownedEditorProject, ownedConversationPage } from "./editor-project";
import { ProviderUsageStore } from "./provider-usage-store";
import {
  migrateAccountErasures,
  beginStudioErasure,
  pendingStudioErasures,
  blockStudioErasure,
} from "./account-erasure-store";
import { detachErasedProviderUsage } from "./account-erasure-provider";
import type { PrivacyVault } from "./privacy-vault";
import { AccountErasureUnavailable } from "./account-erasure-policy";
import {
  resolveErasureOwner,
  scheduleErasedProjects,
  finishErasedStudio,
  type CleanupContext,
} from "./account-erasure-cleanup-store";
import {
  migrateProjectStorage,
  admitProjectData,
  projectDataUsage,
} from "./project-storage";
import { projectStoragePolicy } from "./project-storage-policy";
import {
  previewProjectRetention,
  applyProjectRetention,
  type RetentionSelection,
} from "./project-retention";
import {
  ownedVersionPage,
  ownedVersionSnapshot,
  SavedVersionUnavailable,
} from "./project-history";
import {
  mediaProcessingPolicy,
  MediaAnalysisLimit,
  MediaProcessingUnavailable,
} from "./media-processing-policy";
// Runtime state lives on the mounted filesystem; do not embed it in server traces.
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.REELCHEMY_DATA_DIR || ".data",
);
export const artifactDir = path.resolve(
  /* turbopackIgnore: true */ process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
);
assertRestoreComplete(dataDir);
mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "studio.sqlite"));
db.pragma("journal_mode = WAL");
enableSecureDeletion(db);
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL);`,
);
// Additive migration: legacy content is retained but has no public owner until claimed offline.
db.exec(
  "CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL)",
);
// Serialize additive column migrations across web/worker startup.
db.transaction(() => {
  db.exec(
    "CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status); CREATE INDEX IF NOT EXISTS jobs_project_idx ON jobs(project_id)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS request_limits(workspace_id TEXT NOT NULL,operation TEXT NOT NULL,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(workspace_id,operation))",
  );
  if (
    !(db.pragma("table_info(projects)") as { name: string }[]).some(
      (c) => c.name === "workspace_id",
    )
  )
    db.exec("ALTER TABLE projects ADD COLUMN workspace_id TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)",
  );
  if (
    !(db.pragma("table_info(projects)") as { name: string }[]).some(
      (c) => c.name === "trashed_at",
    )
  )
    db.exec("ALTER TABLE projects ADD COLUMN trashed_at TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS projects_trash_idx ON projects(workspace_id,trashed_at)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS media_sizes(asset_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0)); CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS export_requests(project_id TEXT NOT NULL,request_key TEXT NOT NULL,job_id TEXT NOT NULL,request_version TEXT NOT NULL,PRIMARY KEY(project_id,request_key))",
  );
  migrateMediaReferences(db);
  migrateProjectDeletions(db);
  migrateExportFileRemovals(db);
  migrateRenderQueue(db);
  migrateExportStorage(db);
  migrateJobHistoryStorage(db);
  if (
    !db
      .prepare("SELECT id FROM schema_migrations WHERE id=?")
      .get("retained-media-size-census-v2")
  ) {
    rebuildMediaSizeIndex();
  }
  migrateProjectStorage(db);
}).immediate();
export const mediaProcessing = new MediaProcessingStore(db);
export const providerUsage = new ProviderUsageStore(db);
migrateAccountErasures(db);
export const accountErasures = {
  resolve(vault: PrivacyVault, requestId: string, workspaceId: string) {
    return resolveErasureOwner(db, vault, requestId, workspaceId);
  },
  schedule(vault: PrivacyVault, input: CleanupContext, limit = 5) {
    return scheduleErasedProjects(db, vault, input, limit);
  },
  finish(vault: PrivacyVault, input: CleanupContext) {
    return finishErasedStudio(db, vault, input);
  },
  begin(
    vault: PrivacyVault,
    input: { requestId: string; ownerId: string; workspaceId: string },
  ) {
    return beginStudioErasure(db, vault, input);
  },
  pending(limit = 10) {
    return pendingStudioErasures(db, limit);
  },
  block(workspaceId: string) {
    return blockStudioErasure(db, workspaceId);
  },
  detachProvider(
    vault: PrivacyVault,
    input: { requestId: string; ownerId: string; workspaceId: string },
  ) {
    return detachErasedProviderUsage(db, vault, input);
  },
};
export const mediaInputs = new MediaInputFiles(dataDir);
export function cleanupUnreferencedMediaOutputs(ids: string[]) {
  return db
    .transaction(() =>
      withPrivateDirectory(dataDir, "assets", (anchor) => {
        for (const id of ids) {
          if (!validAssetId(id)) throw new Error("Invalid media output.");
          if (
            db
              .prepare(
                "SELECT 1 FROM project_media_refs WHERE asset_id=? UNION ALL SELECT 1 FROM job_media_refs WHERE asset_id=? LIMIT 1",
              )
              .get(id, id)
          )
            continue;
          const file = path.join(anchor, id);
          try {
            const stat = lstatSync(file);
            if (!stat.isFile() && !stat.isSymbolicLink())
              throw new Error("Unexpected media output type.");
            unlinkSync(file);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          removeCachedWaveform(id);
        }
      }),
    )
    .immediate();
}
export function cleanupMediaRequest(id: string) {
  return mediaProcessing.cleanup(id, (outputs) => {
    cleanupUnreferencedMediaOutputs(outputs);
    mediaInputs.remove(id);
  });
}
export function requestOwnedWaveform(
  projectId: string,
  workspaceId: string,
  assetId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const asset = getProject(projectId)?.assets?.find(
        (asset) => asset.id === assetId,
      );
      if (
        !asset ||
        (asset.mime !== "audio/wav" &&
          !(asset.mime === "video/mp4" && asset.hasAudio))
      )
        return undefined;
      const existing = mediaProcessing.waveform(
        workspaceId,
        projectId,
        assetId,
      );
      if (
        existing &&
        (!["failed", "cancelled", "completed"].includes(existing.state) ||
          (["failed", "cancelled"].includes(existing.state) &&
            Date.now() - Date.parse(existing.createdAt) < 300000))
      )
        return existing;
      const quota = takeRequestLimit(
        workspaceId,
        "waveform",
        mediaProcessingPolicy().analysesPerHour,
        3600000,
      );
      if (!quota.allowed) throw new MediaAnalysisLimit(quota.retryAfter);
      const reserved = mediaProcessing.reserve({
        workspaceId,
        projectId,
        operation: "waveform",
        requestKey: randomUUID(),
      });
      if (!reserved.created) throw new Error("Waveform request unavailable.");
      return mediaProcessing.enqueue(reserved.receipt.id, reserved.token, {
        operation: "waveform",
        assetId,
      });
    })
    .immediate();
}
function rebuildMediaSizeIndex() {
  const rows = db
    .prepare(
      "SELECT asset_id AS id FROM project_media_refs UNION SELECT asset_id AS id FROM job_media_refs UNION SELECT asset_id AS id FROM media_deletion_targets UNION SELECT asset_id AS id FROM media_sizes",
    )
    .all() as { id: string }[];
  db.exec("DELETE FROM media_sizes");
  let totalBytes = 0,
    assetCount = 0;
  for (const { id } of rows) {
    if (typeof id !== "string" || !validAssetId(id)) continue;
    const bytes = measuredMediaBytes(id);
    db.prepare(
      "INSERT OR IGNORE INTO media_sizes(asset_id,bytes) VALUES (?,?)",
    ).run(id, bytes);
    totalBytes += bytes;
    assetCount++;
  }
  db.prepare(
    "INSERT INTO schema_migrations(id,applied_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET applied_at=excluded.applied_at",
  ).run("media-size-census-v1", new Date().toISOString());
  db.prepare(
    "INSERT INTO schema_migrations(id,applied_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET applied_at=excluded.applied_at",
  ).run("retained-media-size-census-v2", new Date().toISOString());
  return { assetCount, totalBytes };
}
export function recountMediaStorage() {
  return db
    .transaction(() => {
      if (
        db.prepare("SELECT asset_id FROM media_deletion_targets LIMIT 1").get()
      )
        throw new ProjectDeletionConflict(
          "Finish pending project cleanup before recounting media.",
        );
      rebuildMediaReferences(db);
      return rebuildMediaSizeIndex();
    })
    .immediate();
}
function measuredMediaBytes(id: string) {
  try {
    const file = lstatSync(path.join(dataDir, "assets", id));
    return file.isFile() ? file.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
function ownedMediaSizes(workspaceId: string) {
  const query = () =>
    (
      db
        .prepare(
          "SELECT DISTINCT r.asset_id AS id,s.bytes FROM (SELECT p.id AS project_id,r.asset_id FROM project_media_refs r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? UNION SELECT j.project_id,r.asset_id FROM job_media_refs r JOIN jobs j ON j.id=r.job_id JOIN projects p ON p.id=j.project_id WHERE p.workspace_id=?) r LEFT JOIN media_sizes s ON s.asset_id=r.asset_id",
        )
        .all(workspaceId, workspaceId) as {
        id: string | null;
        bytes: number | null;
      }[]
    ).filter(
      (row): row is { id: string; bytes: number | null } =>
        typeof row.id === "string" && validAssetId(row.id),
    );
  const found = query();
  // Backfill newly referenced files from old snapshots/admin tools. Established
  // studios keep a read-only path, and admissions hold the same writer lock.
  if (found.some((row) => row.bytes === null))
    return db
      .transaction(() => {
        for (const row of query())
          if (row.bytes === null)
            db.prepare(
              "INSERT OR IGNORE INTO media_sizes(asset_id,bytes) VALUES (?,?)",
            ).run(row.id, measuredMediaBytes(row.id));
        return query().map((row) => ({ id: row.id, bytes: row.bytes || 0 }));
      })
      .immediate();
  return found.map((row) => ({ id: row.id, bytes: row.bytes || 0 }));
}
export function mediaStorage(workspaceId: string) {
  const owned = ownedMediaSizes(workspaceId);
  const usedBytes = owned.reduce((sum, asset) => sum + asset.bytes, 0);
  const limitBytes = mediaStorageLimit();
  return {
    usedBytes,
    limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    assetCount: owned.length,
  };
}
function sizedMedia(assets: readonly Asset[]) {
  return assets.map((asset) => {
    if (!validAssetId(asset.id)) throw new Error("Invalid media asset.");
    const bytes = measuredMediaBytes(asset.id);
    if (bytes < 1) throw new Error("Normalized media is missing or invalid.");
    return { ...asset, bytes };
  });
}
function checkMediaStorage(
  workspaceId: string,
  assets: readonly (Asset & { bytes: number })[],
  admittedLimitBytes?: number,
  admittedSharedBytes?: number,
) {
  const owned = ownedMediaSizes(workspaceId),
    known = new Map(owned.map((asset) => [asset.id, asset.bytes]));
  const usedBytes = owned.reduce((sum, asset) => sum + asset.bytes, 0);
  const added = new Map(assets.map((asset) => [asset.id, asset.bytes]));
  for (const id of added.keys())
    if (
      !known.has(id) &&
      db.prepare("SELECT asset_id FROM media_sizes WHERE asset_id=?").get(id)
    )
      throw new Error("Invalid media reference.");
  const requiredBytes = Math.max(
    0,
    [...added].reduce(
      (sum, [id, bytes]) => sum + bytes - (known.get(id) || 0),
      0,
    ),
  );
  const limitBytes = Math.min(
    mediaStorageLimit(),
    admittedLimitBytes === undefined
      ? Infinity
      : mediaStorageLimit({
          REELCHEMY_MEDIA_STORAGE_BYTES: String(admittedLimitBytes),
        }),
  );
  if (requiredBytes > 0 && usedBytes + requiredBytes > limitBytes)
    throw new MediaStorageLimitError(usedBytes, limitBytes, requiredBytes);
  const sharedGrowth = Math.max(
    0,
    [...added].reduce(
      (sum, [id, bytes]) =>
        sum +
        bytes -
        ((
          db
            .prepare("SELECT bytes FROM media_sizes WHERE asset_id=?")
            .get(id) as { bytes: number } | undefined
        )?.bytes || 0),
      0,
    ),
  );
  assertSharedMediaCapacity(sharedGrowth, admittedSharedBytes);
  for (const [id, bytes] of added)
    db.prepare(
      "INSERT INTO media_sizes(asset_id,bytes) VALUES (?,?) ON CONFLICT(asset_id) DO UPDATE SET bytes=excluded.bytes",
    ).run(id, bytes);
}
export function sharedMediaStorage() {
  const row = db
    .prepare(
      "SELECT COALESCE(sum(bytes),0) AS usedBytes,count(*) AS assetCount FROM media_sizes",
    )
    .get() as { usedBytes: number; assetCount: number };
  return { ...row, limitBytes: sharedMediaStorageLimit() };
}
export function assertSharedMediaCapacity(
  requiredBytes = 1,
  admittedSharedBytes?: number,
) {
  const usage = sharedMediaStorage();
  const limitBytes = Math.min(
    usage.limitBytes,
    admittedSharedBytes === undefined
      ? Infinity
      : validatedSharedMediaBytes(admittedSharedBytes),
  );
  if (requiredBytes > 0 && usage.usedBytes + requiredBytes > limitBytes)
    throw new MediaStorageLimitError(
      usage.usedBytes,
      limitBytes,
      requiredBytes,
      "service",
    );
}
export function assertUploadProjectCapacity(
  projectId: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId))
        throw new MediaProcessingUnavailable();
      const row = db
        .prepare(
          "SELECT bytes,versions,messages FROM project_data_sizes WHERE project_id=?",
        )
        .get(projectId) as
        { bytes: number; versions: number; messages: number } | undefined;
      if (!row) throw new MediaProcessingUnavailable();
      admitProjectData(db, projectId, workspaceId, {
        ...row,
        bytes: row.bytes + 1,
      });
    })
    .immediate();
}
export function assertImportProjectCapacity(workspaceId: string) {
  return db
    .transaction(() =>
      admitProjectData(db, randomUUID(), workspaceId, {
        bytes: 1,
        versions: 0,
        messages: 0,
      }),
    )
    .immediate();
}
export function appendOwnedAsset(
  projectId: string,
  workspaceId: string,
  asset: Asset,
  admittedLimitBytes?: number,
  admittedSharedBytes?: number,
) {
  const [normalized] = sizedMedia([asset]);
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const latest = getProject(projectId)!;
      if (latest.assets?.some((existing) => existing.id === normalized.id))
        return latest;
      if ((latest.assets || []).length >= 30)
        throw new Error("Project limit is 30 assets.");
      checkMediaStorage(
        workspaceId,
        [normalized],
        admittedLimitBytes,
        admittedSharedBytes,
      );
      latest.assets = [...(latest.assets || []), normalized];
      return saveProject(latest);
    })
    .immediate();
}
export function saveImportedProject(
  project: Project,
  workspaceId: string,
  admittedLimitBytes?: number,
  admittedSharedBytes?: number,
) {
  const assets = sizedMedia(project.assets || []);
  return db
    .transaction(() => {
      if (getProject(project.id))
        throw new Error("Imported project already exists.");
      checkMediaStorage(
        workspaceId,
        assets,
        admittedLimitBytes,
        admittedSharedBytes,
      );
      return saveProject({ ...project, assets }, workspaceId);
    })
    .immediate();
}
export function mediaLibrary(workspaceId: string, options: LibraryQuery) {
  return db
    .transaction(() => listLibraryMedia(db, workspaceId, options))
    .deferred();
}
export function projectMediaCatalogue(projectId: string, workspaceId: string) {
  return db
    .transaction(() => ownedMediaCatalogue(db, projectId, workspaceId))
    .deferred();
}
export function editorProject(projectId: string, workspaceId: string) {
  return db
    .transaction(() => ownedEditorProject(db, projectId, workspaceId))
    .deferred();
}
export function projectConversationPage(
  projectId: string,
  workspaceId: string,
  before?: number,
) {
  return db
    .transaction(() =>
      ownedConversationPage(db, projectId, workspaceId, before),
    )
    .deferred();
}
export function projectVersionPage(
  projectId: string,
  workspaceId: string,
  offset: number,
) {
  return db
    .transaction(() => ownedVersionPage(db, projectId, workspaceId, offset))
    .deferred();
}
export function projectVersionSnapshot(
  projectId: string,
  workspaceId: string,
  revisionId: string,
) {
  return db
    .transaction(() =>
      ownedVersionSnapshot(db, projectId, workspaceId, revisionId),
    )
    .deferred();
}
export function reuseOwnedMedia(
  projectId: string,
  sourceProjectId: string,
  assetId: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      // The selected source may have changed since the library loaded or while
      // the request body streamed. Check both owners/activity in this same writer
      // transaction, then retain the shared ID before cleanup can reserve it.
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const latest = getProject(projectId)!;
      // A lost response can be replayed after its original source was removed.
      // This returns only media already owned by the target; it says nothing
      // about whether the supplied source ID exists or belongs to anyone.
      if (latest.assets?.some((asset) => asset.id === assetId)) return latest;
      if (!projectInWorkspace(sourceProjectId, workspaceId)) return undefined;
      const row = db
        .prepare(
          "SELECT a.value AS asset FROM projects p,json_each(p.data,'$.assets') a WHERE p.id=? AND json_extract(CASE WHEN a.type='object' THEN a.value ELSE '{}' END,'$.id')=? LIMIT 1",
        )
        .get(sourceProjectId, assetId) as { asset: string } | undefined;
      if (!row) return undefined;
      const parsed = libraryAssetSchema.safeParse(JSON.parse(row.asset));
      if (!parsed.success) return undefined;
      return appendOwnedAsset(projectId, workspaceId, parsed.data);
    })
    .immediate();
}
export function takeRequestLimit(
  workspaceId: string,
  operation: string,
  count: number,
  windowMs: number,
  now = Date.now(),
) {
  return db
    .transaction(() => {
      const row = db
        .prepare(
          "SELECT hits,expires_at FROM request_limits WHERE workspace_id=? AND operation=?",
        )
        .get(workspaceId, operation) as
        { hits: number; expires_at: number } | undefined;
      if (!row || row.expires_at <= now) {
        db.prepare(
          "INSERT INTO request_limits(workspace_id,operation,hits,expires_at) VALUES (?,?,1,?) ON CONFLICT(workspace_id,operation) DO UPDATE SET hits=1,expires_at=excluded.expires_at",
        ).run(workspaceId, operation, now + windowMs);
        return { allowed: true, retryAfter: 0 };
      }
      if (row.hits >= count)
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
        };
      db.prepare(
        "UPDATE request_limits SET hits=hits+1 WHERE workspace_id=? AND operation=?",
      ).run(workspaceId, operation);
      return { allowed: true, retryAfter: 0 };
    })
    .immediate();
}
export function databaseHealthy() {
  return (db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
}
export type ProjectQuery = {
  query?: string;
  offset?: number;
  limit?: number;
  trashed?: boolean;
};
function projectFilter(
  workspaceId: string | undefined,
  query = "",
  trashed = false,
) {
  const clauses: string[] = [
      trashed ? "trashed_at IS NOT NULL" : "trashed_at IS NULL",
      "NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=projects.id)",
      "NOT EXISTS(SELECT 1 FROM account_erasures e WHERE e.workspace_id=projects.workspace_id)",
    ],
    values: (string | number)[] = [];
  if (workspaceId) {
    clauses.push("workspace_id=?");
    values.push(workspaceId);
  }
  if (query) {
    clauses.push("json_extract(data,'$.name') LIKE ? ESCAPE '\\'");
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}
export function countProjects(
  workspaceId: string,
  query = "",
  trashed = false,
) {
  const filter = projectFilter(workspaceId, query, trashed);
  return (
    db
      .prepare(`SELECT COUNT(*) AS count FROM projects${filter.where}`)
      .get(...filter.values) as { count: number }
  ).count;
}
export function listProjects(
  workspaceId?: string,
  options: ProjectQuery = {},
): Project[] {
  const filter = projectFilter(workspaceId, options.query, options.trashed);
  return (
    db
      .prepare(
        `SELECT data,trashed_at FROM projects${filter.where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...filter.values,
        Math.min(50, Math.max(1, options.limit || 50)),
        Math.max(0, options.offset || 0),
      ) as { data: string; trashed_at: string | null }[]
  ).map((r) => ({
    ...JSON.parse(r.data),
    ...(r.trashed_at ? { trashedAt: r.trashed_at } : {}),
  }));
}
export function getProject(id: string): Project | undefined {
  const row = db.prepare("SELECT data FROM projects WHERE id=?").get(id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
// Listing UIs need metadata only. Extract it in SQLite rather than moving and
// parsing every saved timeline/history/message/asset catalog into JS/browser
// memory on each search or navigation refresh.
export function listProjectSummaries(
  workspaceId: string,
  options: ProjectQuery = {},
): ProjectSummary[] {
  const filter = projectFilter(workspaceId, options.query, options.trashed);
  const rows = db
    .prepare(
      `SELECT id,json_extract(data,'$.name') AS name,json_extract(data,'$.createdAt') AS createdAt,COALESCE(json_array_length(data,'$.revisions'),0) AS revisionCount,trashed_at AS trashedAt FROM projects${filter.where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(
      ...filter.values,
      Math.min(50, Math.max(1, options.limit || 50)),
      Math.max(0, options.offset || 0),
    ) as (Omit<ProjectSummary, "trashedAt"> & { trashedAt: string | null })[];
  return rows.map(({ trashedAt, ...summary }) => ({
    ...summary,
    ...(trashedAt ? { trashedAt } : {}),
  }));
}
export function saveProject(p: Project, workspaceId?: string) {
  return db
    .transaction(() => {
      const data = JSON.stringify(p);
      const owner = db
        .prepare("SELECT workspace_id FROM projects WHERE id=?")
        .get(p.id) as { workspace_id: string | null } | undefined;
      admitProjectData(
        db,
        p.id,
        owner ? owner.workspace_id : workspaceId || null,
        {
          bytes: Buffer.byteLength(data),
          versions: p.revisions.length,
          messages: p.messages.length,
        },
      );
      db.prepare(
        "INSERT INTO projects(id,data,workspace_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      ).run(p.id, data, workspaceId || null);
      return p;
    })
    .immediate();
}
export function studioProjectDataUsage(workspaceId: string) {
  const policy = projectStoragePolicy();
  return {
    ...projectDataUsage(db, workspaceId),
    limitBytes: policy.studioBytes,
    limitProjects: policy.studioProjects,
  };
}
export function ownedProjectDataUsage(projectId: string, workspaceId: string) {
  const row = db
    .prepare(
      "SELECT s.bytes,s.versions,s.messages FROM project_data_sizes s JOIN projects p ON p.id=s.project_id WHERE p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)",
    )
    .get(projectId, workspaceId) as
    { bytes: number; versions: number; messages: number } | undefined;
  if (!row) return undefined;
  const policy = projectStoragePolicy();
  return {
    projectId,
    ...row,
    limitBytes: policy.projectBytes,
    limitVersions: policy.versions,
    limitMessages: policy.messages,
    studio: studioProjectDataUsage(workspaceId),
  };
}
export function ownedPlanningStorageAvailable(
  projectId: string,
  workspaceId: string,
  messagesAdded: 1 | 2,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return false;
      const size = db
        .prepare(
          "SELECT bytes,versions,messages FROM project_data_sizes WHERE project_id=?",
        )
        .get(projectId) as {
        bytes: number;
        versions: number;
        messages: number;
      };
      // Refuse exhausted allowances before a provider is contacted. The exact
      // generated plan is admitted again atomically when its revision is saved.
      admitProjectData(db, projectId, workspaceId, {
        bytes: size.bytes + 1,
        versions: size.versions + 1,
        messages: size.messages + messagesAdded,
      });
      return true;
    })
    .immediate();
}
export function ownedProjectRetention(
  projectId: string,
  workspaceId: string,
  selection: RetentionSelection,
) {
  return previewProjectRetention(db, projectId, workspaceId, selection);
}
export function cleanOwnedProjectHistory(
  projectId: string,
  workspaceId: string,
  selection: RetentionSelection,
  expected: string,
  requestId: string,
) {
  return applyProjectRetention(
    db,
    projectId,
    workspaceId,
    selection,
    expected,
    requestId,
  );
}
export function createProject(brief: CreativeBrief, workspaceId?: string) {
  return saveProject(
    {
      id: randomUUID(),
      name: brief.prompt.slice(0, 65),
      brief,
      timeline: null,
      revisions: [],
      messages: [{ role: "user", content: brief.prompt }],
      createdAt: new Date().toISOString(),
    },
    workspaceId,
  );
}
// Admit the initial film and its first version in the same writer transaction.
// A rejected template/blank film cannot leave an empty project or quota record.
export function createComposedProject(
  brief: CreativeBrief,
  workspaceId: string,
  timeline: Timeline,
  source: string,
) {
  const validated = timelineSchema.parse(timeline);
  return db
    .transaction(() => {
      const project = createProject(brief, workspaceId);
      validateProjectAssets(project, validated);
      return reviseProject(project, validated, source);
    })
    .immediate();
}
export function renameProject(id: string, name: string, baseName: string) {
  return db
    .transaction(() => {
      const p = getProject(id);
      if (!p) throw new Error("Project not found.");
      if (p.name !== baseName) return null;
      p.name = name;
      return saveProject(p);
    })
    .immediate();
}
export function renameOwnedProject(
  id: string,
  name: string,
  baseName: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(id, workspaceId)) return undefined;
      return renameProject(id, name, baseName);
    })
    .immediate();
}
export function reviseProject(p: Project, timeline: Timeline, source: string) {
  return db
    .transaction(() => {
      const latest = getProject(p.id);
      if (!latest || revisionId(latest) !== revisionId(p))
        throw new RevisionConflict();
      p.timeline = timeline;
      p.name = latest.name;
      p.assets = latest.assets;
      p.revisions.push({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        timeline,
        source,
      });
      return saveProject(p);
    })
    .immediate();
}
// The request body may have streamed while another process trashed/deleted
// the project or changed ownership/media. Bind selection and the forward save
// to the same immediate writer transaction used by ordinary editor commits.
export function restoreOwnedProject(
  projectId: string,
  selectedId: string,
  baseRevisionId: string | null,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const current = getProject(projectId)!;
      if (revisionId(current) !== baseRevisionId) throw new RevisionConflict();
      const snapshot = ownedVersionSnapshot(
        db,
        projectId,
        workspaceId,
        selectedId,
      );
      if (!snapshot || !snapshot.mediaAvailable)
        throw new SavedVersionUnavailable();
      return reviseOwnedProject(
        current,
        snapshot.timeline,
        `Restored ${selectedId}`,
        workspaceId,
      );
    })
    .immediate();
}
// Recheck authorization, current media metadata and the revision under the same
// write lock. Other web/worker processes cannot trash or change the project
// between these checks and the final save.
export function reviseOwnedProject(
  p: Project,
  timeline: Timeline,
  source: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(p.id, workspaceId)) return undefined;
      const latest = getProject(p.id)!;
      if (revisionId(latest) !== revisionId(p)) throw new RevisionConflict();
      validateProjectAssets(latest, timeline);
      return reviseProject(p, timeline, source);
    })
    .immediate();
}
function enqueueJob(project: Project, workspaceId?: string) {
  if (!project.timeline)
    throw new Error("A storyboard is required before export.");
  const active = db
    .prepare("SELECT id FROM jobs WHERE status IN ('queued','rendering')")
    .all();
  if (active.length >= 5) throw new ExportCapacityError("global");
  if (workspaceId) {
    const limit = activeExportLimit();
    const own = db
      .prepare(
        "SELECT count(*) AS count FROM jobs j JOIN projects p ON p.id=j.project_id WHERE p.workspace_id=? AND j.status IN ('queued','rendering')",
      )
      .get(workspaceId) as { count: number };
    if (own.count >= limit) throw new ExportCapacityError("studio");
  }
  const job: RenderJob = {
    id: randomUUID(),
    projectId: project.id,
    status: "queued",
    progress: 0,
    error: null,
    createdAt: new Date().toISOString(),
    issues: [],
    report: null,
    attempts: 0,
    retryCount: 0,
    stage: "Queued",
    events: [
      {
        at: new Date().toISOString(),
        stage: "Queued",
        message: "Export added to queue.",
      },
    ],
  };
  reserveJobHistory(
    db,
    job.id,
    project.id,
    workspaceForProject(project.id) ?? null,
    jobHistoryPolicy(),
  );
  db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?)").run(
    job.id,
    project.id,
    job.status,
    JSON.stringify(job),
    JSON.stringify(project.timeline),
  );
  assignRenderQueueKey(
    db,
    job.id,
    workspaceForProject(project.id) ?? null,
    totalFrames(project.timeline),
  );
  reserveExportStorage(
    db,
    job.id,
    project.id,
    workspaceForProject(project.id) ?? null,
    exportStoragePolicy(),
  );
  return job;
}
function rawJob(id: string): RenderJob | undefined {
  const row = db
    .prepare(
      `SELECT project_id,status,CASE WHEN length(CAST(data AS BLOB))<=${maximumJobDocumentBytes} THEN data END AS data FROM jobs WHERE id=?`,
    )
    .get(id) as
    | { project_id: string; status: RenderJob["status"]; data: string | null }
    | undefined;
  if (!row) return;
  let job: RenderJob;
  try {
    if (row.data === null) throw new JobHistoryUnavailable();
    job = JSON.parse(row.data);
    if (!job || typeof job !== "object" || Array.isArray(job))
      throw new JobHistoryUnavailable();
  } catch {
    throw new JobHistoryUnavailable();
  }
  delete job.files;
  delete job.retired;
  return { ...job, id, projectId: row.project_id, status: row.status };
}
export function getJob(id: string): RenderJob | undefined {
  const job = rawJob(id);
  if (!job) return;
  const files = getExportFileRemoval(db, id);
  const retired = readRetiredJob(db, id);
  return {
    ...job,
    ...(files ? { files } : {}),
    ...(retired ? { retired: true } : {}),
  };
}
export const jobQueueAhead = (id: string) => renderQueueAhead(db, id);
export const jobProjectId = (id: string) =>
  (
    db.prepare("SELECT project_id FROM jobs WHERE id=?").get(id) as
      { project_id: string } | undefined
  )?.project_id;
export const jobHistoryStorage = (workspaceId: string) =>
  jobHistoryUsage(db, workspaceId, jobHistoryPolicy());
export const jobHistoryRecords = (
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
) => ownedJobHistoryPage(db, workspaceId, cursor);
export const previewOwnedJobHistory = (id: string, workspaceId: string) =>
  previewJobHistoryRetirement(db, id, workspaceId, jobHistoryPolicy());
export const retireOwnedJobHistory = (
  id: string,
  workspaceId: string,
  digest: string,
) => applyJobHistoryRetirement(db, id, workspaceId, digest, jobHistoryPolicy());
export const downloadOwnedJobHistory = (id: string, workspaceId: string) =>
  downloadJobHistory(db, id, workspaceId);
export const ownedExportFileSource = (jobId: string, workspaceId: string) =>
  assertExportFileSource(db, jobId, workspaceId);
export const exportFileRemoval = (jobId: string, workspaceId: string) =>
  getExportFileRemoval(db, jobId, workspaceId);
export const requestExportFiles = (manifest: ExportFileManifest) =>
  requestExportFileRemoval(db, manifest);
export const acquireExportReview = (workspaceId: string) =>
  acquireExportFileReview(db, workspaceId);
export const releaseExportReview = (token: string) =>
  releaseExportFileReview(db, token);
export const claimExportFiles = () => claimExportFileRemoval(db);
export const finishExportFiles = (task: ExportFileTask) =>
  db
    .transaction(() => {
      const exists = db
        .prepare("SELECT 1 FROM export_storage_entries WHERE job_id=?")
        .get(task.jobId);
      if (exists) settleExportStorage(db, task.jobId, 0, 0, true);
      else
        db.prepare(
          "DELETE FROM schema_migrations WHERE id='export-storage-census-v1'",
        ).run();
      return finishExportFileRemoval(db, task);
    })
    .immediate();
export const failExportFiles = (task: ExportFileTask) =>
  failExportFileRemoval(db, task);
export function finishJobAttempt(
  jobId: string,
  footprint?: { bytes: number; files: number },
) {
  return db
    .transaction(() => {
      if (footprint) {
        const status = (
          db.prepare("SELECT status FROM jobs WHERE id=?").get(jobId) as
            { status: string } | undefined
        )?.status;
        if (!status) throw new ExportStorageUnavailable();
        settleExportStorage(
          db,
          jobId,
          footprint.bytes,
          footprint.files,
          ["completed", "failed", "cancelled"].includes(status),
        );
      }
      db.prepare("DELETE FROM render_job_attempts WHERE job_id=?").run(jobId);
      releaseKnownTerminalHolds(db);
    })
    .immediate();
}
export const exportStorage = (workspaceId: string) =>
  exportStorageUsage(db, workspaceId, exportStoragePolicy());
export const retainedExports = (
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
) => retainedExportPage(db, workspaceId, cursor);
export const exportStorageReady = () => assertExportStorageComplete(db);
export const exportJobCeiling = (jobId: string) =>
  exportOutputCeiling(db, jobId, exportStoragePolicy());
export const uncertainExportStorage = (jobId: string) =>
  markExportStorageUncertain(db, jobId);
export const releaseFinishedExportHolds = () => releaseKnownTerminalHolds(db);
export const exportStorageRecoveryJobs = () =>
  db
    .prepare(
      "SELECT e.job_id AS id,j.status,EXISTS(SELECT 1 FROM export_file_removals r WHERE r.job_id=j.id) AS removing FROM export_storage_entries e JOIN jobs j ON j.id=e.job_id WHERE e.dirty=1 OR (e.reservation_bytes>0 AND j.status IN ('completed','failed','cancelled')) ORDER BY e.job_id",
    )
    .all() as { id: string; status: string; removing: number }[];
export function settleRecoveredExport(
  jobId: string,
  footprint: { bytes: number; files: number },
) {
  const status = (
    db.prepare("SELECT status FROM jobs WHERE id=?").get(jobId) as
      { status: string } | undefined
  )?.status;
  if (!status) throw new ExportStorageUnavailable();
  return settleExportStorage(
    db,
    jobId,
    footprint.bytes,
    footprint.files,
    ["completed", "failed", "cancelled"].includes(status),
  );
}
export function updateJob(id: string, patch: Partial<RenderJob>) {
  return db
    .transaction(() => {
      const job = rawJob(id);
      if (!job) return;
      const updated = { ...job, ...patch };
      if (
        ["cancelled", "completed", "failed"].includes(job.status) &&
        patch.status !== job.status
      )
        return job;
      db.prepare("UPDATE jobs SET status=?,data=? WHERE id=?").run(
        updated.status,
        JSON.stringify(updated),
        id,
      );
      return updated;
    })
    .immediate();
}
export function claimJob(): { job: RenderJob; timeline: Timeline } | null {
  return db
    .transaction(() => {
      const row = db
        .prepare(
          `SELECT id,project_id,CASE WHEN length(CAST(data AS BLOB))<=${maximumJobDocumentBytes} THEN data END AS data,CASE WHEN length(CAST(timeline AS BLOB))<=${maximumJobTimelineBytes} THEN timeline END AS timeline FROM jobs WHERE status='queued' ORDER BY ${renderQueueOrder} LIMIT 1`,
        )
        .get() as
        | {
            id: string;
            project_id: string;
            data: string | null;
            timeline: string | null;
          }
        | undefined;
      if (!row) return null;
      let document: RenderJob, timeline: Timeline;
      try {
        if (row.data === null || row.timeline === null)
          throw new JobHistoryUnavailable();
        document = JSON.parse(row.data);
        timeline = JSON.parse(row.timeline);
        if (
          !document ||
          typeof document !== "object" ||
          Array.isArray(document)
        )
          throw new JobHistoryUnavailable();
      } catch {
        throw new JobHistoryUnavailable();
      }
      const job = {
        ...document,
        id: row.id,
        projectId: row.project_id,
        status: "queued",
      } as RenderJob;
      delete job.files;
      delete job.retired;
      db.prepare("INSERT INTO render_job_attempts VALUES(?,?)").run(
        job.id,
        new Date().toISOString(),
      );
      updateJob(job.id, { status: "rendering" });
      return {
        job: { ...job, status: "rendering" as const },
        timeline,
      };
    })
    .immediate();
}
export function recoverJobs() {
  recoverExportFileRemovals(db);
  for (const row of db
    .prepare("SELECT id FROM jobs WHERE status='rendering'")
    .all() as { id: string }[]) {
    if (
      !retryJob(row.id, "Worker interrupted; resuming from the saved timeline.")
    )
      updateJob(row.id, {
        status: "failed",
        error: "Worker interrupted after the retry limit was reached.",
      });
  }
}
export function createJob(project: Project) {
  return db.transaction(() => enqueueJob(project)).immediate();
}
// Public admission always re-reads the active owned project under the writer
// lock. Ownership/Trash, revision, validation, queue capacity and receipt are
// committed together; no asynchronous work can leave an unchecked snapshot.
export function createOwnedJob(
  projectId: string,
  workspaceId: string,
  request: { key?: string; baseRevisionId?: string | null } = {},
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const requestVersion = JSON.stringify({
        baseRevisionId: request.baseRevisionId,
      });
      if (request.key) {
        const receipt = db
          .prepare(
            "SELECT job_id,request_version FROM export_requests WHERE project_id=? AND request_key=?",
          )
          .get(projectId, request.key) as
          { job_id: string; request_version: string } | undefined;
        if (receipt) {
          if (receipt.request_version !== requestVersion)
            throw new ExportRequestConflict();
          const job = getJob(receipt.job_id);
          if (!job) throw new Error("The saved export request is unavailable.");
          return { job, replayed: true };
        }
      }
      const project = getProject(projectId)!;
      if (
        request.baseRevisionId !== undefined &&
        revisionId(project) !== request.baseRevisionId
      )
        throw new RevisionConflict();
      if (!project.timeline)
        throw new Error("Generate and approve a storyboard first.");
      validateProjectAssets(project, project.timeline);
      const blocking = inspectTimeline(
        project.timeline,
        (project.assets || []).map((a) => a.id),
      ).filter((i) => i.severity === "error" && i.code !== "bounds");
      if (blocking.length)
        throw new Error(blocking.map((i) => i.message).join(" "));
      const job = enqueueJob(project, workspaceId);
      if (request.key)
        db.prepare(
          "INSERT INTO export_requests(project_id,request_key,job_id,request_version) VALUES (?,?,?,?)",
        ).run(projectId, request.key, job.id, requestVersion);
      return { job, replayed: false };
    })
    .immediate();
}
export function activeStudioExports(workspaceId: string): ActiveStudioExport[] {
  const document = `CASE WHEN length(CAST(j.data AS BLOB))<=${maximumJobDocumentBytes} THEN CASE WHEN json_valid(j.data) THEN j.data ELSE '{}' END ELSE '{}' END`;
  const rows = db
    .prepare(
      `SELECT j.id,j.project_id AS projectId,j.status,
      CASE WHEN json_type(${document},'$.progress') IN ('integer','real') AND json_extract(${document},'$.progress') BETWEEN 0 AND 1 THEN json_extract(${document},'$.progress') ELSE 0 END AS progress,
      CASE WHEN json_type(${document},'$.stage')='text' THEN substr(json_extract(${document},'$.stage'),1,120) ELSE 'Export details need operator review.' END AS stage,
      CASE WHEN json_type(${document},'$.createdAt')='text' AND length(json_extract(${document},'$.createdAt'))<=40 THEN json_extract(${document},'$.createdAt') ELSE '' END AS createdAt,
      ${boundedProjectLabelSql} AS projectName
      FROM jobs j JOIN projects p ON p.id=j.project_id WHERE p.workspace_id=? AND p.trashed_at IS NULL AND j.status IN ('queued','rendering') ORDER BY j.rowid LIMIT 5`,
    )
    .all(workspaceId) as ActiveStudioExport[];
  return rows.map((row) => ({
    ...row,
    projectName: row.projectName || "Saved project",
  }));
}
export function recordJobStage(
  id: string,
  stage: string,
  message: string = stage,
) {
  return db
    .transaction(() => {
      const job = getJob(id);
      if (!job || job.status === "cancelled") return;
      return updateJob(id, {
        status: job.status,
        stage,
        events: [
          ...(job.events || []),
          {
            at: new Date().toISOString(),
            stage,
            message: message.slice(0, 500),
          },
        ].slice(-100),
      });
    })
    .immediate();
}
export function retryJob(id: string, reason: string) {
  return db
    .transaction(() => {
      const job = getJob(id);
      if (!job || job.status !== "rendering" || (job.retryCount || 0) >= 1)
        return false;
      updateJob(id, {
        status: "queued",
        progress: 0,
        error: null,
        retryCount: (job.retryCount || 0) + 1,
        stage: "Queued for retry",
        events: [
          ...(job.events || []),
          {
            at: new Date().toISOString(),
            stage: "Retry",
            message: reason.slice(0, 500),
          },
        ].slice(-100),
      });
      return true;
    })
    .immediate();
}
export function listJobs(projectId: string): RenderJob[] {
  return (
    db
      .prepare(
        "SELECT id FROM jobs WHERE project_id=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(projectId) as { id: string }[]
  ).map((r) => getJob(r.id)!);
}
export function projectExportPage(
  projectId: string,
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
) {
  return ownedExportPage(db, projectId, workspaceId, cursor);
}
export type Workspace = { id: string; ownerId: string; name: string };
export function ensureWorkspace(userId: string, name: string): Workspace {
  if (db.prepare("SELECT 1 FROM account_erasures WHERE owner_id=?").get(userId))
    throw new AccountErasureUnavailable();
  // Established accounts stay read-only on private GET requests. Only creation
  // needs a write lock, with a second check after admission.
  const lookup = db.prepare(
    "SELECT id,owner_id AS ownerId,name FROM workspaces WHERE owner_id=?",
  );
  const saved = lookup.get(userId) as Workspace | undefined;
  if (saved) return saved;
  return db
    .transaction(() => {
      const existing = lookup.get(userId) as Workspace | undefined;
      if (existing) return existing;
      const workspace = {
        id: randomUUID(),
        ownerId: userId,
        name: `${name.slice(0, 60)}'s studio`,
      };
      db.prepare("INSERT INTO workspaces(id,owner_id,name) VALUES (?,?,?)").run(
        workspace.id,
        userId,
        workspace.name,
      );
      return workspace;
    })
    .immediate();
}
export function projectInWorkspace(
  id: string,
  workspaceId: string,
  includeTrashed = false,
) {
  return !!db
    .prepare(
      `SELECT id FROM projects WHERE id=? AND workspace_id=?${includeTrashed ? "" : " AND trashed_at IS NULL"} AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=projects.id) AND NOT EXISTS(SELECT 1 FROM account_erasures e WHERE e.workspace_id=projects.workspace_id)`,
    )
    .get(id, workspaceId);
}
export function setProjectTrashed(id: string, trashed: boolean) {
  return db
    .transaction(() => {
      const row = db
        .prepare("SELECT trashed_at FROM projects WHERE id=?")
        .get(id) as { trashed_at: string | null } | undefined;
      if (!row) throw new Error("Project not found.");
      if (
        db
          .prepare(
            "SELECT project_id FROM project_deletions WHERE project_id=?",
          )
          .get(id)
      )
        throw new ProjectDeletionConflict(
          "This project is scheduled for permanent deletion.",
        );
      if (trashed) {
        db.prepare(
          "UPDATE media_requests SET state='cancelling',updated_at=? WHERE project_id=? AND state IN ('receiving','queued','working')",
        ).run(Date.now(), id);
        const jobs = db
          .prepare(
            "SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','rendering')",
          )
          .all(id) as { id: string }[];
        for (const job of jobs)
          updateJob(job.id, {
            status: "cancelled",
            stage: "Cancelled by moving project to Trash",
          });
      }
      const at = trashed ? row.trashed_at || new Date().toISOString() : null;
      db.prepare("UPDATE projects SET trashed_at=? WHERE id=?").run(at, id);
      return { trashedAt: at };
    })
    .immediate();
}
export function claimLegacyProjects(workspaceId: string, apply = false) {
  const count = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM projects WHERE workspace_id IS NULL",
      )
      .get() as { count: number }
  ).count;
  if (apply)
    db.prepare(
      "UPDATE projects SET workspace_id=? WHERE workspace_id IS NULL",
    ).run(workspaceId);
  return count;
}

export function workspaceForProject(id: string) {
  return (
    (
      db.prepare("SELECT workspace_id FROM projects WHERE id=?").get(id) as
        { workspace_id: string | null } | undefined
    )?.workspace_id || null
  );
}

export function requestOwnedProjectDeletion(id: string, workspaceId: string) {
  return requestDeletion(db, id, workspaceId);
}
export function ownedProjectDeletion(id: string, workspaceId: string) {
  return deletionForOwner(db, id, workspaceId);
}
export function ownedProjectDeletions(workspaceId: string, offset = 0) {
  return deletionsForOwner(db, workspaceId, offset);
}
export function claimProjectDeletion() {
  return claimDeletion(db);
}
export function reserveProjectDeletionMedia(task: DeletionTask) {
  return reserveDeletionMedia(db, task);
}
export function finishProjectDeletion(task: DeletionTask) {
  return completeDeletion(db, task);
}
export function failProjectDeletion(task: DeletionTask) {
  return failedDeletion(db, task);
}
