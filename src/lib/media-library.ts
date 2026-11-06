import { MAX_SOURCE_FRAMES } from "./timeline-limits";
import type Database from "better-sqlite3";
import { z } from "zod";
import { assetMimes, fontMimes, type Asset } from "./schema";
export const libraryProjectId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);

// Only retained media metadata enters the library. Full projects, histories,
// conversations, file paths and other studios' references never leave SQLite.
export const libraryAssetSchema = z.object({
  id: z.uuid(),
  name: z.string().max(100),
  source: z.string().max(500),
  license: z.string().min(1).max(500),
  mime: z.enum(assetMimes),
  bytes: z.number().int().min(1).optional(),
  durationFrames: z.number().int().min(0).max(MAX_SOURCE_FRAMES).optional(),
  width: z.number().int().min(1).max(16000000).optional(),
  height: z.number().int().min(1).max(16000000).optional(),
  hasAudio: z.boolean().optional(),
  createdAt: z.string().datetime(),
});
export type LibraryItem = {
  asset: Asset;
  sourceProject: { id: string; name: string };
};
export type LibraryPage = {
  items: LibraryItem[];
  total: number;
  nextOffset: number | null;
};
export type LibraryQuery = {
  query: string;
  kind: "all" | "image" | "audio" | "video" | "font";
  offset: number;
  limit: number;
  targetProjectId?: string;
};
export function listLibraryMedia(
  db: Database.Database,
  workspaceId: string,
  options: LibraryQuery,
): LibraryPage {
  const values: (string | number)[] = [workspaceId];
  let where = "";
  if (options.targetProjectId) {
    where += " AND p.id<>?";
    values.push(options.targetProjectId);
  }
  const collection = `WITH catalog AS (
    SELECT a.value AS asset,p.id AS project_id,json_extract(p.data,'$.name') AS project_name,
      ROW_NUMBER() OVER(PARTITION BY json_extract(CASE WHEN a.type='object' THEN a.value ELSE '{}' END,'$.id') ORDER BY p.rowid DESC) AS position
    FROM projects p,json_each(CASE WHEN json_valid(p.data) THEN p.data ELSE '{}' END,'$.assets') a
    WHERE p.workspace_id=? AND p.trashed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)
      AND a.type='object' AND json_type(CASE WHEN a.type='object' THEN a.value ELSE '{}' END,'$.id')='text'
      AND json_extract(CASE WHEN a.type='object' THEN a.value ELSE '{}' END,'$.mime') IN (${assetMimes.map((m) => `'${m}'`).join(",")})${where}
  )`;
  let filter = "position=1";
  if (options.query) {
    filter += " AND json_extract(asset,'$.name') LIKE ? ESCAPE '\\'";
    values.push(`%${options.query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (options.kind === "font") {
    filter += ` AND json_extract(asset,'$.mime') IN (${fontMimes.map(() => "?").join(",")})`;
    values.push(...fontMimes);
  } else if (options.kind !== "all") {
    filter += " AND json_extract(asset,'$.mime')=?";
    values.push(
      { image: "image/png", audio: "audio/wav", video: "video/mp4" }[
        options.kind
      ],
    );
  }
  const total = (
    db
      .prepare(
        `${collection} SELECT count(*) AS total FROM catalog WHERE ${filter}`,
      )
      .get(...values) as { total: number }
  ).total;
  const rows = db
    .prepare(
      `${collection} SELECT asset,project_id,project_name FROM catalog WHERE ${filter} ORDER BY json_extract(asset,'$.createdAt') DESC,json_extract(asset,'$.id') LIMIT ? OFFSET ?`,
    )
    .all(...values, options.limit, options.offset) as {
    asset: string;
    project_id: string;
    project_name: unknown;
  }[];
  const items: LibraryItem[] = [];
  for (const row of rows) {
    if (!libraryProjectId.safeParse(row.project_id).success) continue;
    const parsed = libraryAssetSchema.safeParse(JSON.parse(row.asset));
    if (!parsed.success) continue;
    items.push({
      asset: parsed.data,
      sourceProject: {
        id: row.project_id,
        name:
          typeof row.project_name === "string"
            ? row.project_name.slice(0, 100)
            : "Untitled project",
      },
    });
  }
  return {
    items,
    total,
    // Invalid legacy entries are never exposed, but still advance the cursor
    // so a damaged record cannot trap the client on the same page.
    nextOffset:
      options.offset + rows.length < total
        ? options.offset + rows.length
        : null,
  };
}
