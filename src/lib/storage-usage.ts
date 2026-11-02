import type Database from "better-sqlite3";
import { projectStoragePolicy } from "./project-storage-policy";
import {
  mediaStorageLimit,
  sharedMediaStorageLimit,
} from "./media-storage-policy";
import { mediaProcessingPolicy } from "./media-processing-policy";
export class StorageUsageUnavailable extends Error {
  constructor() {
    super(
      "Storage usage is unavailable. Verify the private data directory and complete a coordinated application migration or census. No repair was attempted.",
    );
  }
}
// This module never imports the application database initializer, scans media,
// creates a signing key, or repairs derived indexes. The CLI opens read-only.
export function storageUsage(db: Database.Database, workspaceId?: string) {
  try {
    return db
      .transaction(() => {
        const project = projectStoragePolicy(),
          mediaLimit = workspaceId
            ? mediaStorageLimit()
            : sharedMediaStorageLimit(),
          processing = mediaProcessingPolicy();
        for (const id of [
          "project-data-sizes-v1",
          "retained-media-size-census-v2",
        ])
          if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id=?").get(id))
            throw new StorageUsageUnavailable();
        if (
          workspaceId &&
          !db.prepare("SELECT 1 FROM workspaces WHERE id=?").get(workspaceId)
        )
          throw new StorageUsageUnavailable();
        if (
          db
            .prepare(
              "SELECT 1 FROM projects p LEFT JOIN project_data_sizes s ON s.project_id=p.id WHERE s.project_id IS NULL LIMIT 1",
            )
            .get()
        )
          throw new StorageUsageUnavailable();
        if (
          db
            .prepare(
              "SELECT 1 FROM (SELECT asset_id FROM project_media_refs UNION SELECT asset_id FROM job_media_refs UNION SELECT asset_id FROM media_deletion_targets) r LEFT JOIN media_sizes s ON s.asset_id=r.asset_id WHERE s.asset_id IS NULL LIMIT 1",
            )
            .get()
        )
          throw new StorageUsageUnavailable();
        const projects = db
          .prepare(
            `SELECT count(*) AS count,COALESCE(sum(s.bytes),0) AS bytes,COALESCE(sum(s.versions),0) AS versions,COALESCE(sum(s.messages),0) AS messages FROM project_data_sizes s JOIN projects p ON p.id=s.project_id ${workspaceId ? "WHERE p.workspace_id=?" : ""}`,
          )
          .get(...(workspaceId ? [workspaceId] : [])) as {
          count: number;
          bytes: number;
          versions: number;
          messages: number;
        };
        const media = workspaceId
          ? db
              .prepare(
                "SELECT count(*) AS files,COALESCE(sum(s.bytes),0) AS bytes FROM (SELECT r.asset_id FROM project_media_refs r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? UNION SELECT r.asset_id FROM job_media_refs r JOIN jobs j ON j.id=r.job_id JOIN projects p ON p.id=j.project_id WHERE p.workspace_id=?) owned JOIN media_sizes s ON s.asset_id=owned.asset_id",
              )
              .get(workspaceId, workspaceId)
          : db
              .prepare(
                "SELECT count(*) AS files,COALESCE(sum(bytes),0) AS bytes FROM media_sizes",
              )
              .get();
        const raw = db
          .prepare(
            `SELECT COALESCE(sum(reserved_bytes),0) AS reservedBytes,COALESCE(sum(state IN ('receiving','queued','working','cancelling')),0) AS activeRequests FROM media_requests ${workspaceId ? "WHERE workspace_id=?" : ""}`,
          )
          .get(...(workspaceId ? [workspaceId] : [])) as {
          reservedBytes: number;
          activeRequests: number;
        };
        return {
          format: "reelchemy-storage-usage-v1",
          scope: workspaceId ? "studio" : "service",
          ...(workspaceId ? { workspaceId } : {}),
          projects: {
            ...projects,
            limitBytes: workspaceId
              ? project.studioBytes
              : project.serviceBytes,
            limitCount: workspaceId
              ? project.studioProjects
              : project.serviceProjects,
          },
          normalizedMedia: {
            ...(media as { files: number; bytes: number }),
            limitBytes: mediaLimit,
          },
          mediaInputs: {
            ...raw,
            ...(!workspaceId
              ? { limitReservedBytes: processing.rawBytes }
              : {}),
          },
          measurement:
            "Indexed retained project JSON and known source files; excludes exports, caches, backups and physical database/WAL allocation.",
        };
      })
      .deferred();
  } catch {
    throw new StorageUsageUnavailable();
  }
}
