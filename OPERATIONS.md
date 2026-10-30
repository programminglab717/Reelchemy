# Reelchemy local storage operations

This runbook covers the current single-host SQLite/filesystem adapter. It does not make the service ready for public production: managed storage, public quotas/abuse controls, staging, monitoring/alerts, retention, long-video benchmarks and creator acceptance still have open release gates. Live AI verification remains deferred.

## Container build and production checks

The Dockerfile pins Node to `.node-version`, installs Chromium/FFmpeg/system fonts, builds as the unprivileged `node` user and runs under `tini` to forward signals and reap child processes. Its context is an allowlist: environment files, Git metadata, host dependencies, private state and uploaded documents are excluded. The `app` target includes the dependencies needed by the TypeScript worker and Remotion bundler; it is not a minimal static-web image.

```sh
npm run container:build -- --target test --tag reelchemy:verification
docker run --name reelchemy-production-checks --network none \
  --cpus 4 --memory 6g --pids-limit 512 --shm-size 512m \
  -e E2E_EVIDENCE_DIR=/app/artifacts/test-evidence reelchemy:verification
docker cp reelchemy-production-checks:/app/artifacts/test-evidence ./production-test-evidence
docker rm reelchemy-production-checks
```

The disposable test profile runs the built production server with fresh databases, an explicit authentication migration, production secure cookies, private test outbox and demo AI. A short-lived local CA signs its loopback HTTPS proxy; Node verifies that CA and Chromium trusts it only inside the disposable container user profile. An untrusted-client check must reject the same certificate chain. No TLS verification bypass is used. No mail worker or live provider is started, and runtime network access is disabled. Evidence copying excludes databases, pending verification mail, session secrets and TLS keys.

`container:build` uses a writable `BUILDX_CONFIG` directory. If the build environment supplies `NODE_EXTRA_CA_CERTS`, the wrapper validates it as public PEM certificates and passes it as an optional BuildKit secret for `npm ci`; the CA is not copied into the image. Registry, package TLS and lockfile integrity verification remain enabled. Allow disk capacity for Docker layers and the isolated dependency mirror; the VFS storage driver makes full layer copies and can need substantially more space than the displayed image size.

## Single-host service template

`compose.yaml` is a single-host template, not an internet deployment. First build `npm run container:build -- --target app --tag reelchemy:local`. Supply an operator-managed private environment file with an HTTPS `BETTER_AUTH_URL`, a stable strong `BETTER_AUTH_SECRET`, `SMTP_HOST` and `EMAIL_FROM`. Do not commit that file. `docker compose --env-file /path/to/private.env up -d migrate web render` runs the explicit one-shot authentication migration before web startup. Keep a coordinated backup before changing application/database versions.

Web binds only to host loopback. An external HTTPS reverse proxy, domain/certificate management, durable volumes, off-host backups and monitoring still need platform-specific configuration. Services use non-root users, read-only application filesystems, dropped capabilities, bounded resources and writable state volumes/tmpfs. The render worker has no external network and receives no authentication/provider/SMTP credentials through its environment. Never share its SQLite volumes across multiple hosts. Default request/render limits do not establish public load capacity.

The separate `smtp` profile enables the mail worker only when deliberately activated by an operator with verified SMTP configuration. SMTP credentials belong to that worker; web only queues account messages. Do not activate SMTP for local acceptance or restore drills. Without a mail worker, new users cannot receive their verification/reset messages. Live email delivery and public hosting remain unverified release gates.

After building the `app` target, run `npm run test:runtime -- --image reelchemy:local` (or `node scripts/check-runtime.ts --image reelchemy:local` on the pinned Node runtime). This creates a unique Compose project with private synthetic storage, probes migration/readiness and read-only/non-root restrictions, verifies render network/environment credentials, encodes and fully decodes actual footage/captions/AAC, rejects a second worker, and kills/restarts the render container during another job. Exactly one automatic retry must complete while retaining the first export. The command removes only its disposable services/volumes and leaves a private report or failure log under `/tmp/reelchemy-runtime-*`. It does not start a mail worker. This environment-credential check does not establish separate storage/process isolation for the current shared SQLite/filesystem adapter.

## Availability checks

- `/api/health/live`: HTTP 200 means the web process answers requests.
- `/api/health`: HTTP 200 requires the studio database, authentication initialization, writable data/export paths, the configured free-space floor and a render-worker heartbeat no older than 30 seconds. A failed check returns 503 and booleans only.
- This probe does not send mail, call an AI provider, prove SMTP delivery, guarantee capacity for another export or inspect artistic quality. An external monitor/alert destination has not been configured.

Keep one render worker per database. Start it with `npm run worker`. On Linux the entrypoint holds an exclusive kernel filesystem lock for the worker's lifetime; the kernel releases it even after a forced crash. `worker.lock` and the heartbeat contain instance diagnostics. Successful managed startup replaces stale managed diagnostics, and normal shutdown removes them. The coordination file `worker.lifecycle.lock` remains: never delete or replace that inode while any service could be running. It must be on the same local volume as the database; this is not a distributed/NFS lock design.

Stop the worker gracefully with SIGTERM/SIGINT and wait for exit; it records interrupted work for its bounded retry policy. When upgrading from an older plain-PID worker, first stop that old worker. Managed startup refuses to steal a live legacy PID or accept malformed legacy diagnostics. Never delete the database to clear a lock. Production rendering requires the Linux entrypoint and `flock` (`util-linux` in the container).

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
