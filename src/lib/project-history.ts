import type Database from "better-sqlite3";
import { z } from "zod";
import { timelineSchema, type Asset, type Timeline } from "./schema";
import { ownedMediaCatalogue } from "./media-catalogue";
import { validateProjectAssets } from "./project-assets";

export type SavedVersion = {
  id: string;
  number: number;
  source: string;
  createdAt: string | null;
};
export type SavedVersionPage = {
  items: SavedVersion[];
  total: number;
  nextOffset: number | null;
  unavailable: number;
};
export type SavedVersionSnapshot = {
  projectId: string;
  version: SavedVersion;
  timeline: Timeline;
  assets: Asset[];
  mediaAvailable: boolean;
};
export class SavedVersionUnavailable extends Error {}
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const identifier = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const active =
  "p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)";
const document = "CASE WHEN r.type='object' THEN r.value ELSE '{}' END";
const versions =
  "CASE WHEN json_type(p.data,'$.revisions')='array' THEN json_extract(p.data,'$.revisions') ELSE '[]' END";
function text(name: string, limit: number) {
  const value = `json_extract(${document},'$.${name}')`;
  return `CASE WHEN json_type(${document},'$.${name}')='text' AND length(CAST(${value} AS BLOB))<=${limit * 4} THEN ${value} ELSE NULL END`;
}
const metadata = `${text("id", 80)} AS id,${text("source", 500)} AS source,${text("createdAt", 40)} AS createdAt,CAST(r.key AS INTEGER)+1 AS number`;
type Row = { id: unknown; source: unknown; createdAt: unknown; number: number };
function summary(row: Row): SavedVersion | undefined {
  const parsed = identifier.safeParse(row.id);
  if (!parsed.success) return;
  return {
    id: parsed.data,
    number: row.number,
    source:
      typeof row.source === "string"
        ? row.source.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500)
        : "Saved edit",
    createdAt: z.iso.datetime({ offset: true }).safeParse(row.createdAt).success
      ? (row.createdAt as string)
      : null,
  };
}
function owned(db: Database.Database, projectId: string, workspaceId: string) {
  const project = db
    .prepare(
      `SELECT json_valid(p.data) AS valid FROM projects p WHERE ${active}`,
    )
    .get(projectId, workspaceId) as { valid: number } | undefined;
  if (project && !project.valid) throw new SavedVersionUnavailable();
  return !!project;
}
export function ownedVersionPage(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  offset: number,
  limit = 20,
): SavedVersionPage | undefined {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new SavedVersionUnavailable();
  if (!owned(db, projectId, workspaceId)) return;
  const total = (
    db
      .prepare(
        `SELECT CASE WHEN json_type(p.data,'$.revisions')='array' THEN json_array_length(p.data,'$.revisions') ELSE 0 END AS total FROM projects p WHERE ${active}`,
      )
      .get(projectId, workspaceId) as { total: number }
  ).total;
  const rows = db
    .prepare(
      `SELECT ${metadata} FROM projects p,json_each(${versions}) r WHERE ${active} ORDER BY CAST(r.key AS INTEGER) DESC LIMIT ? OFFSET ?`,
    )
    .all(projectId, workspaceId, limit, offset) as Row[];
  const items = rows
    .map(summary)
    .filter((item): item is SavedVersion => !!item);
  return {
    items,
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
    unavailable: rows.length - items.length,
  };
}
export function ownedVersionSnapshot(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  revisionId: string,
): SavedVersionSnapshot | undefined {
  if (!identifier.safeParse(revisionId).success)
    throw new SavedVersionUnavailable();
  if (!owned(db, projectId, workspaceId)) return;
  const matches = `${active} AND json_extract(${document},'$.id')=?`;
  const count = (
    db
      .prepare(
        `SELECT count(*) AS total FROM projects p,json_each(${versions}) r WHERE ${matches}`,
      )
      .get(projectId, workspaceId, revisionId) as { total: number }
  ).total;
  if (!count) return;
  if (count !== 1) throw new SavedVersionUnavailable();
  const value = `json_extract(${document},'$.timeline')`;
  const row = db
    .prepare(
      `SELECT ${metadata},CASE WHEN json_type(${document},'$.timeline')='object' AND length(CAST(${value} AS BLOB))<=${MAX_SNAPSHOT_BYTES} THEN ${value} ELSE NULL END AS timeline FROM projects p,json_each(${versions}) r WHERE ${matches} LIMIT 1`,
    )
    .get(projectId, workspaceId, revisionId) as Row & {
    timeline: string | null;
  };
  const version = summary(row);
  if (!version || !row.timeline) throw new SavedVersionUnavailable();
  const parsed = timelineSchema.safeParse(JSON.parse(row.timeline));
  if (!parsed.success) throw new SavedVersionUnavailable();
  const assets = ownedMediaCatalogue(db, projectId, workspaceId)?.assets || [];
  let mediaAvailable = true;
  try {
    validateProjectAssets({ assets }, parsed.data);
  } catch {
    mediaAvailable = false;
  }
  return { projectId, version, timeline: parsed.data, assets, mediaAvailable };
}
