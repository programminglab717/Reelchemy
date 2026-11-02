import type Database from "better-sqlite3";
import { z } from "zod";
import { timelineSchema } from "./schema";
import { ownedMediaCatalogue } from "./media-catalogue";
import { ownedVersionPage } from "./project-history";
import type { ConversationPage, EditorProject } from "./project-view";
export class EditorProjectUnavailable extends Error {}
const active =
  "p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)";
const MAX_TIMELINE_BYTES = 2 * 1024 * 1024;
function owned(db: Database.Database, projectId: string, workspaceId: string) {
  const row = db
    .prepare(
      `SELECT json_valid(p.data) AS valid FROM projects p WHERE ${active}`,
    )
    .get(projectId, workspaceId) as { valid: number } | undefined;
  if (row && !row.valid) throw new EditorProjectUnavailable();
  return !!row;
}
const messageDocument = "CASE WHEN m.type='object' THEN m.value ELSE '{}' END";
const messageSchema = z.object({
  index: z.number().int().min(0),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(6000),
});
export function ownedConversationPage(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  before?: number,
): ConversationPage | undefined {
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
    throw new EditorProjectUnavailable();
  if (!owned(db, projectId, workspaceId)) return;
  const total = (
    db
      .prepare(
        `SELECT CASE WHEN json_type(p.data,'$.messages')='array' THEN json_array_length(p.data,'$.messages') ELSE 0 END AS total FROM projects p WHERE ${active}`,
      )
      .get(projectId, workspaceId) as { total: number }
  ).total;
  const end = Math.min(before ?? total, total);
  const start = Math.max(0, end - 50);
  const content = `json_extract(${messageDocument},'$.content')`;
  const rows = db
    .prepare(
      `SELECT CAST(m.key AS INTEGER) AS 'index',
    CASE WHEN json_type(${messageDocument},'$.role')='text' AND length(CAST(json_extract(${messageDocument},'$.role') AS BLOB))<=40 THEN json_extract(${messageDocument},'$.role') ELSE NULL END AS role,
    CASE WHEN json_type(${messageDocument},'$.content')='text' AND length(CAST(${content} AS BLOB))<=24000 THEN ${content} ELSE NULL END AS content
    FROM projects p,json_each(CASE WHEN json_type(p.data,'$.messages')='array' THEN json_extract(p.data,'$.messages') ELSE '[]' END) m
    WHERE ${active} AND CAST(m.key AS INTEGER)>=? AND CAST(m.key AS INTEGER)<? ORDER BY CAST(m.key AS INTEGER) LIMIT 50`,
    )
    .all(projectId, workspaceId, start, end);
  const items: ConversationPage["items"] = [];
  for (const row of rows) {
    const parsed = messageSchema.safeParse(row);
    if (parsed.success) items.push(parsed.data);
  }
  return {
    items,
    total,
    rangeStart: start,
    rangeEnd: end,
    nextBefore: start > 0 ? start : null,
    newerBefore: end < total ? Math.min(total, end + 50) : null,
    unavailable: rows.length - items.length,
  };
}
const baseSchema = z.object({
  name: z.string().min(1).max(100),
  createdAt: z.string().max(40),
  brief: z.object({
    prompt: z.string().min(1).max(1200),
    duration: z.number().int().min(5).max(60),
    format: z.enum(["landscape", "portrait", "square"]),
  }),
});
function boundedText(document: string, field: string, max: number) {
  const value = `json_extract(${document},'$.${field}')`;
  return `CASE WHEN json_type(${document},'$.${field}')='text' AND length(CAST(${value} AS BLOB))<=${max * 4} THEN ${value} ELSE NULL END`;
}
export function ownedEditorProject(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
): EditorProject | undefined {
  if (!owned(db, projectId, workspaceId)) return;
  const brief =
    "CASE WHEN json_type(p.data,'$.brief')='object' THEN json_extract(p.data,'$.brief') ELSE '{}' END";
  const timeline = "json_extract(p.data,'$.timeline')";
  const last =
    "CASE WHEN json_type(p.data,'$.revisions[#-1]')='object' THEN json_extract(p.data,'$.revisions[#-1]') ELSE '{}' END";
  const row = db
    .prepare(
      `SELECT ${boundedText("p.data", "name", 100)} AS name,
    ${boundedText("p.data", "createdAt", 40)} AS createdAt,
    json_object('prompt',${boundedText(brief, "prompt", 1200)},'duration',CASE WHEN json_type(${brief},'$.duration')='integer' THEN json_extract(${brief},'$.duration') ELSE NULL END,'format',${boundedText(brief, "format", 10)}) AS brief,
    json_type(p.data,'$.timeline') AS timelineType,
    CASE WHEN json_type(p.data,'$.timeline')='object' AND length(CAST(${timeline} AS BLOB))<=${MAX_TIMELINE_BYTES} THEN ${timeline} ELSE NULL END AS timeline,
    ${boundedText(last, "id", 80)} AS latestId
    FROM projects p WHERE ${active}`,
    )
    .get(projectId, workspaceId) as {
    name: unknown;
    createdAt: unknown;
    brief: string;
    timelineType: string | null;
    timeline: string | null;
    latestId: string | null;
  };
  const base = baseSchema.safeParse({ ...row, brief: JSON.parse(row.brief) });
  if (!base.success || !["null", null, "object"].includes(row.timelineType))
    throw new EditorProjectUnavailable();
  if (row.timelineType === "object" && !row.timeline)
    throw new EditorProjectUnavailable();
  const parsed = row.timeline
    ? timelineSchema.safeParse(JSON.parse(row.timeline))
    : null;
  if (parsed && !parsed.success) throw new EditorProjectUnavailable();
  const versions = ownedVersionPage(db, projectId, workspaceId, 0)!;
  const revisions = [...versions.items].reverse();
  // Filtering damaged legacy entries must not accidentally make an earlier
  // revision the CAS base of an editable current film.
  if (versions.total && revisions.at(-1)?.id !== row.latestId)
    throw new EditorProjectUnavailable();
  const messages = ownedConversationPage(db, projectId, workspaceId)!;
  return {
    id: projectId,
    ...base.data,
    timeline: parsed?.data ?? null,
    assets: ownedMediaCatalogue(db, projectId, workspaceId)?.assets ?? [],
    revisions,
    revisionCount: versions.total,
    messages: messages.items,
    messageCount: messages.total,
    messageStart: messages.rangeStart,
    messageUnavailable: messages.unavailable,
  };
}
