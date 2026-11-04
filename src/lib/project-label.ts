// Keep large, valid saved histories nameable without returning them to JS.
// Match the 64 MiB legacy history-review bound; larger/corrupt documents use
// the caller's neutral label and require operator-assisted recovery.
export const boundedProjectLabelSql = `CASE WHEN length(CAST(p.data AS BLOB))<=67108864 THEN CASE WHEN json_valid(p.data) THEN CASE WHEN json_type(p.data,'$.name')='text' THEN substr(json_extract(p.data,'$.name'),1,100) END END END`;
