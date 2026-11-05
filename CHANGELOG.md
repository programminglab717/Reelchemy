# Changelog

## 0.1.0 — 2026-10-27

### Milestone 0: working foundation

- Initialized Next.js/React/TypeScript, SQLite schema, a restricted Zod scene DSL, deterministic animation, local artifact storage, and a separate render worker.
- Added Chromium/Remotion/FFmpeg rendering with H.264 output and strict ffprobe checks.
- Produced a real five-second multi-layer, three-scene sample, stills, per-scene motion clips, and a technical QC report.
- Removed automatic audio muxing for this silent-export stage after verification detected padded container duration.
- Added unit, provider-adapter, E2E, type, lint, and production-build checks.

### First creation flow: early Milestones 1–3 and scene editing

- Added a responsive studio, idea composer, recent projects, no-key demo director, saved conversation/revisions, storyboard approval, shared live preview, and MP4 download.
- Added typography/orbit, parallax landscape, diagram/node, and rectangle primitives with fade/rise/drift/pulse motion. These are extensible scene primitives; the demo plan itself uses a fixed three-scene example.
- Added queue snapshots, progress, cancellation, structured worker logs, manual export retry, persisted text/accent edits, and scene reorder.
- Added server-only OpenAI-compatible provider adapter with mocked response/credential tests. No real external provider is configured or validated.
- Added static QC and one-pass local bounds correction with before/after evidence. Automated visual/temporal review remains open.
- Added three seeded demo projects and JSON examples. See README for remaining product scope.
- Updated Remotion packages together to 4.0.539; unified Zod on 4.6.7+ to resolve a vulnerable transitive version.

## 0.2.0 — 2026-10-28

- Added native Claude Messages support (mocked API validation), scene-local revision with stable timing/IDs, concurrency conflict detection, preserved original briefs, and non-destructive version restore.
- Added scene duration/format/transition controls, duplication/deletion, layer geometry/text/color editing, and deterministic custom keyframe interpolation with schema constraints.
- Added Chromium-based text measurement using shared rendering styles, two-pass localized font repair, before/after layout evidence, full-file decode checks, and allowlisted evidence downloads. Layout diagnostics do not claim semantic or temporal approval.
- Verified 12 unit/layout tests; three browser tests passed for the creation and revision/restore flow before the new QC worker restart.

## 0.3.0 — 2026-10-28

- Added PNG/JPEG uploads with byte/pixel limits, decoder verification, metadata-stripping PNG re-encoding, sanitized names, and source/rights metadata.
- Added image layers shared by preview/export. Workers resolve immutable local files into data URLs; render payloads cannot fetch remote asset URLs. Project edits reject references to other projects' assets.
- Added persistent export history, QC report links, scene snapshot galleries, per-scene motion playback, and cancellation/access regression coverage.
- Added event-driven stills for up to eight custom-keyframe events per scene and checks for motion keyframes outside canvas bounds.
- Verified image upload/edit/export in Chromium with actual encoding. A corrupt test PNG was correctly rejected; replaced the fixture with a decoder-generated PNG.
- Final validation: 13 unit/layout/asset tests and 5 production browser tests passed; production build, lint, type checking, formatting and dependency audit passed. Pixel evidence confirms the uploaded image appears in the rendered scene; export history survives refresh.

## 0.4.0 — 2026-10-28

- Added validated local audio uploads (WAV/MP3/Ogg/FLAC/AAC), normalization to 48 kHz stereo PCM, timeline trimming, delayed start, gain, fades, multi-track AAC mix, peak analysis, and duration verification. Existing silent projects remain silent.
- Added frame-based caption editing, burned captions shared by preview/export, and SRT/VTT downloads with validated non-overlapping cue timing.
- Added editable ZIP export/import for project data, conversation, revisions and uploaded assets. Import validates bounded entries and asset bytes, remaps IDs and creates a separate project; it never overwrites the source project or extracts arbitrary paths.
- Added streaming request limits for JSON and multipart uploads.
- Validation: 18 unit/layout/media/archive tests passed; six full browser tests plus the dedicated portable-project browser test passed. Real audio/browser export measured AAC duration 5.000 seconds and peak -22.5 dB. Live AI remains deliberately deferred.

## 0.5.0 — 2026-10-28

- Added bounded retries for transient browser/media timeouts, persisted stage/activity logs, immutable terminal job states, transactional queue admission, and restart recovery from saved job inputs. Each job gets at most one automatic retry.
- Added cancellable/timed FFmpeg subprocesses with bounded logs, per-attempt job deadlines (10 minutes by default, clamped to 1–15 minutes), and isolated SQLite queue tests.
- Added content-addressed scene video caching, renderer/browser/source/asset/caption invalidation, checksum verification, atomic partial-directory publication, and final concatenation before audio mixing. Changing one scene can reuse the other encoded clips; still evidence is recaptured for each export.
- Added focused scene-only preview using original timeline frames/audio/captions, generic character/arrow/gradient primitives, camera keyframes and event sampling.
- Added declared-background contrast and caption-speed warnings, plus audio peak/near-silence warnings. These are technical heuristics, not semantic or perceptual quality approval.
- Unit validation: 25 passing tests, including actual subprocess termination, persisted queue recovery, audio analysis and cache-corruption regression. Full browser validation is recorded in VALIDATION.md after the final run.
- Reconnected after a transport outage, confirmed preserved source/state, and committed the recovered feature checkpoint. Final restored-instance validation passed all 25 unit tests and all 8 production browser tests; the production rebuild is free of the dynamic-filesystem trace warnings.

## 0.6.0 — 2026-10-28 (public-account foundation)

- Confirmed public multi-user release scope; revised the production plan to include account lifecycle, tenant isolation, abuse prevention and public-service operations. Live AI verification remains deferred.
- Added Better Auth email/password accounts, verified-email access, password reset/session revocation, database-backed auth rate limits and sign-in/sign-up/recovery UI.
- Added private per-account studios and server-side resource guards across every project, asset, job, evidence, archive and download endpoint. Normal saves cannot transfer ownership. Render caches are partitioned by workspace; private media is served without browser caching.
- Preserved unassigned legacy content behind offline owner assignment and created a pre-migration SQLite backup. Imports create a new project in the signed-in user's workspace.
- Added a private durable mail outbox and separate SMTP worker; development consumes local mail without external credentials. Production rejects file mail, missing signing secrets and non-HTTPS auth origins. SMTP requires TLS.
- Added isolated browser-test services with fresh data, auth and mail for repeatable tests without weakening rate limits or touching saved projects. Disabled development request logging so verification/reset token URLs are not printed.
- Validation results are recorded in VALIDATION.md after the complete account/editor/render suite finishes.
- Completed validation: 28 unit tests and all 10 isolated development browser tests passed, including the authenticated video creation/export workflows. Production build, lint, type checking, formatting and audit passed; real SMTP/HTTPS staging and public production operations remain unverified.
- Strengthened private-file tests with a real image and completed export/evidence, all owner-positive and cross-account-negative checks passing. Fixed isolated test-service refresh loops with a temporary source/dependency mirror and fresh test-only secrets. Hardened authentication database permissions; final unit count is 29 passing tests and the final production rebuild passed.

## 0.7.0 — 2026-10-28

- Added manual blank projects, bounded undo/redo across saves, serialized debounced autosave, save-before-navigation/sign-out, unload protection, and explicit local-draft handling for save failures/conflicts.
- Timeline PATCH and version restore require a base revision. SQLite transactions reject stale revisions with HTTP 409 and retain concurrent uploaded asset metadata; delayed save responses preserve later browser edits.
- Added a shared-renderer arrangement canvas with layer selection, pointer drag/resize, keyboard nudging, edge/center snapping, alignment, stacking and lock/hide controls. Hidden artwork is omitted from preview/export and visual QC; locked layers remain visible.
- Added a zoomable timeline with frame scrubbing, selectable timed scene blocks and audio/caption timing bars. Direct media-bar trimming, scene split and waveforms remain unfinished.
- Added visual layer/camera keyframe markers and frame/offset/scale/opacity controls, including add/remove/reset. Advanced JSON remains available and validates scene timing.
- Kept live AI verification deferred. This checkpoint develops the manual editor; it does not complete the public-production acceptance gates. See VALIDATION.md for executed checks and limits.

## 0.8.0 — 2026-10-29

- Added validated MP4/MOV/WebM ingestion, bounded 30 fps H.264/AAC normalization, private range requests, asset reuse and editable video layers with source in/start/duration/fit/volume controls.
- Added job-scoped loopback footage delivery for rendering, byte-based cache fingerprints and explicit source-audio mixing. The first embedded-video approach failed in real rendering; footage no longer travels in data-URL query parameters.
- Added scene splitting that preserves global timing, clip source frames, custom/camera poses, preset phase and outer fades; empty/background-only scenes are now supported.
- Added direct video/audio/caption track movement/trimming with pointer/keyboard controls, source/scene/caption bounds and gesture-level undo. Numeric controls remain available.
- Extended portable archives to revalidate/remap footage and retain source audio; export now enforces the importable compressed-size cap. Internal re-ingestion accepts bounded normalized image/audio sizes while public upload caps remain unchanged.
- Live AI verification remains deferred; project duration/output-size caps remain unchanged pending benchmarks. See VALIDATION.md for executed evidence rather than treating implemented controls as production acceptance.

- Final 0.8 validation: 44 unit tests, the full 17-case isolated browser suite, and two post-correction export checks passed. Fixed a reproduced delayed-source-audio timing defect; added mobile footage and real cache-reuse checks. Build/lint/type/format/audit passed, with zero audited vulnerabilities.

## 0.9.0 — 2026-10-29

- Added bounded UTF-8 SRT/WebVTT import with a preview, explicit merge/replace, frame quantization, cue/overlap validation and undo. Current captions can be downloaded before rendering. Unsupported subtitle positioning/styling is rejected explicitly; supported inline formatting is converted to plain text.
- Added shared preview/export caption appearance controls for font, size, weight, colors, background opacity, alignment, safe-edge margin and vertical position. Every cue receives a Chromium clipping check; caption styles are carried into scene rendering/cache keys and portable archives.
- Added microphone narration through a bounded AudioWorklet/PCM WAV path: explicit permission, input meter, take review, download, upload retry, source-rights metadata, recording limits and cleanup. Navigation/sign-out protect an unsaved take. Automated recording uses Chromium synthetic input, not a real microphone usability test.
- Added private source waveforms to audio/video timeline bars. Waveforms follow source trims and clip gain, preserve leading source silence, use bounded FFmpeg extraction and a bounded cache, and never claim to represent the final mixed output.
- Added project-name search, paginated loading, metadata compare-and-swap renaming and preservation of newer names during delayed timeline revisions. Added mobile project reopening/search and visible sign-out.
- Added public liveness/readiness probes, a render-worker heartbeat, graceful heartbeat/lock cleanup, readiness checks in isolated test startup, and a GitHub Actions check workflow. The workflow is configured but has not been run on GitHub.
- Live AI/SMTP checks and public deployment remain deferred. Local checks and remaining release gates are recorded in VALIDATION.md and PRODUCTION_PLAN.md.

## 0.9.1 — 2026-10-29

- Added admin-only private SQLite/media/export backup, checksum/integrity/reference verification, and restore into a new installation directory. Database snapshots use the SQLite backup API and standalone journal mode, rather than copying live WAL files.
- Restore preserves the source, revokes copied sessions/reset tokens, marks pending exports failed for explicit restart, and rebases saved export paths. Existing targets, traversal, source-directory aliases, symlinks, unexpected files, corrupt media copies and missing references are rejected.
- Added an operations runbook with coordinated writer shutdown, inclusion/exclusion rules and local restore steps. Off-host encryption/delivery, scheduling, retention and production RPO/RTO remain unconfigured.
- Executed a real local snapshot and separate restore of 558 files (146,108,046 bytes), alongside an account/media/authentication regression drill. See VALIDATION.md for final counts and full browser evidence.

## 0.10.0 — 2026-10-29

- Added text content/size and font-family, weight, alignment, line/letter spacing, italic and underline controls in the canvas inspector, with matching layer controls, locks, autosave, undo/reset and portable preservation.
- Preview/export and Chromium text QC share the exact typography styles. Geometry checks now include scroll dimensions so wide glyph tracking cannot silently clip inside a narrow box.
- Corrected orbital graphic motion after scene splitting: both horizontal and vertical coordinates now retain the original motion phase. A browser regression failed before the fix and passes afterward.
- Verified 62 unit tests, the production build and targeted browser/export/mobile regressions. Current validation evidence and remaining release gates are in VALIDATION.md.

## 0.11.0 — 2026-10-29

- Added recoverable project Trash, private searchable/paginated restore UI, save-before-trash and narration-take navigation guards. Trashed projects retain media/versions/finished exports; active jobs are cancelled and cannot revive through late worker updates.
- Standard project/job/media/archive/evidence/download routes reject trashed resources, including their owner, until restoration. Restore uses an explicit ownership-checked route; other accounts cannot list or restore a trashed project. Late saves preserve the independent Trash marker.
- Serialized additive ownership/Trash migrations across parallel service startup, with a real three-process legacy-database regression.
- Bounded unit-test process concurrency to two after simultaneous build/browser/media runs caused resource starvation. The corrected bounded run passes all 64 unit tests; actual worker freshness checks remain unchanged.
- Trash is reversible organization, not permanent deletion/privacy erasure, storage reclamation or automatic retention.

## 0.12.0 — 2026-10-29

- Added persisted workspace request windows with atomic SQLite admission across concurrent processes: 120 writes/minute, 30 media upload/import attempts/hour, 60 planning attempts/day and 30 export attempts/day by default. Server-only positive-integer settings tune these policies.
- Ownership/origin checks precede consumption. Exhaustion returns private 429 responses with a machine-readable code and Retry-After; private reads and other workspaces remain available. Invalid operator settings fail closed and readiness reports the configuration failure.
- Isolated tests exercise the real default policies; authentication abuse controls remain enabled. Added restart/concurrent-admission/HTTP/private-scope tests without real provider calls.
- Allowed retrying the same project archive after a failed import by resetting its file chooser after each attempt.
- Request caps are not storage quotas, provider token/dollar budgets, billing, global ingestion isolation or a substitute for public-service capacity controls.

## 0.13.0 — 2026-10-29

- Added non-destructive fit/fill-and-crop controls with horizontal/vertical source framing for images and video. Canvas slider drags preview locally, cancel with Escape and commit as one undo step; locks/reset, autosave, splitting, portable archives and scene-cache invalidation retain framing correctly.
- Preview/export share constrained media style values; image defaults retain the complete source and video keeps its existing fit default.
- Strengthened media/caption/typography browser verification by decoding the downloaded MP4 directly. Fixed a test that called Sharp statistics on an input rather than the intended cropped region.
- Fixed production Trash classification by reading request headers before authentication initialization; the build now keeps Trash dynamic when production credentials are absent at build time.
- Verified 69 unit tests and five focused browser cases including actual encoded image/video crop pixels, captions, text underline output and mobile typography. No source media is destructively cropped.

## 0.14.0 — 2026-10-30

- Added an allowlisted multi-stage container build with pinned Node, Chromium/FFmpeg, an unprivileged runtime and child-process reaping. Optional public build CAs use BuildKit secrets without disabling TLS or package integrity checks.
- Added a single-host service template with explicit authentication migration, shared durable volumes, read-only application filesystems, bounded resources, a network-isolated render worker and separate optional SMTP worker credentials.
- Added disposable production HTTPS browser checks using a short-lived locally trusted CA and secure cookies. The same certificate must fail an untrusted-client check; no TLS bypass is used. Tests force demo AI, retain mail privately and never start SMTP delivery.
- Added kernel-managed render-worker lifecycle locking, atomic instance diagnostics, forced-crash recovery and duplicate-worker rejection. Legacy plain-PID workers must stop before upgrading; the permanent coordination inode is retained.
- Added a production-build guard against prerendered authenticated studio/Trash pages, worker health command and production container CI configuration. Public deployment, hosted CI execution and live AI/email verification remain open.

## 0.15.0 — 2026-10-30

- Added a project-scoped media metadata catalog to compatible/Claude planning requests and validated returned ownership, media types, source ranges/audio availability, format and duration. Provider metadata excludes private source paths and unrelated customers' media.
- Whole-plan revisions now use current manual timing/format instead of resetting to the original brief. Targeted revisions send only the selected scene's timeline and preserve global narration/captions and unrelated scenes.
- Editor/planning saves atomically recheck active ownership, revision and latest media metadata under one SQLite write lock. Concurrent saves return a conflict; moving to Trash while a provider call or editor request body is in flight prevents the late save.
- Added offline route/provider contract tests with real private test accounts, invalid/foreign media responses, concurrent edits, metadata changes and Trash races. Full unit suite: 84 passed. Live provider calls remain deferred.

## 0.15.1 — 2026-10-30

- Fixed SQLite read-to-write transaction upgrades that could fail a render with `database is locked` when another process committed a write. Queue admission/claim/progress/stages/retries, project revision/rename/Trash and first-workspace creation acquire their write lock before reading the state they change.
- Existing workspace lookup remains read-only; ordinary private GET requests do not acquire a workspace-creation write lock.
- Added a real three-process contention regression with 4,500 competing progress/stage/policy writes. It reproduced SQLITE_BUSY before the fix and passes afterward. The first restricted Compose export found the problem; a corrected image/restricted-service rerun is required before claiming that acceptance gate.

## 0.16.0 — 2026-10-30

- Reused one job-owned Remotion browser for composition selection, scene rendering and evidence stills, with cleanup on success/error/cancellation and a source fingerprint that includes browser configuration code.
- Added real Chromium connection-lifecycle coverage and an API/browser case that cancels during frame rendering, then completes a follow-up export without resurrecting the cancelled job.
- Fixed the 0.15.0 planning import regression found by an actual export: pure demo planning and asset validation now live separately from server/provider/native processing. The build explicitly compiles the independent Remotion browser bundle to catch this before deployment.
- Added a disposable app-image service acceptance script for read-only/non-root/network restrictions, actual footage/caption/AAC encoding/full decode, duplicate-worker rejection, retained exports and one automatic recovery after a forced in-flight container crash. CI is configured to build the app target separately and preserve evidence. Executed service acceptance results are recorded in VALIDATION.md.

## 0.17.0 — 2026-10-30

- Added private, persistent per-studio normalized-media accounting and a configurable 512 MiB default allowance. Counts span all owned projects, including Trash, deduplicate shared asset references and measure actual files rather than trusting uploaded/archive metadata.
- Upload/import commits atomically check current ownership/Trash, per-project asset count and remaining allowance. Rejected normalized files are removed; imports leave no partial project. Existing over-limit media and manual/data-only work remain available. Invalid operator values fail closed and affect readiness.
- Added a private usage API and a responsive, refreshable studio media meter with failure recovery. New image/audio/video metadata includes measured stored bytes; portable import recalculates them.
- Added additive legacy accounting/backfill, an explicit combined studio/account migration command and a recount option. A verified real-workspace backup was created before applying the new index.
- Media allowance excludes exports, derived caches and backups. Global processing isolation, retention/permanent erasure and actual provider spend budgets remain separate public-production work.

## 0.17.1 — 2026-10-30

- Apply all eight EXIF orientations, including mirrored phone photos, to normalized image pixels before stripping private metadata. Retain accurate normalized width, height and byte size for planning/accounting.
- Portable projects accept the dimensions of existing wide images allowed by the 16 MP ingestion bound; import still decodes, validates and measures the real file rather than trusting manifest dimensions.

## 0.18.0 — 2026-10-30

- Recheck active project ownership, saved revision, media references, QC and capacity inside the atomic queue-admission transaction, preventing late exports after a move to Trash.
- Add private project-scoped UUID export receipts so concurrent/retried requests reuse their original immutable job, including terminal jobs. Reject changed requests that reuse a key.
- Save before approval, send the exact saved revision, reuse the current editor's key after a lost response, and expose existing draft/open-latest conflict recovery when another tab changed the saved video.
- Preserve receipts through verified backup/restore without resurrecting interrupted jobs. Existing bodyless API clients remain supported; normal request allowances still apply to retries.

## 0.19.0 — 2026-10-30

- Stream render-time image/audio/video through a private per-attempt loopback capability and immutable media allowlist, replacing embedded image/audio byte strings in render props. Hash media in 64 KB chunks and retain bounded regular-file descriptors for the job.
- Support concurrent byte ranges and correct normalized media types, reject symlinks/pipes/unknown IDs, cancel fingerprint preparation, and close active responses/descriptors on success, failure or cancellation. Content hashes keep cache keys independent of random capabilities.
- Use Remotion's image component so frame capture waits for image loading/decoding.
- Give unit checks private fallback storage and offline settings even for older tests that import media ingestion before configuring their own fixtures; real saved storage is preserved.

## 0.19.1 — 2026-10-30

- Bound layout-browser startup/review, close it when cancellation/deadline interrupts page creation, and release it if page setup fails.
- Shut down complete owned test-service lineages, including Chromium that detaches or outlives its launcher; give worker cleanup its full grace period, remove completed migration processes from supervision, and handle runner interrupts. Private inherited markers distinguish each test lineage without logging environment contents or signaling unrelated services.

## 0.20.0 — 2026-10-30

- Add private, compact project-list metadata for Studio and Trash. Search/pagination no longer transfer all project histories, asset catalogs, prompts and conversations into the browser.
- Retain exact saved-version counts and Trash timestamps, load full data on project open, and preserve the existing full-project API for clients without the summary view.

## 0.21.0 — 2026-10-30

- Add saved static layer rotation shared by canvas layout, live preview and exports, with slider/numeric/quarter-turn/reset controls, locks and one-step gesture undo/cancel.
- Rotate selection/resize handles correctly in composition pixels, and resize in local axes while holding the opposite corner. Preserve angles through versions, splits and portable projects.
- Check rotated text rectangles for overlap and warn about intentional rotation clipping without silently changing artwork angles.
- Declare a required rotation capability in version-2 portable archives, including rotated saved history, so older releases reject unsupported artwork instead of silently flattening its angle. Continue accepting/exporting version 1 for projects that do not need rotation.

## 0.22.0 — 2026-10-30

- Add an atomic default two-active-export limit per studio within the shared five-job queue, with bounded operator configuration, explicit capacity error contracts and safe receipt replay.
- Add a compact private Studio exports panel/API for cross-project progress, open/cancel actions and failed-check recovery, including mobile layout.
- Index job status/project lookups and validate the studio limit in readiness; preserve ordinary attempt quotas and offline shared-cap behavior.

## 0.23.0 — 2026-10-30

- Separate production account databases, signing-file material and queued mail from media/export storage; give web/migration/mail the private authentication volume and omit it from render. Mail mounts no media/export volume.
- Refuse overlapping account roots and legacy authentication files in production media storage. Preserve the development legacy fallback and provide non-destructive backup/restore cutover into new separate directories.
- Keep v1 backup compatibility, return an explicit restored account path, revoke only restored sessions/tokens, and adapt offline owner assignment and synthetic mail fixtures.
- Exclude private runtime/environment files from Next server traces and check both trace/required-file manifests; add actual app-image filesystem canaries to service acceptance.

## 0.24.0 — Safe AI provider failures

- Validate provider endpoints, model names and server keys before network work; reject credential-bearing/query/fragment URLs and malformed header values using fixed public-safe errors.
- Refuse redirects and automatic retries; bound successful response bodies to 512 KiB and the network/body phase to 60 seconds, cancelling oversized or stalled streams.
- Return private, structured 502/503/504 errors without upstream contents, keys, URL values or nested transport/JSON/schema errors. Failed plans preserve saved projects and manual editing.
- Verify compatible and native Claude behavior with simulated responses; live model verification remains deferred.

## 0.24.1 — Compact container build layers

- Assemble the app from read-only BuildKit inputs and compile as the node user in one layer, reducing full filesystem copies on VFS builders. Preserve private-context exclusions, public build-CA handling and empty runtime storage directories.

## 0.25.0 — Durable browser timeline recovery

- Keep validated per-account/project/tab timeline recovery copies across reloads after failed saves; offer explicit recovery/download/discard and preserve saved versions with undo/autosave.
- Preserve concurrent-tab drafts, refuse stale deletion, provide a download fallback when browser storage is full/unavailable, and confirm before sign-out clears outstanding account copies.
- Include the separate account volume in writable-space readiness checks, even when authentication is already initialized.

## 0.25.1 — Reload downloaded recovery files

- Load recovery JSON into its original account/project through Keep your project, retaining undo, autosave, concurrency checks and saved versions. Support earlier unsaved whole-project JSON while importing only its timeline/base; bound files to 2 MiB and reject unsupported or mismatched files.
- Download compact recovery records without copied media paths, messages or full history; keep editable ZIP archives as the transfer workflow.
- Hide decorative project-list glyphs from assistive technology; exclude the conventional private account directory from Git, formatting and lint traversal.

## 0.26.0 — Reproducible render-capacity baseline

- Add an optional cold-cache one-minute mixed-media square benchmark to the isolated service harness, using the real worker's unchanged resource/deadline limits.
- Verify frame count, format, audio and full decode; retain the synthetic export, image identity, elapsed time and sampled Docker resource usage. Require completion without a worker restart or export retry. Supported duration/resolution limits remain unchanged; executed results are recorded separately.

## 0.27.0 — Track retained and historical media references

- Index media referenced by uploads, current/historical project timelines and immutable export jobs, with atomic SQLite triggers that also cover older/raw database writers.
- Backfill and explicitly recount the derived indexes without changing project/job content. Preserve references across transaction rollback, legacy replace/ignore writes and shared-project histories.
- This is preparation for safe cleanup; permanent deletion is not enabled by this change.

## 0.28.0 — Permanent project removal and storage reclamation

- Add owner-scoped, confirmed removal from Trash, private cleanup status/pagination/retry and idempotent receipts. Keep resources hidden and unfinished exports cancelled once removal is requested.
- Perform bounded, resumable cleanup between worker exports, preserving shared/current/historical/job media and other projects' exports. Use validated IDs/no-follow directory anchors; protect reserved media and pending IDs against legacy writers and reclaim quota after cleanup.
- Clear only the selected project's browser recovery copies. New snapshots omit pending-deletion content without changing live storage; older backups/copies retain their separate policy.

## 0.29.0 — 2026-11-01

- Bind private browser API requests to the verified account that opened Studio/Trash. A stale account header is rejected before workspace creation, quota consumption or handler execution; the verified cookie remains authoritative and existing API clients remain compatible.
- Stop private browser requests after account change/session expiry, including late in-flight responses, while keeping unsaved edits downloadable and browser copies under the original account. Reload remounts the editor under the current verified account.
- Check the account on the exact sign-out request, so a stale tab cannot revoke the newly signed-in account or clear original recovery copies after a refused sign-out. Apply the bound request helper to project lists/edits, uploads/recordings, exports, waveforms, archives, storage and permanent deletion.

## 0.30.0 — 2026-11-01

- Reuse browser captures within eligible static scenes while encoding every 30 fps output frame. Still text/images/rectangles/mountains/arrows/gradients with cuts and at most eight caption states use bounded immutable JPEG captures; motion, footage, camera/keyframes, fades, unknown primitives, short scenes and dense caption changes retain ordinary frame rendering.
- Preserve exact caption starts/ends, rotations, geometry and current color/encoding metadata; reuse hard links rather than copying full-size image buffers, and clean capture directories on success/failure/cancellation. Native encoding remains cancellable and bounded.
- Stream cached-video checksums, require the exact encoded frame count and include the new renderer sources in cache invalidation. Private QC/cache metadata records actual frame reuse. Add a separate cold static-minute benchmark; mixed-footage duration/output limits are unchanged.

## 0.31.0 — 2026-11-01

- Add a private studio media library with filename search, type filters, pagination, provenance/rights, owned previews and retry/mobile states. Reuse normalized images, video and audio across active projects without copying files or charging their bytes twice.
- Atomically recheck source/target ownership and activity when retaining a shared asset ID; preserve unsaved edits, saved versions and shared media during source deletion. Completed links replay safely after their source disappears. Metadata reuse spends ordinary write allowance and preserves the upload/decoder allowance.
- Bound/sanitize metadata, requests and errors, omit histories and arbitrary legacy fields, support safe legacy project IDs, reject missing/symlink files and keep the 30-upload limit. Asset insertion now respects the selected scene's capacity rather than blocking every scene when one is full.

## 0.31.1 — 2026-11-01

- Hide the decorative export arrow from assistive technology so the button's accessible name is exactly “Approve & export MP4”. The first library browser acceptance reached export after its reuse/deletion checks but timed out on that exact name; its failure remains recorded and the three library cases are rerun after rebuilding.

## 0.32.0 — 2026-11-01

- Replace missing font-symbol decorations with inline SVG across studio navigation, idea cards, scene tiles, editing controls, downloads, sign-in branding and error dismissal. Icons stay outside accessible names and keyboard focus; existing button labels remain meaningful.
- Show the verified studio account's name/initial instead of the placeholder profile, with bounded desktop and mobile identity displays. Account changes still remount under the verified user and stop stale requests.
- Keep the sign-in wordmark visible on narrow screens by scoping the collapsed wordmark rule to the sidebar. Remove the decorative profile glyph that implied an unavailable menu.

## 0.32.1 — 2026-11-01

- Finish the composer aspect/time/demo indicators with SVG after visual review found three remaining unsupported symbols. Scene-order and saved-state decorations now use the same accessible icon component.

## 0.33.0 — 2026-11-01

- Move upload/import and uncached waveform decoding to a separate durable ingestion consumer. Bound receiving/queued/active inputs, raw byte reservations and per-studio analysis; retain existing cached waveforms and legacy 201 upload clients.
- Add private asynchronous receipts/status/list/cancellation, intent-bound request replay, timed/abortable bodies, crash-identifiable outputs and one bounded restart retry. Coordinate fresh quota/ownership attachment with Trash/erasure and physical cleanup; normalize only backup/restore copies.
- Add the data-only, network-isolated, non-root/read-only ingestion Compose role and separate kernel lock/heartbeat. Readiness now requires both workers. Keep codec errors fixed/private and expose only bounded quota diagnostics. Production browser/image acceptance and the richer upload progress UI are tracked separately.

## 0.34.0 — 2026-11-01

- Use asynchronous upload/import receipts in image, audio, video and narration controls, with stable per-form retry intent, retained selected files/takes, bounded progress polling and recovery after uncertain replies or a failed result refresh. Preserve unsaved edits when assets arrive.
- Add a private processing panel with recent requests, background progress after refresh, cancellation and reopening completed projects. Keep archive selections after failure and offer Retry import; bound mobile controls and history height.
- Stop stalled body readers when a receiving request is cancelled. Distinguish confirmed pre-queue rejection from an uncertain response so retries neither duplicate accepted work nor become stuck on a rejected request.
- Enforce the lower of the request's admitted retained-media allowance and the worker's current allowance during atomic attachment. Ignore client quota fields, preserve legacy no-media imports and normalize multipart filenames/rights before hashing retry intent.

## 0.34.1 — 2026-11-01

- Tighten the processing card's action spacing and omit an empty pagination row after screenshot review, keeping more of the editor visible while preserving background progress and recovery controls.

## 0.35.0 — 2026-11-02

- Refresh a completed upload with a private, bounded media-only response instead of transferring its full timeline, conversations and saved versions. Project opening and archive imports retain their complete project contract.
- Project only recognized metadata inside SQLite, retain image/audio/video rights and source details, reject damaged legacy values and deduplicate asset identifiers without altering stored data. Preserve actor binding, ownership, Trash and deletion checks on every response.
- Keep unsaved editor changes while merging the returned media. Retain completed receipts through read failures, and support a coordinated rollback for already-open browsers whose older server lacks the media GET route.

## 0.36.0 — 2026-11-02

- Reserve shared and per-studio estimated provider spending before a live planning request, with concurrency, payload and retained-ledger limits. Require explicit model/gateway input/output prices; demo planning and manual editing stay independent of provider configuration.
- Persist provider-reported normal/cached token usage and configured-price estimates using exact integer arithmetic, including unusable storyboards and concurrent-save/Trash outcomes. Keep uncertain request costs held across crashes and rolling-window changes; do not retry paid calls automatically.
- Add a read-only operator usage report and explicit reconciliation for expired unresolved requests. Keep provider estimates distinct from operator-confirmed charges, preserve immutable settled receipts, and retain no prompts, response bodies, keys or project identifiers in the ledger.

## 0.36.1 — 2026-11-02

- Apply declared-account checks to every bound authentication read/mutation, including session reads, profile/password changes and session revocation. Refuse changed/expired cookies before reading bodies or invoking account actions; preserve ordinary unbound sign-in/verification flows.
- Give small authentication JSON requests a 15-second receiving deadline and private interrupted-request responses. Close cancelled readers without executing the account change.

## 0.37.0 — 2026-11-02

- Browse saved versions in private metadata pages and preview one validated historical film at a time, with its available retained media, timestamps and source labels. Keep the existing quick-restore selector and preserve all stored versions.
- Bound history metadata and snapshot responses, refuse ambiguous/damaged legacy snapshots, omit unknown fields and verify the owning active project/account on every read. Mark incompatible media before preview/restore.
- Preserve unsaved current cuts while browsing, isolate preview keyboard commands, pause the main player and guard restoration during saving or pending narration. Recover an uncertain committed restore through the existing revision check and an explicit current-film reload.

## 0.41.0 — 2026-11-02

- Retain a build-bound, content-verified browser composition instead of compiling it on a production worker's first export.
- Refuse production readiness for missing, corrupt, symlinked or mixed-build renderer assets; preserve the queue and permanent lifecycle inode. Development/test compilation remains available.
- Disable compiler caching for the build's composition compilation. Video profiles, rendering/QC, scene-cache validation and cancellation controls remain unchanged. See VALIDATION.md for executed acceptance.

## 0.42.0 — 2026-11-02

- Add atomic logical project-data/count/version/direction admission with indexed UTF-8 accounting, shared/studio/project policies and preserved readable legacy overages.
- Add private reviewed saved-history cleanup with exact-data previews, active ownership rechecks, current-film/media/export preservation and bounded exact-once recovery receipts.
- Add maker-facing allowance, cleanup preview/confirmation/retry and mobile controls; metadata refresh preserves unsaved film, undo and the current save base.
- Reject exhausted planning allowances before provider contact; keep exact post-provider commit admission and private error contracts. Acceptance follows execution in VALIDATION.md.

## 0.43.0 — 2026-11-03

- Add shared retained-source byte admission and a census covering historical/export-only and previously indexed legacy media, preserving old data and zero-byte reuse.
- Capture admitted shared ceilings for restart-safe final attachment; distinguish binary/project capacity failures and preserve completed receipt replay before admission.
- Add read-only operator storage reporting and durable production browser JSON results. Physical export/backup retention and actual workspace upgrades are separate work.

## 0.44.0 — 2026-11-03: private streamed downloads

Source media, MP4 downloads, thumbnails and allowlisted evidence now stream through held regular-file descriptors in bounded chunks. Single byte ranges and explicit HEAD are supported, with private no-store/nosniff on every response, including authentication/ownership failures. Linux directory-descriptor traversal refuses symbolic ancestors, directories and files; nonblocking open rejects pipes. Cancellation/abort closes descriptors, changed files fail with a fixed transfer error, and missing exports return private 404. Authentication, actor checks, ownership, Trash and job/evidence eligibility remain enforced. Production acceptance is recorded separately.

## 0.45.0 — 2026-11-03: compact export history

The editor pages 20 private export summaries and reads one full report only after selection. Newer/older navigation has a stable anchored view, explicit refresh, read/open retry and bounded requests while current edits remain in the editor. Authenticated encryption binds opaque page cursors to the studio, project, purpose and snapshot without exposing shared sequence numbers. Legacy full-list API behavior remains available. This does not remove exports or enforce retained-export budgets. Acceptance follows execution in VALIDATION.md.

## 0.46.0 — 2026-11-03: native browser-start recovery

Own native Chromium launches before their connection exists, using an immutable launcher and private pinned configuration under noexec temporary storage. Failed startup, normal completion and cancellation release only attempt-owned processes and registered native profiles; unknown/replaced entries fail safely. A narrowly recognized connection-start timeout uses the existing single retry, while QC, cancellation, missing executables and unsafe cleanup remain terminal. Actual worker recovery, source/lifecycle preservation and noexec acceptance are recorded in VALIDATION.md; complete current-source backend/build/browser acceptance follows execution.

## 0.47.0 candidate — duplicate editable layers

Add a selected-layer duplicate action to the canvas and advanced layer controls. Copies preserve exact styling, rotation, motion keys, source media and video/audio ranges, use independent nested state and insert above their source in one undoable edit. The new copy is selected; undo/redo has a valid selection fallback. Locks and the existing 20-layer bound stay enforced. No source file, upload or studio media charge is duplicated. Production acceptance follows execution in VALIDATION.md.

## 0.48.0 — 2026-11-03

- Added reviewed, typed-confirmation removal of one terminal export’s MP4/captions/thumbnail/QC files. Saved films, versions, original media and export activity metadata remain available; a fresh export uses a new job identifier.
- Cleanup is a bounded durable queue consumed between renders under the lifetime kernel lock. Cancelled native attempts remain ineligible until teardown; startup waits for marked children surviving an interrupted consumer before recovering leases. Ownership moves/restarts after consent are guarded in SQL, and private file routes refuse new reads immediately. Interrupted confirmation responses replay durable receipts.
- Bounded reviews hash known flat generated files through pinned no-follow descriptors. Unexpected entries, replaced directories/inodes, stale content, unsupported entries and over-budget trees fail closed. Partial retries validate all remaining files before deleting any; normal rendering gets a turn between cleanup requests.
- Snapshots retain history/job-only original references, omit export payloads already consented for removal, and complete receipts only in the copy. Those snapshots declare version 2 and `removed-export-files-v1`; snapshots without removals remain version 1 and older snapshots remain readable. Source databases and files are untouched.
- Reconstructed after environment temporary-storage loss; all source/test work is now incrementally committed in a persistent workspace. The complete 359-case backend suite, production build/static guards and new real-export/mobile HTTPS workflow pass; the subsequent complete browser run found a cancellation/process-inspection failure and was interrupted; its recovery fix is under verification. Retained-export budgets, account erasure and historical-backup disposal remain separate work.

## 0.48.1 — 2026-11-03

- The production regression found that a process-inspection refusal during cancellation stopped the render consumer and left its next export queued. Inspection now validates PID-start/state around reads and rechecks an exiting task; stopped zombies cannot be treated as executing, while live unreadable tasks still fail closed. Bounded diagnostics record only PID/error code.
- All 361 backend/native tests, static checks and production build guards pass. Three repetitions of the exact cancellation/follow-up-MP4 case and three cleanup/rotation production cases pass. The complete 73-case production browser rerun passes in 26.3 minutes with no skipped/flaky/unexpected results; the earlier interrupted run remains recorded in VALIDATION.md.

## 0.49.0 — 2026-11-03: retained-export budgets and studio-wide reclamation

- Atomically capture output reservations alongside jobs and idempotency receipts, with private studio and shared logical-byte/count limits. Terminal output replaces its hold only after verified native teardown; failed/cancelled files remain charged until actual reviewed cleanup. Concurrent writers cannot overbook capacity.
- Meter generated output through pinned metadata reads, cancel above the captured/current ceiling and retain exact residual usage. A later configuration increase cannot enlarge an admitted job. Unknown output preserves its hold and blocks fresh admission pending operator review; cleanup remains available.
- Add private studio usage and bounded, encrypted-cursor pages across projects. A separate export-manager dialog permits download/review/removal while keeping the current film, unsaved changes and undo open. No automatic eviction occurs.
- Add explicitly pathed, stopped-writer recount under both permanent lifecycle locks, read-only operator export accounting and shared web/render configuration. Existing installations require a coordinated backup/stop/recount before new exports; no actual installation was upgraded.
- Portable snapshots with the ledger declare version 3 and `export-storage-v1`. Copied jobs normalize to terminal state with no phantom reservations; readonly verification checks ledger context, exact payload totals and capabilities. Original installations remain untouched and old versions remain readable.
- All 399 backend/native checks, the focused final legacy-ID paging case, production builds/static guards and four current-source production HTTPS workflows pass. The mobile manager brings its selected review into view and preserves current draft/undo/focus. The complete production browser regression passes 74/74 at the frozen current source in 26.6 minutes with no skips, flaky or unexpected results. See VALIDATION.md for exact source/evidence and earlier failed checks. Live AI and SMTP delivery remain deferred.

## 0.50.0 candidate — 4 November 2026: bounded export activity

- Capture report/timeline/request-receipt capacity before job insertion in the same writer transaction as binary admission. Exact UTF-8 document/receipt bytes replace the hold only after a terminal native attempt closes; SQL guards stop older unbudgeted producers and oversized new documents. Existing logical overages remain accounted and can shrink.
- Add private usage, stable encrypted activity pages and an independent typed retirement dialog. Download an activity JSON record before retiring report/events/immutable export timeline after file cleanup. The current film/undo stay open; job ID/status, original-media references and idempotency receipts remain. Stale consent fails and uncertain applies replay without consuming another slot.
- Protect job-only source references through retirement, repeated media-index rebuilding and old writers. A job's eventual approved permanent project deletion releases its remaining source records through the existing shared-reference cleanup.
- Portable v4 snapshots declare `job-history-v1`, preserve retired-source references and normalize only copied reservations. Older snapshot versions remain supported. Bounded report/queue reads keep oversized legacy documents intact and fail privately before hydration/native claims; the current saved film stays readable.
- All 417 final backend/native cases and the first actual production mobile/full-500-record retirement workflow pass. The final bounded-read variant also passes its ten targeted checks; final production build/browser acceptance is pending. No actual installation, provider or mail consumer was used.

## 0.51.0 — 4 November 2026: reliable private account mail

- Bound pending mail count, UTF-8 envelope bytes, per-recipient backlog, document sizes and delivery batches. Serialize producers/claims/settlement across processes, reserve metadata growth and expire private links after bounded retry/lifetime policy on queue activity.
- Add permanent Linux mail lifecycle locking, captured per-message attempt leases, crash recovery, health checks and aggregate explicit-path inspection. Preserve source queues across backup/restore and never resend legacy failed records automatically.
- Isolate SMTP in a credential-minimal sender process with an independent deadline and awaited teardown before retry. SMTP uncertainty retains at-least-once semantics; no real delivery is claimed.
- Add verification resend to the account form with bounded abuse control and preserved email/error recovery. All 435 backend/native checks, static checks, production builds and five targeted production HTTPS workflows pass, including the full-queue mobile verification/retry flow with other queued accounts preserved. The complete production HTTPS regression passes 76/76 in 27.9 minutes, with zero additional OOM events after verified cleanup of retained generated test fixtures. Live SMTP/AI and production deployment remain deferred.

## 0.52.0 — 2026-11-04: account deletion and private recovery

- Add explicit independent account-erasure authority, immutable approval/receipt protocol, bounded confirmation admission, immediate session denial, studio producer barriers and private resumable cleanup. Existing native consumers retain actual file/lease cleanup responsibility; uncertain provider charges remain charged after identity detachment.
- Bind verification links and asynchronous updates to the original user ID so an old link cannot verify a new account reusing an address. Keep consumer termination handlers through final diagnostic cleanup.
- Add format-5 backups/current-authority reconciliation, legacy restore filtering and incomplete-restore startup refusal. Preserve original sources and independently managed authority; declare an external privacy volume and credential-free network-isolated cleanup role.
- Add account settings, saved private deletion receipts, cookie-free progress/recovery and browser-copy fencing scoped to the erased account. Protect recording/unsaved work before Studio navigation.
- Complete 491-case backend/native acceptance, eight later preflight checks, final static/build guards and all 79 production HTTPS browser cases pass. Final mobile confirmation/completion/recovery views are manually reviewed. Physical historical-backup/WAL retention, operator recovery, hosted/image/load/creator/long-video and final live mail/AI acceptance remain release gates. No actual installation was upgraded or deployed; forensic erasure is not claimed.

## 0.53.0 — 4 November 2026: explicit cleanup recovery

- Add private `privacy:retry` for at most five failed project-cleanup tasks under one current pending account approval. Preserve other makers, native/mail/provider holds, source files and the immutable authority; roll back a batch containing corrupt ownership.
- Require existing private migrated stores and refuse initialization/repair. No signing/mail/provider credentials or raw receipt are needed; document correction of the underlying fault and deliberate operator recovery.
- All 497 backend/native checks and 13 targeted real-command/store regressions pass. The unchanged UI retains the 79-case 0.52 production HTTPS baseline. Physical DB/WAL/backups, native-HD/long-video/creator and hosted/image/live release acceptance remain open.

## 0.54.0 — selectable native HD

- Preserve an explicit standard/1080p export setting through undo, saving, versions, archives, scene-local rendering/cache and preview/layout/caption geometry. Existing films keep their original dimensions; landscape/portrait HD render natively at 1920×1080/1080×1920.
- Require archive v4/backup format 6 with explicit native-HD capability, including retained versions and immutable job inputs; refuse retagged/inconsistent declarations and retain supported legacy formats.
- All 503 backend/native checks pass. A one-minute generated-footage native-HD pipeline passes in 210.514 seconds on the recorded 4 CPU/6 GiB mounted runner; production-sized resource/longer-video acceptance remains open. The production build and both new verified-HTTPS maker flows pass, with actual decoded HD downloads and mobile controls. The complete mixed browser baseline stays 79/79 at 0.52; no complete 81-case run is inferred. Public duration/scene limits are unchanged; no deployment is claimed.

## 0.55.0 — 2026-11-05

- Reuse bounded still artwork around one eligible moving video while preserving exact trim, layer depth, crop and caption boundaries; unsupported motion/transforms retain ordinary rendering. Pin native frame-cache memory explicitly.
- Finalize audio directly into the metered export while holding the private silent input in the derived cache. Verify every encoded frame count and derive review PNGs, thumbnail and final-frame proof from one complete error-checking MP4 decode.
- Keep temporary/final verification bytes in the strict quota and reviewed-cleanup inventory. Complete backend/native regression passes 509 checks. Production build/browser and longer synthetic measurements remain pending; public limits remain 60 seconds/12 scenes.

## 0.56.0 — 2026-11-05 candidate

- Extend editing to five minutes/sixty scenes, twelve audio tracks and five hundred caption cues, with existing per-scene/media/provider/native-output limits retained. Demo plans allocate enough bounded scenes for longer briefs.
- Add searchable/paged caption editing, scene-scoped long-film caption tracks, longer timeline zoom and correct late narration positions.
- Fence extended current/history/brief/job data with independent archive/backup capabilities; preserve legacy and native-HD behavior. Align detailed-save, bounded reopen and compact downloadable recovery limits.
- A constrained synthetic full-frame HD five-minute pipeline passes in 545.831 seconds with a 1.82 GiB container peak and 371.5 MiB final output. Complete current-source backend/build/browser acceptance remains pending. No deployment or live SMTP/AI verification.
