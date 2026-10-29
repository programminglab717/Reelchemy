# Reelchemy local storage operations

This runbook covers the current single-host SQLite/filesystem adapter. It does not make the service ready for public production: managed storage, public quotas/abuse controls, staging, monitoring/alerts, retention, long-video benchmarks and creator acceptance still have open release gates. Live AI verification remains deferred.

## Availability checks

- `/api/health/live`: HTTP 200 means the web process answers requests.
- `/api/health`: HTTP 200 requires the studio database, authentication initialization, writable data/export paths, the configured free-space floor and a render-worker heartbeat no older than 30 seconds. A failed check returns 503 and booleans only.
- This probe does not send mail, call an AI provider, prove SMTP delivery, guarantee capacity for another export or inspect artistic quality. An external monitor/alert destination has not been configured.

Keep one render worker per database. Stop it gracefully with SIGTERM/SIGINT and wait for exit; it records interrupted work for its bounded retry policy and removes its heartbeat/lock. If a crash leaves `worker.lock`, inspect its PID and confirm that process is gone before removing only the stale lock. Never delete the database to clear a lock.

## Create and verify a backup

Stop web, render and mail services before a coordinated backup. The command rejects an existing render-worker lock and snapshots containing an actively rendering job; it cannot prove that every web/mail writer has stopped. Pausing all writers is an operator precondition. The SQLite backup API produces a standalone snapshot of each database; copying live `.sqlite`/WAL files directly is not the backup procedure.

From the repository directory, with the same `REELCHEMY_DATA_DIR` and `REELCHEMY_ARTIFACT_DIR` used by the services:

```sh
npm run backup -- create /path/to/new-private-backup
npm run backup -- verify /path/to/new-private-backup
```

The destination must not exist and must be outside both source directories, including symlink aliases. Creation uses a private directory (0700), private files (0600), checksummed entries and a manifest written after copying. Creation verifies its result. Failures clean up only the new destination created by that operation; existing backups are never overwritten.

Included: standalone studio/auth databases, the development signing-secret file when present, media referenced by project asset metadata, and completed/failed export directories. Verification checks SHA-256 and file sizes, SQLite integrity, referenced-media/export presence and workspace-account references. Missing completed exports or referenced media fail the backup.

Excluded: environment files/provider/SMTP credentials, pending mail, worker locks/heartbeats, rebuildable scene caches, temporary/unfinished export directories, unreferenced orphan media and older backup directories. Pending email is deliberately not replayed on restore; users can request a new verification/reset email. Authentication/environment configuration still needs the external secret store or separately managed configuration.

These backups contain private account/project/media data, password hashes and possibly a development signing secret. File permissions are local protection; snapshots are not encrypted by this tool. Store off-host copies through an access-controlled encrypted backup system. Checksums detect damage and incomplete copies, not a malicious party who can replace the manifest. Restore only an administrator-trusted snapshot. Off-host delivery, encryption-key management, scheduling and retention are not configured here.

Record the application commit/version alongside each snapshot. Keep pre-migration backups; restore using a compatible application version before applying migrations. No cross-database transaction or zero-downtime backup guarantee is claimed.

## Restore and test before switching services

Restore always creates a new directory. It never overwrites an existing installation:

```sh
npm run backup -- verify /path/to/trusted-backup
npm run backup -- restore /path/to/trusted-backup /path/to/new-restore
```

The command verifies before creating the target, rejects traversal/symlinks/unexpected files, copies only listed entries and writes a private `RESTORE.json`. It revokes copied sessions and verification/reset tokens so users must sign in again. Queued/rendering jobs become failed with an explicit restore message; they do not silently restart. Saved projects and terminal exports remain. Export paths in saved job reports are rebased to the restored artifact directory; older evidence JSON can retain historical diagnostic paths.

Use the returned data/artifact paths in an isolated test instance:

```sh
REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_ARTIFACT_DIR=/path/to/new-restore/artifacts \
npm run auth:migrate

# Separate terminals, same paths/environment:
REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_ARTIFACT_DIR=/path/to/new-restore/artifacts \
npm run worker

REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_ARTIFACT_DIR=/path/to/new-restore/artifacts \
npm run dev -- --port 3003
```

Set the test instance's `BETTER_AUTH_URL` appropriately. Keep development mail in the private file mailbox and AI in demo mode during the drill. Never run an SMTP worker during a restore test or copy production credentials into test logs. Production auth requires its own valid HTTPS/secret/SMTP configuration; the example is a local drill, not a public deployment recipe.

Check readiness, sign in with a test account, reopen/edit/export a representative project, verify private asset/download access and decode retained MP4s. Only switch real services to restored storage after the drill succeeds. Preserve the original installation for rollback. A restored database is a point-in-time copy: later writes in the original installation are not merged automatically.

## Executed evidence

See VALIDATION.md for the actual drill and check results. Unit/integration coverage creates real Better Auth credentials and sessions, a private workspace, uploaded image and actual FFmpeg MP4; backs up/restores; rejects the old session; signs in again in a fresh process; checks project authorization; verifies media bytes/full video decode; and ensures restore does not modify the source or restart pending exports.

The GitHub Actions workflow runs these tests and the isolated browser suite with synthetic accounts/demo AI. Configuration is committed locally; a hosted CI run, off-host restore and production RPO/RTO are still unverified.

## Request policy configuration

`REELCHEMY_WRITES_PER_MINUTE` (120), `REELCHEMY_MEDIA_REQUESTS_PER_HOUR` (30), `REELCHEMY_PLANS_PER_DAY` (60) and `REELCHEMY_EXPORT_REQUESTS_PER_DAY` (30) accept positive integers. Counters are per workspace, persist in the studio database, and start a new window after expiry. A 429 includes Retry-After; a bad operator value returns 503 and sets the readiness `limits` check false. Authentication retains its separate signup/sign-in protections.

Changing these numbers is not a capacity benchmark. Request caps do not enforce a stored-byte ceiling, actual provider token/dollar spending, global decoder isolation or IP-based public-abuse policy. Keep those release gates open until implemented/validated for the chosen hosting and budget. Restored studio snapshots include existing request-window counters; restore does not reset usage allowances.
