import type Database from "better-sqlite3";
import { libraryAssetSchema } from "./media-library";
import type { AssetUpdate } from "./project-assets";

// Build a bounded projection inside SQLite. A legacy object can have arbitrary
// extra fields; neither those fields nor project histories enter JS or HTTP.
const document = "CASE WHEN a.type='object' THEN a.value ELSE '{}' END";
function field(name: string, kind: "text" | "number" | "boolean", maximum = 0) {
  const type = `json_type(${document},'$.${name}')`;
  const value = `json_extract(${document},'$.${name}')`;
  const valid =
    kind === "text"
      ? `${type}='text' AND length(CAST(${value} AS BLOB))<=${maximum * 4}`
      : kind === "number"
        ? `${type} IN ('integer','real')`
        : `${type} IN ('true','false')`;
  const invalid = kind === "text" ? "0" : "'invalid'";
  return `'${name}',CASE WHEN ${type} IS NULL THEN NULL WHEN ${valid} THEN ${value} ELSE ${invalid} END`;
}
const projection = [
  field("id", "text", 36),
  field("name", "text", 100),
  field("source", "text", 500),
  field("license", "text", 500),
  field("mime", "text", 30),
  field("createdAt", "text", 40),
  field("bytes", "number"),
  field("durationFrames", "number"),
  field("width", "number"),
  field("height", "number"),
  field("hasAudio", "boolean"),
].join(",");
const active =
  "p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)";
export function ownedMediaCatalogue(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
): AssetUpdate | undefined {
  const project = db
    .prepare(
      `SELECT p.id,json_valid(p.data) AS valid FROM projects p WHERE ${active}`,
    )
    .get(projectId, workspaceId) as { id: string; valid: number } | undefined;
  if (!project) return undefined;
  if (!project.valid) throw new Error("Project metadata is unavailable.");
  const rows = db
    .prepare(
      `SELECT json_object(${projection}) AS asset
    FROM projects p,json_each(CASE WHEN json_type(p.data,'$.assets')='array' THEN json_extract(p.data,'$.assets') ELSE '[]' END) a
    WHERE ${active} ORDER BY CAST(a.key AS INTEGER) LIMIT 30`,
    )
    .all(projectId, workspaceId) as { asset: string }[];
  const assets: NonNullable<AssetUpdate["assets"]> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = Object.fromEntries(
      Object.entries(JSON.parse(row.asset) as Record<string, unknown>).filter(
        ([, value]) => value !== null,
      ),
    );
    if (value.hasAudio === 1 || value.hasAudio === 0)
      value.hasAudio = value.hasAudio === 1;
    const parsed = libraryAssetSchema.safeParse(value);
    if (parsed.success && !seen.has(parsed.data.id)) {
      assets.push(parsed.data);
      seen.add(parsed.data.id);
    }
  }
  return { id: project.id, assets };
}
