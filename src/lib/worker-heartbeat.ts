export const HEARTBEAT_NAME = "worker-heartbeat.json";
export const INGEST_HEARTBEAT_NAME = "ingest-heartbeat.json";
export function recentHeartbeat(value: unknown, now = Date.now()) {
  if (
    !value ||
    typeof value !== "object" ||
    !("at" in value) ||
    typeof value.at !== "string"
  )
    return false;
  const at = Date.parse(value.at);
  return Number.isFinite(at) && now - at >= -5000 && now - at <= 30000;
}
