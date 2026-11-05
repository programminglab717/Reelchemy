import type Database from "better-sqlite3";
// This is connection-local. Every application writer that can remove private
// records opts in; WAL and historical snapshots still require their own policy.
export function enableSecureDeletion(db: Database.Database) {
  if (db.pragma("secure_delete=ON", { simple: true }) !== 1)
    throw new Error("Private database deletion policy is unavailable.");
}
