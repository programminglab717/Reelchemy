# Reelchemy local storage operations

This runbook covers the current single-host SQLite/filesystem adapter. Managed storage, additional capacity/spend/abuse controls, staging, monitoring/alerts, retention, long-video benchmarks and creator acceptance still have open release gates. Live AI verification remains deferred.

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

`compose.yaml` is a single-host template, not an internet deployment. First build `npm run container:build -- --target app --tag reelchemy:local`. Supply an operator-managed private environment file with an HTTPS `BETTER_AUTH_URL`, a stable strong `BETTER_AUTH_SECRET`, `SMTP_HOST` and `EMAIL_FROM`. Do not commit that file. Stop the previous version's writers and take a coordinated backup before upgrading. `docker compose --env-file /path/to/private.env up -d migrate web render` runs the explicit combined studio/account migration before web startup. On VFS hosts, run/remove the one-shot first (`docker compose --env-file /path/to/private.env run --rm --no-deps migrate`), then start `web render` with `up -d --no-deps`, avoiding three full image copies at once.

Web binds only to host loopback. An external HTTPS reverse proxy, domain/certificate management, durable volumes, off-host backups and monitoring still need platform-specific configuration. Services use non-root users, read-only application filesystems, dropped capabilities, bounded resources and writable state volumes/tmpfs. The render worker has no external network and receives no authentication/provider/SMTP credentials through its environment. Accounts, signing-file material and queued mail use `studio-auth:/app/private-auth`, mounted by web/migration and mail services; the render worker mounts only studio data and exports. The mail service mounts only private authentication storage. Never share its SQLite volumes across multiple hosts. Default request/render limits do not establish public load capacity.

The separate `smtp` profile enables the mail worker only when deliberately activated by an operator with verified SMTP configuration. SMTP credentials belong to that worker; web only queues account messages. Do not activate SMTP for local acceptance or restore drills. Without a mail worker, new users cannot receive their verification/reset messages. Live email delivery and public hosting remain unverified release gates.

After building the `app` target, run `npm run test:runtime -- --image reelchemy:local` (or `node scripts/check-runtime.ts --image reelchemy:local` on the pinned Node runtime). This creates a unique Compose project with private synthetic storage, probes migration/readiness and read-only/non-root restrictions, verifies render network/environment credentials, encodes and fully decodes actual footage/captions/AAC, rejects a second worker, and kills/restarts the render container during another job. Exactly one automatic retry must complete while retaining the first export. The command removes only its disposable services/volumes and leaves a private report or failure log under `/tmp/reelchemy-runtime-*`. It does not start a mail worker. The check also verifies distinct account-volume mounts and probes that render cannot read account/key/mail canaries or write the private account directory. Executed outcomes are recorded in VALIDATION.md. Web-side ingestion and broader process isolation remain separate work.

## Availability checks

- `/api/health/live`: HTTP 200 means the web process answers requests.
- `/api/health`: HTTP 200 requires the studio database, authentication initialization, writable data/account/export paths, the configured free-space floor and a render-worker heartbeat no older than 30 seconds. A failed check returns 503 and booleans only.
- This probe does not send mail, call an AI provider, prove SMTP delivery, guarantee capacity for another export or inspect artistic quality. An external monitor/alert destination has not been configured.

Keep one render worker per database. Start it with `npm run worker`. On Linux the entrypoint holds an exclusive kernel filesystem lock for the worker's lifetime; the kernel releases it even after a forced crash. `worker.lock` and the heartbeat contain instance diagnostics. Successful managed startup replaces stale managed diagnostics, and normal shutdown removes them. The coordination file `worker.lifecycle.lock` remains: never delete or replace that inode while any service could be running. It must be on the same local volume as the database; this is not a distributed/NFS lock design.

Stop the worker gracefully with SIGTERM/SIGINT and wait for exit; it records interrupted work for its bounded retry policy. When upgrading from an older plain-PID worker, first stop that old worker. Managed startup refuses to steal a live legacy PID or accept malformed legacy diagnostics. Never delete the database to clear a lock. Production rendering requires the Linux entrypoint and `flock` (`util-linux` in the container).

## Create and verify a backup

Stop web, render and mail services before a coordinated backup. The command rejects an existing render-worker lock and snapshots containing an actively rendering job; it cannot prove that every web/mail writer has stopped. Pausing all writers is an operator precondition. The SQLite backup API produces a standalone snapshot of each database; copying live `.sqlite`/WAL files directly is not the backup procedure.

From the repository directory, with the same `REELCHEMY_DATA_DIR`, `REELCHEMY_AUTH_DIR` and `REELCHEMY_ARTIFACT_DIR` used by the services:

```sh
npm run backup -- create /path/to/new-private-backup
npm run backup -- verify /path/to/new-private-backup
```

The destination must not exist and must be outside all data/account/export source directories, including symlink aliases. Creation uses a private directory (0700), private files (0600), checksummed entries and a manifest written after copying. Creation verifies its result. Failures clean up only the new destination created by that operation; existing backups are never overwritten.

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

Restore returns separate `data`, `auth` and `artifacts` paths, including for legacy combined snapshots. Account files are relocated only in the new restored copy; the original installation/snapshot is preserved. Supply the returned paths explicitly in an isolated test instance:

```sh
REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_AUTH_DIR=/path/to/new-restore/auth \
REELCHEMY_ARTIFACT_DIR=/path/to/new-restore/artifacts \
npm run db:migrate

# Separate terminals, same paths/environment:
REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_AUTH_DIR=/path/to/new-restore/auth \
REELCHEMY_ARTIFACT_DIR=/path/to/new-restore/artifacts \
npm run worker

REELCHEMY_DATA_DIR=/path/to/new-restore/data \
REELCHEMY_AUTH_DIR=/path/to/new-restore/auth \
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

## Retained-media accounting

`REELCHEMY_MEDIA_STORAGE_BYTES` defaults to 536870912 (512 MiB), accepts whole byte counts from 1 MiB through 1 TiB and applies independently to each verified studio. The derived `media_sizes` table indexes actual regular-file lengths, while project ownership/references determine the studio's total; Trash is included and repeated references to the same asset count once. Legacy/snapshot references are indexed without altering project content or deleting files. Newly referenced files missing from the index are backfilled before admission; incoming/archive byte claims are not trusted.

Run `npm run db:migrate` with the service's data/artifact/auth environment while old writers are stopped, before starting web/render/mail. It initializes additive studio and auth migrations; `auth:migrate` remains available for auth-only maintenance. Keep the coordinated pre-upgrade snapshot. After an old-version rollback, restored legacy data or deliberate filesystem repair, `npm run db:migrate -- --recount-media` rebuilds the derived byte index from current references/files. Recounting is not media repair or deletion. Existing over-limit studios retain access to saved work; new bytes must fit. Quota is enforced transactionally across web processes, with cleanup of newly normalized files on rejected uploads/imports.

The allowance covers retained normalized media, not completed exports, scene caches, backup copies, transient ingestion storage or physical disk reservation. It does not isolate global decoder processes or meter provider money. Keep separate disk monitoring, retention, processing-capacity and spending gates open. Production readiness continues to require the free-space floor independently of any studio allowance.

## Private authentication cutover (0.23.0)

Fresh Compose volumes already use a separate private account volume. For native production, set `REELCHEMY_AUTH_DIR` explicitly outside both data and artifact roots; canonical path overlap is refused. The filesystem boundary comes from the container mounts. Merely using another directory in an unrestricted native process does not sandbox that process.

For an existing combined installation, stop **all** web/render/mail writers, create/verify a coordinated snapshot with the correct legacy source settings, and restore it to a new private root. Use the returned `data`, `auth` and `artifacts` directories as separate runtime mounts/settings. Copy only the corresponding restored contents into fresh service volumes with ownership matching the application's `node` user (UID 1000), directories 0700 and private files 0600. Do not overlay an old combined media volume or copy credentials back into media storage. Keep the original installation stopped for rollback. New production initialization rejects known `auth.sqlite`, `auth-secret` or `mail` leftovers in its media root.

Existing v1 snapshots remain supported; their offline private backup layout still contains `data/auth.sqlite`/`data/auth-secret`, while runtime restore relocates those files to the returned `auth` directory. Pending mail and environment secrets are excluded as before; request fresh verification/reset messages and retain the operator-managed raw signing secret/configuration separately. Restored sessions/tokens are revoked and pending jobs are failed, so users sign in and explicitly start a new export. Do not run an SMTP worker during a drill.

The `workspace:claim` maintenance script reads the configured account directory; assignment remains offline, explicit and dry-run by default. The production build checks both NFT traces and required-server-file manifests for media/account/environment paths. Actual current-image filesystem/service acceptance and public deployment are separate gates recorded in VALIDATION.md.

## Cold one-minute square render benchmark (0.26.0)

After building/selecting an app image, run this separately from other heavy verification on a small host:

```sh
node scripts/check-runtime.ts --image reelchemy:local --benchmark-square-minute
```

The optional case uses fresh synthetic Compose volumes and a cold cache. It generates a 60-second 1080×1080 timeline with three 20-second scenes, normalized moving footage/source audio, a rotated image badge, text/shape layers, a separate narration-tone track and 30 caption cues. It runs the actual worker under the standard 2 CPU, 4 GiB and 256 PID limits, verifies 1800 H.264 frames/30 fps/60-second duration plus AAC, and fully decodes the result. A restart, retry or failed export does not count as a passing cold benchmark. It preserves a private copy of the export and a report under the printed temporary evidence directory, then removes only its synthetic services/volumes. No mail worker, paid provider or actual user storage is used.

The report identifies the immutable image and resource limits, includes five-second Docker memory/PID/CPU samples, and reports elapsed time from enqueue through full decode/polling (fixture ingestion and service startup are excluded). Docker memory usage may exclude inactive file cache; sampled peaks can miss spikes and do not include the later full-decode phase. The enforced container limits remain independent. This one synthetic cold export is not a throughput/concurrency guarantee, a 1080p landscape/portrait result, five-minute support or artistic/creator acceptance. Keep supported limits unchanged until their own representative benchmarks pass. The ordinary runtime-check command retains its separate small export/forced-crash acceptance path.

## Media reference indexes (0.27.0)

The additive `media-reference-index-v1` migration backfills `project_media_refs` and `job_media_refs` from retained upload metadata, current/historical timelines and immutable export snapshots. Only valid normalized file identifiers enter these tables. Project/job inserts, replacements, updates and deletes maintain them atomically through SQLite triggers, including writes from earlier application versions. They are derived data; the source project/job content is preserved.

`npm run db:migrate -- --recount-media` now rebuilds both the byte-accounting and reference indexes. Use it after deliberate derived-table repair or the documented legacy/rollback maintenance. The command does not repair missing media, erase projects, delete files or establish backup retention. Permanent deletion remains a separate workflow under development; Trash continues to retain its contents and storage allowance.

## Permanent project cleanup (0.28.0)

Only a verified owner can request removal of an already-trashed project, with the literal DELETE confirmation. The private per-project receipt survives cleanup for idempotent retry; completed receipts drop the project name and file manifest. Listings/ownership checks hide pending requests, and versioned SQLite guards prevent restoring/reusing their IDs, moving their snapshotted jobs or inserting references to files reserved for deletion. Guard initialization and reference/byte metadata updates are transactional.

The existing single worker processes cleanup **between exports under its permanent kernel lifetime lock**, after browser/media/FFmpeg cleanup. It reserves only files with no other current/historical/project/job reference. Validated UUIDs, stable directory descriptors on Linux and no-follow handling constrain cleanup to normalized asset entries, known job directories and the studio cache namespace. It never trusts paths from a render report. Shared uploads/history/job sources and other projects' finished exports are preserved. Media directories/symlinks or permissions that fail validation leave a durable hidden request with safe errors; ordinary symlink entries are unlinked without following their targets.

A stopped/crashed in-progress request resumes idempotently. I/O failures back off and stop after three attempts; repair the configured roots/permissions, then use Retry cleanup. Queued work can continue between retry delays. Do not manually remove reservations or disable guards while writers could run. A media recount is refused while files are reserved; finish cleanup first. Preserve the worker lifecycle lock inode. Database rows/receipts commit after filesystem cleanup; retained-media quota stays charged until completion. SQLite secure_delete plus best-effort WAL truncation reduce active remnants but do not erase older backups or filesystem snapshots.

Coordinated backup still requires all writers/workers stopped. A newly created snapshot privately omits pending/failed-removal project/job records, drops unneeded byte-index entries, completes their copied receipts without names/manifests, and vacuums that snapshot before collecting files/checksums. The live installation is unchanged. This avoids resurrecting requested removals or requiring missing partially cleaned files on restore; other/shared media is still copied. An inconsistent owner/Trash state fails backup rather than omitting unrelated content. Historical snapshots are not automatically deleted by this tool. Account erasure, backup retention/off-host policy, global cache/metadata budgets and production monitoring remain separate release work.

Static-scene capture reuse is automatic only for an explicit reviewed list of still primitives, no camera/layer keyframes or animation, and cut transitions (or both fades disabled). A scene must avoid at least 90 redundant captures and have at most eight caption states. Other scenes use ordinary frame rendering. The worker creates a private temporary capture directory inside its cache staging entry, captures actual scene/caption states, fills the bounded frame sequence with hard links and encodes all frames through cancellable FFmpeg. Temporary captures are removed in `finally`; incomplete cache entries are not published. QC/cache manifests record captured/total frames for new optimized clips. Cache fingerprints include the static classifier/renderer, and checksums stream video bytes rather than loading the entire clip.

`npm run test:runtime -- --image <immutable-image> --benchmark-static-minute` runs a separate cold three-card square-minute case under the standard 2 CPU/4 GiB/256 PID limits. It can also run an older compatible app image as an ordinary-rendering baseline. Keep the fixture/source checkpoint, actual image IDs and resource reports for both runs, and compare identical workloads. Its results do not replace moving-footage, five-minute, native-1080-source, concurrency or artistic acceptance. The existing `--benchmark-square-minute` moving-footage fixture remains separate.

Studio media reuse retains the same normalized asset ID in another project of the same verified workspace. The new private `/api/workspace/assets` listing returns bounded retained metadata from active projects only, deduplicates IDs in SQLite, and excludes full histories/messages and unsafe legacy fields. `/api/projects/[id]/assets/link` accepts only a selected source project/asset, rechecks owners and activity inside an immediate transaction, measures the existing regular file and applies the existing per-project/media-accounting controls. It never takes client asset metadata or copies/decodes media. An already-retained target asset replays without consulting or disclosing the supplied source. Ordinary write limits apply; the smaller upload/decoder allowance is not spent. Existing global reference indexes keep a shared file alive during source-project cleanup, and backups/portable projects retain the target's media normally. This is a per-account library, not cross-customer sharing or a stock-media provider.

### Ingestion worker

`npm run ingest:worker` starts the durable media-request consumer with its own Linux `flock` lifecycle lock. The Compose `ingest` role has only the studio-data volume, no network, a read-only root, two CPUs, 2 GiB memory and 256 PIDs. It has no account/artifact volume or provider/SMTP credentials. Image/audio/video uploads, archive imports and uncached waveform preparation now enqueue durable work here. Web handlers read bounded bodies and retained cached waveforms; they do not invoke the media codecs. Existing upload/import clients retain a 201 result by waiting on the queue; asynchronous clients can request a 202 receipt. New immutable-image and production browser acceptance are recorded separately in VALIDATION.md; configuration alone does not prove a deployed role boundary.

Keep `ingest.lifecycle.lock` permanently: never unlink or replace its inode. `ingest.lock` is diagnostic state; clean shutdown removes it and the heartbeat. Managed restart under the kernel lock recovers one interrupted attempt, cleans registered uncommitted outputs and retries at most once. A second interruption fails with a private fixed receipt. Do not bypass the entrypoint with `scripts/ingest-worker.ts`.

Stop the web, render, ingestion and mail services before a coordinated backup. Backup refuses an existing ingestion diagnostic lock; after a crash, inspect the actual worker/process lineage before handling stale diagnostics. Raw input spools and waveform caches are excluded from portable backups. Only the new private snapshot/restore copy cancels unfinished media requests and releases their copied reservations, so restored jobs cannot run without input files. The live source is unchanged. Pending project erasure also removes media-request metadata from the snapshot.

## Provider usage and estimated spending

Live `/plan` requests require `REELCHEMY_AI_INPUT_USD_PER_MILLION` and `REELCHEMY_AI_OUTPUT_USD_PER_MILLION`, positive plain decimal USD amounts with at most six fractional digits. Set them for the exact selected provider/model/gateway when enabling live planning; no rates are inferred from a model name. Cache reads default conservatively to the normal input rate, and cache creation to twice that rate; set `REELCHEMY_AI_CACHE_READ_USD_PER_MILLION` / `REELCHEMY_AI_CACHE_WRITE_USD_PER_MILLION` explicitly when appropriate. These values belong on web only. Keys and real model quality remain a final live-verification gate.

Defaults are $20 shared / $2 per studio over a rolling 24 hours, two shared in-flight calls / one per studio, a 128 KiB serialized request ceiling, and 100,000 retained request receipts. Configure the `REELCHEMY_AI_*` values in `.env.example` / Compose; a zero spending allowance pauses live requests. Missing/invalid pricing, full ledger capacity, unavailable budget persistence or excess admission fail before fetch, while manual work and demo planning remain available. Ordinary planning/write attempt windows still apply.

The reservation uses serialized UTF-8 request bytes plus protocol headroom and the maximum input/cache rate, together with the 6,000-token output cap. This is a conservative application estimate, not an exact tokenizer or an external billing guarantee. Provider-reported token usage replaces the hold using the original price snapshot, rounded up once to integer micro-USD. Anthropic input/cache categories and compatible prompt/cache/output counts are validated separately. Actual reported estimates above a reservation are recorded in full and constrain later admission. A provider's invoice, hidden protocol overhead, pricing changes or unsupported surcharges can differ; configure the provider account's own spending control as well before public use.

Malformed/missing usage, HTTP/transport errors and interrupted calls retain their full spending hold. After 90 seconds a crashed call releases its concurrency slot, while its cost hold persists even after the rolling window advances. No paid operation is resumed or automatically retried. A successful response with missing usage can still produce a valid storyboard, but keeps its uncertain hold. Usage is recorded before creative/CAS/Trash validation, because an unusable or stale result may still be billable.

`npm run ai:usage -- [--workspace ID]` opens the configured studio SQLite file read-only and reports provider-price estimates, operator-confirmed charges, outstanding holds and up to 20 expired unresolved request IDs. It does not initialize/migrate the database or load authentication/provider credentials. To resolve a hold, first verify its actual charge or confirmed absence of a charge with the provider, then run `npm run ai:reconcile -- --request UUID --confirmed-usd AMOUNT`. This explicitly records operator confirmation only for an unresolved call outside its active deadline; it refuses to change known or already-reconciled receipts. Never clear unknown holds by deleting rows or resetting the database. Reconciliation is an operator CLI, not a customer API, and no real workspace reconciliation has been run during development.

The ledger stores workspace/request IDs, provider/model fingerprints, timestamps, price snapshots and numeric usage/costs. It contains no prompts, source files, raw responses, keys, account emails or project IDs. Settled records are immutable and are not automatically deleted; reaching the configured row cap requires operator-reviewed archival/retention work before raising capacity. Account erasure, historical snapshot retention, external invoice integration and customer billing remain separate work. Backups preserve receipts and outstanding holds; restoring a snapshot does not resume paid calls or reset their cost accounting.

## Derived scene-cache maintenance (0.40.0)

The Linux render consumer checks the dedicated cache before claiming a job, after each export and periodically while idle, under its existing permanent `worker.lifecycle.lock`. The Compose renderer alone receives the four `REELCHEMY_SCENE_CACHE_*` settings. Defaults are 1 GiB shared, 256 MiB per studio, 5,000 completed clips and seven days. Entries expire by successful validation/use time; least-recently-used entries then satisfy studio/shared byte and entry ceilings. Known interrupted `.partial-UUID` captures are removable only while that render lock is held. Active rendering can exceed the steady-state budget until it finishes; separately provision and monitor temporary output, completed exports, database/history and backups. This policy is not a total-volume disk reservation.

Inspection is bounded to 100,000 directory/file entries and 15 seconds. The planner inspects an allowlisted closed tree without creating state. Applying it rechecks root/tree identities before unlinking only known derived files through anchored directories. Existing compatible cache trees receive a small private ownership marker after validation. Unknown entries or unsafe symlinks are preserved and block admission. Never point the cache at data/account roots, upload/input/waveform/mail directories or completed-export directories. A fresh heartbeat with `ready: false` is not healthy: `/api/health` and the render health check stay not ready while cache attention is required. The process remains alive, preserves queued jobs and retries maintenance after a bounded backoff. Source uploads, saved projects and finished exports are outside cache eviction.

Run `npm run cache:prune` with the same explicit directory/limit settings as the renderer to view private aggregate counters; it does not initialize or migrate SQLite/authentication or create a lock. Stop all render producers before `npm run cache:prune -- --apply`. Apply takes the exact existing lifecycle inode and refuses an active kernel owner or live legacy PID. Inspection can observe an active tree and may refuse if it changes; apply always rescans while locked. No command unlinks/replaces the permanent inode. `npm run render:sample` now joins this same lock, uses the configured artifact root and waits for native cancellation cleanup.

When blocked, stop render producers, inspect the explicitly configured cache location and policy, and preserve unknown files. Move the old cache tree to a private quarantine and choose a new empty dedicated location if its ownership/layout cannot be established. Correct permissions, symlinks or policy configuration before restarting; do not erase source/export folders to make readiness green. Project erasure may remain pending/failed when its cache scope is unsafe; after repair use its existing explicit retry. A retained cache can be rebuilt from project inputs, whereas finished videos and creative data have separate deletion/retention procedures. No actual installation's cache is migrated or cleaned by this development checkpoint.

## Prepared video renderer

The complete `npm run build` compiles and seals the video composition under the configured Next `distDir`. Preserve it alongside `BUILD_ID`; copying only `.next/server` is insufficient. Production workers verify the bounded manifest, file sizes/content hashes and build identity before readiness or claim. Hashes detect damaged/mixed builds; the complete directory must remain in the trusted read-only image. There is no production fallback to runtime compilation or flag that skips verification. Repair invalid assets by rebuilding/replacing the application image and restarting workers while retaining data/auth/artifact volumes and the permanent lifecycle lock inode. Never rebuild into a running worker's build directory.

Production exports need no runtime compiler cache. Development/test compilation remains separate. `REELCHEMY_NEXT_DIST_DIR` must match the application build, including for the sample renderer. This change does not clear existing caches or user media. Immutable-image acceptance still requires a healthy Docker host; mounted-source checks remain separate evidence.

`npm test` prepares one isolated real composition when native-render test files are selected. Their workers use the verified production path, and the harness removes only its own temporary fixture after all children stop. Pure backend selections do not incur that compilation. This keeps native acceptance independent of competing cold development compilers without raising resource limits or extending assertions.

## Retained project data admission and reviewed cleanup

Keep the seven `REELCHEMY_PROJECT_*`, `REELCHEMY_STUDIO_*` and `REELCHEMY_SERVICE_*` project-data settings in `.env.example` consistent on web and ingestion. Compose supplies the same project policy to those two writers; the codec worker still receives no account/provider/mail credentials. Defaults: project 32 MiB, studio 256 MiB, service 4 GiB; studio 500 projects, service 20,000; project 10,000 versions/messages. Whole-byte ranges are 1–256 MiB per project, 1 MiB–16 GiB per studio and 1 MiB–1 TiB shared, ordered project <= studio <= service. Studio project count is 1–10,000 and shared count 1–100,000. Versions are 2–10,000, messages 3–10,000; zero/invalid/inconsistent policies fail closed and make readiness unavailable.

An additive census/SQLite-trigger index measures UTF-8 project JSON, including unknown retained legacy fields. Atomic immediate transactions enforce growth/count admission; Trash and pending removals remain charged until their project row is deleted, and the shared budget also includes unassigned legacy content. Old overages are retained/readable, reductions remain allowed, and no automatic history deletion occurs. Shared usage is not exposed to studios. Planning refuses already exhausted budgets before contacting a provider or reserving usage; the exact generated data is checked again at commit. A concurrent edit/output size can still prevent a plan from saving after a billed call, as with existing CAS conflicts; actual reported usage remains accounted.

The authenticated retention endpoint returns indexed owned usage or an explicit cleanup preview. Apply requires explicit confirmation and the exact full-data/selection digest, rechecks activity/ownership/deletion intent under the writer lock, and keeps the latest saved revision/current film. One small receipt per project permits an uncertain apply to replay safely after later edits without handing the caller a newer CAS base. Unknown/corrupt stored receipt fields fail privately. No-op cleanup preserves exact raw formatting. The online preview bounds legacy documents to 64 MiB; unusually large/corrupt legacy histories require an operator-assisted backup/recovery, never blind deletion.

Only historical versions/messages are removed. Current timelines, uploads/provenance, immutable jobs/exports and unrelated projects stay intact. Studio usage widgets and editor history metadata refresh without replacing unsaved edits or their saved base, and retained display numbers restart from one. Cleanup reduces accounted logical bytes, not necessarily the allocated SQLite/WAL file size; SQLite maintenance and historical backup/forensic erasure remain separate work. Jobs/exports, binary-media service-wide ceilings, normalized history storage, account erasure and backup retention still need their own limits/operations. No actual workspace is upgraded by this code-only milestone; before upgrading real data, take/verify a coordinated backup and stop writers/consumers under their permanent lifecycle locks.

On the constrained verification runner, selections containing native render fixtures compile one real prepared composition and schedule test files serially. Pure file selections still use two-file concurrency; explicit concurrent-process admission/race tests are unchanged. No render resources, retry/backoff or assertion deadlines are raised. A reviewed unsaved narration take remains available while managing history, so an exhausted project allowance can be reduced before retrying its upload; active capture/upload still blocks opening that dialog.

## Shared source-media ceiling and storage visibility

Set `REELCHEMY_MEDIA_SHARED_STORAGE_BYTES` identically on web and ingest. Default 8 GiB; accepted range 1 MiB–4 TiB and no lower than `REELCHEMY_MEDIA_STORAGE_BYTES`. Invalid/disabled/inconsistent settings fail readiness and ingestion startup. New upload admission checks both project-data and shared binary capacity after scoped receipt replay and before receiving input; imports preflight project-data/count capacity while asset-free imports remain usable at a full binary store. Final normalized attachment rechecks exact bytes inside the same SQLite transaction as project update and receipt completion. The admitted shared ceiling is retained in an additive queue column, and a restarted consumer uses the stricter of its current ceiling and the admitted value; legacy null snapshots fall back to the current policy.

The `retained-media-size-census-v2` migration measures current/history/job references, deletion targets and previously indexed sources without changing documents or deleting files. Historical/job-only references also count toward their owning studio. Known unassigned sources remain charged globally; unknown files are preserved outside this index. New registrations and confirmed deletion update the same counter. Existing overages remain readable, and zero-added-byte reuse/import stays available. Temporary registered decoder output is outside the retained counter until attachment, so this is a steady-state known-source budget, not a physical-disk reservation. Existing raw-input/decoder ceilings and single-consumer cleanup remain enabled. Choose storage capacity for retained sources plus raw/normalized staging, exports, cache, database/WAL and backups.

Late saturation rolls back the attachment, removes only registered unreferenced outputs and returns a private service-capacity receipt without exposing other studios' totals. Project-data refusal is reported as capacity rather than malformed media, retaining the chosen file/take for retry after history/project cleanup. No SMTP/provider credential enters this consumer.

Read-only operator inspection:

```sh
npm run storage:usage
npm run storage:usage -- --workspace <workspace-id>
```

The CLI opens an existing regular private database read-only, requires the current census markers/index completeness, and never creates tables/directories/accounts/signing files or follows a database/root symlink. The report includes logical project bytes/counts, indexed distinct source bytes, and raw receiving/processing reservations. It excludes names, prompts, media contents, credentials and filesystem paths. Back up and coordinate migrations/census under the existing maintenance/lifecycle procedure when an index is unavailable; this report does not repair or delete anything. Production checks now retain `test-results/results.json` alongside their ordinary console report, and the evidence copier preserves it before removing disposable dependencies. Immutable-role-image acceptance remains a separate Docker-host gate.

### Private download delivery

The supported Linux runtime streams source media and completed MP4/thumbnail/allowlisted evidence responses using one pinned file descriptor and pull-driven 64 KiB reads. GET accepts one satisfiable byte range; malformed/multipart/unsatisfiable ranges return private 416. HEAD returns full representation metadata without opening a body. These no-store responses issue no representation validator, so requests with If-Range receive the full representation. A cancelled or disconnected request closes its descriptor. File size/modification changes interrupt the transfer with a fixed error; a later authenticated request can retry.

Configured media/artifact roots and their ancestors must be real directories rather than symbolic links. Directory traversal is anchored through Linux /proc/self/fd with no-follow/nonblocking opens; symbolic pointers, pipes, nonregular and missing files return private 404. Use canonical volume mount paths in Compose. This improves web transfer memory and file safety; completed-export byte/count admission and retention remain separate work.

### Export-history browsing

The editor fetches 20 private summaries per page, opening the selected report separately. Older/newer navigation preserves its current view when another export is appended; Refresh export history starts a fresh view. Invalid/changed cursors fail privately and can be refreshed. Cursors are encrypted/authenticated with a domain-separated authentication signing key and bound to the studio, project, purpose and anchor; they confer no resource authorization. Rotating the signing key invalidates open paging tokens and requires refresh. Development reads an existing private signing file without creating one; production uses the required authentication secret. Renderer/ingestion roles still receive no authentication mount or key. The legacy GET render-list API continues to return its recent 30 full records for compatible clients. Retained reports/files, export budgets and cleanup are separate work.

### Native browser startup and release

The render worker launches Remotion's native browser through the immutable executable `scripts/render-browser-launcher.sh`. Preserve its executable mode when packaging. Temporary storage holds only a 0700 pinned configuration directory with 0600 data files. An internal launch control argument is removed before Chromium starts, preserving its normal user agent; no temporary executable code or noexec exception is required. The child receives a unique attempt marker without modifying the worker's global environment. Startup and normal cleanup identify only marked/recorded native descendants with PID start-time checks, stop them within bounded TERM/KILL phases, and close the held descriptors.

The launcher records the generated native profile's device/inode before execution. Cleanup waits for owned processes to stop, validates the registered temporary namespace and original directory identity, and removes the profile through a held no-follow directory descriptor. Replaced roots, external symlinks and unknown launcher entries cannot redirect deletion; unsafe cleanup produces a fixed terminal error and preserves unexpected data for review. Permanent worker lifecycle lock files are never removed by this cleanup.

Only the dependency's recognized native connection-start timeout joins the existing at-most-one automatic render retry. The 25-second connection timeout, total render deadline and CPU/memory/PID/storage controls remain unchanged. Cancellation, QC failures, invalid/missing executables and cleanup errors do not gain retries. Review repeated native-start failures and worker logs before raising supported video limits or making capacity claims. This improves per-attempt lifecycle handling; it is not immutable three-role image, public load, hosting or creator acceptance.

## Reviewed export file cleanup (0.48 candidate)

Open a terminal export, choose **Review export file removal**, download anything needed, review its exact count/logical bytes, and type **REMOVE EXPORT**. Confirmation makes its file routes unavailable immediately. The render consumer removes only that reviewed export directory between jobs; saved projects, versions, original media and job metadata remain. Retry a lost response from the same review. Private receipts survive refresh; a failed request can be reviewed again. A cancelled export stays ineligible until its native attempt closes. At most five removals per studio/fifty service-wide can be pending; reviews have one studio/two shared slots, a 15-second read deadline and 30-second crash lease. A review accepts at most 2,048 allowlisted flat generated files and 1 GiB logical bytes. Unsupported/larger trees require offline operator review; there is no public recursive fallback. Cleanup attempts have a 30-second deadline and at most three automatic attempts with backoff. One removal precedes each ordinary render turn.

Upgrade only with a coordinated stop of web/render/ingestion writers and a new verified backup. Do not mix older untracked render consumers with the cleanup API. Lease recovery requires the permanent kernel lock **and** readable same-UID native-process metadata: marked Chrome/FFmpeg descendants surviving a crashed consumer cause readiness to remain false until they stop. Inaccessible process metadata fails closed. The render consumer also verifies its marked children have stopped before releasing each job’s lease; it exits rather than enabling cleanup if teardown is uncertain. Never remove lifetime lock inodes. This candidate has not upgraded actual workspace data.

New backups omit files for every cleanup intent, including pending/failed requests, and complete receipts only in the copied database. Such backups use version 2 with capability `removed-export-files-v1`; upgrade restore tooling before using them. Version 1 snapshots without removal receipts remain supported. Verification refuses absent capability metadata, foreign/orphaned cleanup context and removed-job payload files. Historical backups made before consent may still contain those exports; operators must handle their separate retention. Logical cleanup is not forensic erasure of database pages, old snapshots, open readers or downloads.
