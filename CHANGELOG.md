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

## 0.56.0 — 2026-11-05

- Extend editing to five minutes/sixty scenes, twelve audio tracks and five hundred caption cues, with existing per-scene/media/provider/native-output limits retained. Demo plans allocate enough bounded scenes for longer briefs.
- Add searchable/paged caption editing, scene-scoped long-film caption tracks, longer timeline zoom and correct late narration positions.
- Fence extended current/history/brief/job data with independent archive/backup capabilities; preserve legacy and native-HD behavior. Align detailed-save, bounded reopen and compact downloadable recovery limits.
- A constrained synthetic full-frame HD five-minute pipeline passes in 545.831 seconds with a 1.82 GiB container peak and 371.5 MiB final output. All 515 backend/native checks and production build pass; the full HTTPS regression has 83 passes and one obsolete stage-label assertion corrected and passed separately. No deployment or live SMTP/AI verification.

## 0.57.0 — 2026-11-05

- Add descriptor-only database storage inspection and explicit offline compaction of current studio/account databases under both exclusive locks, preserving retained rows, schema and database inodes. Refuse missing/private-unsafe stores, busy WAL readers and insufficient capacity without initializing or migrating anything.
- Enable connection-local secure deletion for application/private-auth/mail writers. Compact only owned inactive backup/restore copies after existing privacy reconciliation, clearing obsolete payload before publication while preserving source databases and older snapshots.
- All 521 backend/native checks, production build and eight relevant HTTPS workflows pass, including raw-byte deleted-data checks. Historical/off-host backup and device-level retention remain separate gates; no actual installation is compacted.

## 0.58.0 — 2026-11-05

- Add three authored editable native-HD starters: a 45-second vertical launch, three-minute explainer and one-minute brand story. Admit the complete first film/version atomically, including storage quota enforcement, without an AI request.
- Edit and read scene narration notes alongside microphone capture, step between notes without interrupting a take, and replace one scene’s captions with a single undoable action.
- Add keyboard-focusable desktop shortcuts and a mobile tool picker for navigating longer editing sessions. Expand bounded subtitle imports to 256 KiB so all 500 allowed Unicode or escaped cues can round-trip from their own SRT/VTT exports.
- All 530 backend/native checks and production build pass. All three complete HD starter exports pass; the expanded microphone-to-mixed-media story passes separately after test selector corrections. Exact outcomes and visual review are in VALIDATION.md; this is not a complete 88-case browser rerun. No deployment or live SMTP/AI verification.

## 0.59.0 — 2026-11-05

- Delete a scene and close its global gap in one undoable edit. Later captions/audio move earlier, contained material is removed from the timeline, crossing cues shorten and crossing audio splits into the exact retained source ranges with fades capped to fit. Keep source assets and remaining scene-local footage/motion unchanged.
- Refuse atomically if splitting would exceed twelve audio tracks or existing saved-film limits, and explain the operation beside its editor action.
- All 534 backend/native checks, production build and the complete 89-case production HTTPS browser regression pass. A real captioned/voiced scene cut retains the exact surviving audio frequencies through undo, reload, archives and native-HD export. No deployment or live SMTP/AI verification.

## 0.60.0 — 2026-11-05

- Make Scene notes readable on mobile with a 16px editing field, comfortable line spacing and padding.
- Add explicit operator inspection/upload/restore verification and preview-by-default expiry for existing encrypted Restic repositories, pinned to repository and privacy authority identities. Keep original local snapshots and other installations intact.
- Verify fresh admitted sources, encrypted manifest binding, complete restored payload/SQLite/reference integrity and scratch capacity before a recent-anchor retention apply. Use native repository locks and fixed namespace filters independent of staging paths.
- Minimize child credentials, pin the password descriptor, bound output/deadlines and await cancellation teardown. Provide an independent backup image target and matching host/operator CI checks. All 543 backend/native checks, production guards and five current relevant HTTPS browser workflows pass; the complete 89-case 0.59 browser baseline is recorded separately. Nine focused encrypted-repository checks and mobile notes visual review pass. No real repository, local historical snapshot, deployment or live SMTP/AI operation is performed.

## 0.61.0 — 2026-11-05

- Capture bounded render-attempt policy at worker startup. Automatic budgets allow three times film running time within the existing 10–15 minute default window; explicit operator overrides remain clamped to 1–15 minutes. Reference deployment exposes the optional override.
- Reject invalid operator settings before creating worker state. Give timed-out makers actionable shortening/resolution/motion guidance; retain heartbeat, output, memory and retry limits.
- Share the default policy with the synthetic capacity runner. The prior one-minute portrait HD motion case passes in 138.017 seconds; the five-minute variant is cancelled at the former 600-second default without memory pressure. Three policy/startup contracts and type/lint pass. The complete five-minute portrait motion rerun passes in 680.990 seconds under 2 CPU/4 GiB with no memory pressure, within the existing fifteen-minute ceiling.
- Release orphaned native work after an attempt ends. A new real-worker deadline test showed Remotion leaving its image-pipe FFmpeg stitcher blocked after a deadline-cancelled five-minute portrait HD motion render; the consumer then failed closed and exited, stopping all rendering. The worker now waits briefly, then SIGTERM/SIGKILLs only its own marked descendant processes with unchanged PID identity; foreign/earlier-consumer processes are never signalled and surviving owned work still fails closed. `render.start` logs record the captured budget.
- Add real-worker coverage: explicit (clamped 60-second) deadline enforcement during genuine native rendering, bounded teardown, no automatic retry, no unpublished cache staging, preserved saved films/allowances/permanent lifecycle inode, a subsequent export from the same consumer, and another after a restart to automatic budgets. Add focused release tests for SIGTERM-ignoring owned children and never-signalled non-descendants.
- Make the native output-ceiling fixture encoder-independent (native-HD noise); on a different Chromium/FFmpeg build its 720p frame left 937,000 bytes after a correct peak refusal, failing accepted 0.60 too.
- Accepted from one frozen source (`5567641`, non-root, new cloud environment): 548/548 backend/native checks, production build/guards/type/lint/format, and the complete 89/89 production HTTPS browser regression with zero skipped/flaky cases. Immutable images, hosted CI, constrained service capacity, maker review, SMTP/off-host restore and live AI remain open.

## 0.62.0 — 2026-11-05

- Order the single render consumer's shared queue fairly. Each admission gets a fixed virtual finish key (the later of admission time and the studio's latest pending key, plus film running time), and the smallest key renders next. One studio's consecutive long films no longer hold every other studio behind them, and short films are not stuck behind unrelated long work. Studio order and retry positions are kept, nothing starves, and legacy unkeyed jobs keep rowid priority. Keys are released by triggers on terminal status or deletion.
- Show queued makers "Waiting in the render queue · N exports ahead" (counts only; no other studio details) through the job API and export panel.
- Record that GitHub reports zero registered workflows and zero runs for the repository despite the committed `checks.yml`. Hosted Actions appears disabled and needs repository-admin action; no hosted CI result exists.
- Accepted from frozen `5b9b003`: 550/550 backend/native checks, production build/guards and the complete 90/90 production HTTPS browser regression (new queue-position case included), zero skipped/flaky.

## 0.63.0 — 2026-11-06

- Put creative work first. A screenshot walkthrough of the production build showed account-wide export storage and activity accounting leading the home page and every editor page. It now follows the creative work in a "Storage and export records" section; the active-exports summary stays on top.
- After an export completes, show the video thumbnail and Download MP4 before the activity log and file-removal controls.
- Replace the operator instruction shown to queued makers ("Keep the render worker running…") with plain shared-queue guidance.
- Show the 12-character hint only when choosing a password, and label history entries "Export #id" instead of a bare id prefix.
- Make the sticky editor tools bar opaque, place the "Recent projects" label above the project list, and style the sidebar search box and mobile project library, which rendered as unstyled controls with an overlapping heading.
- Accepted from frozen `7eed554`: 550/550 backend/native checks, production build/guards and the complete 90/90 production HTTPS browser regression, zero skipped/flaky. This is developer walkthrough review, not creator acceptance.

## 0.64.0 — 2026-11-06

- Bound the render pipeline's task (thread) count under the reference render service's 256-task limit. A constrained five-minute full-frame footage/caption/audio export failed after 9 seconds of frame rendering with "Video compositing could not finish safely". Sampling showed 295 tasks with the limit lifted: about ten Chromium renderer processes stacked up from rapid still captures (each closed page's renderer outlived it), plus FFmpeg input decoders sized by the host's visible cores.
- The immutable browser launcher now passes `--renderer-process-limit=4`. The footage compositor bounds each input decoder's threads, and the audio mux uses one decoder thread per track plus a single filter-graph thread.
- Record constrained 2 CPU / 4 GiB / 256-task five-minute native-HD measurements for square motion, landscape motion and full-footage mixed media.
- Retry mail-outbox connection setup on `SQLITE_BUSY` before the write transaction begins. Concurrent first use could hit `SQLITE_BUSY` in journal-mode/schema setup outside the busy timeout, so a valid message was refused as unavailable. The failure was found as a one-off full-suite failure and reproduced in 4 of 15 loaded runs, then 0 of 20 after the fix. Work inside the immediate transaction is never repeated.
- Accepted from frozen `a3941f4`: 551/551 backend/native checks, production build/guards and the complete 90/90 production HTTPS browser regression. Landscape motion runs at 738.0 s under the cap, with no slowdown.

## 0.65.0 — 2026-11-06

- Recover rendering after a crash during footage compositing. The restricted Compose runtime check kills the render worker mid-export; when that landed in the footage compositor, cache maintenance refused the interrupted staging's `composite-XXXXXX` stills forever. The restarted worker then never became ready and all rendering stopped until operator cleanup. Only that directory with `under.png`/`over-NNNN.png` stills is now adopted as interrupted staging; anything else still refuses.
- Bound libuv, V8-platform and Go (esbuild) thread pools for the migrate, privacy and mail services. Pools follow the host's visible cores, and on a 4-core host the privacy service and its tsx healthcheck reached 70 tasks under a 64-task limit and crashed with `errno=11`. With the bounds, the measured peak is 54.
- Record the first immutable app/test image acceptance in this environment. Images are built from the unmodified Dockerfile on a sandbox-only proxy-CA base image (overlayfs storage).
- Accepted from `33fa994`: 552/552 backend/native checks in source mode; the restricted Compose runtime check passes three times on the app image; the complete 90/90 production browser suite passes inside the immutable test image; the backup image builds and refuses without configuration.

## 0.66.0 — 2026-11-06

- Keep private account cleanup healthy before the first account message is queued. The cleanup batch queried the mail outbox whenever the mail directory existed, but that directory can exist without an outbox (mail-worker lock/heartbeat files, isolation files). Every batch then failed and the privacy service stayed unhealthy, leaving erasures unprocessed, until someone signed up. It now checks for the outbox itself and never creates one.
- Add an upgrade/rollback drill: `node scripts/check-runtime.ts --image <candidate> --upgrade-from <previous>`. It seeds data and an export on the previous image, models queued account mail, stops writers, migrates and switches to the candidate, verifies the earlier export and a new one, then rolls back over the same volumes and verifies both earlier exports and another new export.
- The runtime check now also requires private-cleanup health at the end; previously it checked only at startup, which let the defect above pass silently.
- Accepted from `74b29e2`: 553/553 backend/native checks; the restricted runtime check and the 0.61 ⇄ 0.66 upgrade/rollback drill pass on the app image; the complete 90/90 production browser suite passes inside the test image.

## 0.67.0 — 2026-11-06

- Enable hosted GitHub Actions. On the first hosted run, 535/553 backend checks failed. One unrelated same-user process on the runner had an unreadable environment, and render recovery treated it as a possible leftover renderer, so every worker refused to start. Recovery now ignores unreadable processes unless their name matches a browser, FFmpeg, Remotion, Node or shell process. The second hosted run passes the complete backend suite.
- Approve the three dependency install scripts (better-sqlite3, esbuild, unrs-resolver) that npm 11 now blocks by default.
- Let each studio save its own AI provider key (Anthropic, OpenAI, Google Gemini or any OpenAI-compatible endpoint) in Account settings. Keys are encrypted with AES-256-GCM under a key derived from the sign-in secret and bound to the studio; they are never shown again in full, never stored in files or environment variables, and can be deleted at any time. The planner uses a studio's own key first, then the platform key when allowed, then the demo director.
- Separate usage accounting by source. Provider usage now records whether the platform key or the studio's own key paid. The global platform budget counts only platform spending, and each studio's daily limit applies to the source it used. `REELCHEMY_PLATFORM_AI` (`off`, `all` or `granted`) and `npm run ai:entitlement` control who may use the platform key; `npm run ai:usage` reports usage per source.
- Report rejected keys, unavailable models and provider rate limits as distinct, actionable errors.
- Add a one-command single-server deployment for Ubuntu hosts behind a Cloudflare Tunnel (`deploy/reelchemy.sh`, `DEPLOYMENT.md`). It generates private secrets, initializes the independent privacy authority once, migrates, starts the services on loopback only, and covers status, logs, update, account creation, password reset and coordinated backups. The server trusts `CF-Connecting-IP` for rate limits, and public sign-up can be closed (`--closed-signup`).
- Accept writes whose origin equals the configured public URL, so sign-in works through the tunnel while foreign origins are still refused.
- Run the worker, ingest, privacy and mail services as Node processes directly. Under `npm run`, Docker's stop signal ended npm first and the kernel killed the consumer before it released its lock, so a coordinated backup then refused the stale render lock. Render and ingest get 30 seconds to hand work back.
- Ignore only closed-pipe (`EPIPE`) write errors in the render worker after a stitcher is killed; any other uncaught error still exits the worker.
- Verified end to end with Docker in the sandbox: install, verified account creation, tunnel-style sign-in, closed sign-up, saving and using an AI key, refusal of a foreign origin, backup with restart, and update.

## 0.68.0 — 2026-11-06

- Allow five-minute sources: uploaded footage and audio may each run up to 300 seconds (the longest film), and microphone takes up to 300 seconds. Upload limits are 10 MB for images, 64 MB for audio and 95 MB for video, which stays under Cloudflare's 100 MB request-body limit. Archive limits grow to match (250 MB total, 110 MB per asset); trims past the old one-minute offset mark archives with the extended-timeline feature.
- Give Chromium a writable crash-report directory in read-only containers. The hosted production check failed because Chromium's crash reporter had no `--database` location; the render browser launcher and layout check now pass `--crash-dumps-dir` under the private temporary directory, and services set `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` to `/tmp`.

## 0.69.0 — 2026-11-06

- Animate rotation: layer and camera keyframes take an optional rotation (±720°, added to the layer's static rotation), so layers can spin or swing over a scene. Keyframe editing keeps rotation when scenes are split.
- Clip layers to a circle (an ellipse for non-square boxes) or rounded corners, for example presenter bubbles or framed photos ("Media shape mask"). Masked footage is composited by the browser renderer rather than the direct footage path.
- Upload brand fonts (TTF, OTF, WOFF or WOFF2, up to 5 MB) and use them for text. Fonts go through the private media pipeline and are stored byte-for-byte after a structural check of their container (signature, table directory and declared lengths); collections and disguised files are refused, and only Chromium's font sanitizer parses glyph data. "Use for text in selected scene" applies an uploaded font to every unlocked text layer in the scene, and "Brand font" picks one per layer, with the generic family kept as the fallback.
- Preview, export and the layout check load the same font before measuring or drawing. An export refuses a font Chromium cannot load, with a clear message, instead of silently drawing the fallback. Changing a font file invalidates cached scenes, and fonts appear in the studio media library.
- Keep audio and captions in sync when a scene's length changes ("Move later audio and captions with this scene", on by default). Lengthening moves everything that starts at or after the old scene end; shortening removes the trailing frames like a cut, splitting audio across the boundary and collapsing captions inside it. Previously, later audio and captions kept their absolute frames and drifted against the scenes after the edit.
- Tell the AI director that a font asset may only be a text layer's `fontAssetId`.
- Archives carry animated rotation (`keyframe-rotation-v1`), masks (`layer-mask-v1`) and uploaded fonts (`custom-font-v1`) in envelope version 5, so older readers refuse these projects instead of silently dropping the fields.

## 0.70.0 — 2026-11-06

- Send large uploads in resumable, verified pieces. Proxies limit the size of one request: Cloudflare refuses request bodies over 100 MB on Free and Pro plans, including traffic through a Cloudflare Tunnel, which had capped video uploads at 95 MB.
  - Files over 32 MB now go to a resumable upload. The browser sends 32 MB pieces with their SHA-256; the server stages them on the data volume and refuses damaged or out-of-order pieces.
  - After a dropped connection or a reopened page, the upload continues from the server's recorded position.
  - The finished file is verified and handed to the ordinary media queue, so receipts, quotas, cancellation and processing are unchanged.
  - Uploads may now be up to 2 GB for video, 256 MB for audio and 25 MB for images; project archives may be up to 256 MB.
- Keep large inputs out of memory: the worker verifies a queued file by streaming and FFmpeg reads it in place, instead of loading it and copying it into the memory-backed temporary directory.
- Cap normalized video at about 5 Mb/s, so five minutes of 1080p stay within the 200 MB stored-video limit; long or 4K sources get a longer processing deadline.
- Reserve each raw input's actual size instead of a fixed maximum; the default raw pool is 4 GB.
- Fix limits left over from smaller media:
  - exports refused any stored file over 25 MB, so a long clip or a five-minute narration (about 58 MB) failed to render;
  - archives refused assets over 25 MB and re-imported audio through a 25 MB bound;
  - project archives were capped at 50 MB.
- New single-owner installs allow 10 GB of stored media per studio (20 GB shared).

## 0.71.0 — 2026-11-07

- **Animated code scenes.** A scene may now be HTML, CSS and JavaScript animated with GSAP instead of layers.
  - Code scenes run on a fixed stage under a virtual clock (`Date`, `performance.now`, `requestAnimationFrame`, timers and seeded `Math.random`), so preview and export show the same exact frame. They may run up to 60 seconds.
  - They run in an opaque-origin sandboxed iframe whose content security policy allows no network. Only allowlisted local files load: GSAP 3.15 with SplitText, DrawSVG, MorphSVG, MotionPath, ScrambleText, Text and CustomEase; optional d3 7; Lucide icons; and the Inter, Space Grotesk and JetBrains Mono fonts.
  - The render browser keeps sandboxed frames in-process so screenshots never show a stale frame.
  - Archives mark code scenes with the `code-scene-v1` feature.
- **The kit `R`** gives scene code layout-aware primitives:
  - connectors routed between elements' real boxes, with arrowheads that ride the drawing tip, and packets travelling along them;
  - diagram nodes, and syntax-highlighted code that types itself, with highlighted lines;
  - counters, bar charts, emphasis rings and a camera that zooms to a target;
  - grid, glow and particle backgrounds, and a theme from the film's style guide.
- **The AI director.** With an AI key, new films and whole-story revisions are made by an agent that:
  - plans a storyboard and a style guide, then writes every scene as code (in parallel, up to the studio's call limit);
  - renders test stills in a headless browser and checks them for errors, empty or frozen frames and layout problems (small, clipped, overlapping or off-stage text);
  - reviews the stills with the model and revises each scene up to twice, keeping the best attempt. A scene that never works becomes a simple title card instead of failing the film.
- Revising one code scene by instruction keeps its length and the rest of the film. Runs happen in the background with progress, Stop and an outcome message, so they are not cut off by Cloudflare's 100-second request limit. The writer's instructions are cached on Anthropic.
- **Code editor in the studio.** A code scene opens with HTML, CSS and JavaScript tabs, Apply (Ctrl/⌘+Enter), Revert, validation, a kit reference and the errors the scene throws in the player. Any layered scene can be turned into a code scene from a working starter.
- The composer says plainly that the demo director makes simple title slides and that an AI key enables the AI director.
- Fix: the development render worker compiled its renderer bundle while the export storage meter was running. The compile held the event loop past the meter's five-second observation bound, so exports could fail with "Export storage needs operator review". The bundle is now ready before metering starts. Production uses its prepared bundle and was not affected.
- AI concurrency: the service default is now 4 calls at once (`REELCHEMY_AI_CONCURRENT_CALLS`). A studio using its own key may run `REELCHEMY_AI_OWN_CALLS_PER_STUDIO` calls (default 3, range 1–8). Image inputs reserve 2,000 input tokens each.
- The writer sees three reference scenes: a kit-built diagram (cache-aside with Redis and PostgreSQL), a portrait data story (compound growth) and a hand-drawn SVG diagram (a PostgreSQL index lookup). Each passes its own checks in the test suite.
- Rings and connectors re-measure their elements when they start drawing, so a ring around a counter or typed code frames its final size.
- Developer tool: `scripts/motion-preview.ts` writes a contact sheet of a scene (optionally at given times), with errors and layout notes.

## 0.72.0 — 2026-11-08

- **Videos fit the frame.** Earlier AI-planned films could place content partly outside the video frame, so the preview and video showed only part of a scene.
  - AI-planned layered scenes (new plans and scene revisions) are now fitted to the frame when they are saved:
    - every layer's box and every keyframe position stays inside the frame;
    - text too large for its box is shrunk to an estimated fit.

    Previously the layout could extend up to a full frame past the edge, and only the export pulled static layers back in. Export still measures real text in the browser and adjusts further.

  - Code scenes have a safety net. The director measures the scene's content (text, icons, images, canvases and drawn strokes) half a second before the scene ends. If it extends past the stage after the review rounds, the content is scaled and moved inside the text safe margins. The background still fills the frame. The film's summary says how many scenes were scaled.
  - A fitted scene shows its scale in the code editor, with **Show at full size** to remove it. Archives mark fitted scenes with the `code-fit-v1` feature, so older readers refuse them instead of showing them unfitted.
  - The layout audit no longer reports the fit wrapper itself as content off the stage.
- The studio preview keeps the video's own shape. Portrait and square previews used to be stretched to the full width of the panel, which letterboxed the video inside a wide box.
- Test fix: a studio browser case matched an export stage shown in two places at once.

## 0.73.0 — 2026-11-08

Closer to dedicated AI motion-graphics tools: 3D, the maker's own images, style references and presets.

- **3D scenes.** A code scene may list `<libraries>three</libraries>` and use **R.three**.
  - three.js 0.186.1 and a few add-ons (rounded boxes, SVG shapes, studio lighting, bloom) ship as one pre-built plain script (`src/motion/vendor/three.js`), loaded like GSAP and d3. Nothing is compiled while the studio serves scenes. `npm run vendor:three` regenerates it, and a unit test fails if it no longer matches the installed three.js.
  - A scene library that fails to load is now reported by name in the scene's error.
  - R.three gives a lit WebGL scene behind the scene's HTML: environment lighting, ACES tone mapping, optional bloom, fog and shadows.
  - Building blocks: rounded boxes, spheres and cylinders; extruded SVG logos; crisp 3D text and icon cards; soft particles; a floor; the project's images as pictures; an orbit tween; and screen() to pin HTML labels to 3D points.
  - The clock draws WebGL once per captured frame. A 10-second 1080p 3D scene exports in about 5 minutes on the software renderer.
- **The maker's images in code scenes.** Uploaded logos, product shots and screenshots can be used with `data-asset`, R.asset, R.image and view.image.
  - Scenes declare their images; saving checks they belong to the project. The host page passes the bytes into the sandboxed scene, which cannot fetch them itself.
  - The director gets the image catalog. The code editor lists images with Insert. Archives mark such scenes (`code-asset-v1`) and rename IDs inside code on import.
- **Style reference.** A project video or image can be chosen as a style reference for a revision. The director builds a contact sheet of 8 frames and the video's cut rhythm, and asks the planner and writer to match its look and pacing, but not its content.
- **Style presets** in the composer: tech explainer, product launch (3D), kinetic typography, data story, clean and light, social reel. **Extra polish** allows four review rounds per scene.
- **Film finish:** R.finish adds subtle grain (a new pattern every 4 frames, which keeps files reasonable), a vignette and letterbox bars.
- Stronger composition guidance (fill the frame, layered depth, tight camera framing), and a fourth reference scene: a 3D product hero shot.
- Developer tool: `scripts/render-showcase.ts` renders the reference scenes, or one scene file, through the export pipeline.

## 0.74.0 — 2026-11-09

Higher-end motion design from the director, AI assistants working inside the studio over MCP, and a clearer workspace.

- **Explainer kit.** New building blocks for code scenes:
  - R.shots: several full-frame shots in one scene with push, slide-up, zoom-through, wipe, blur, fade or cut transitions.
  - R.arrow, R.callout and R.mark (hand-drawn underline, circle, box, highlighter).
  - R.steps (numbered steps that advance), R.window (browser, app, terminal and phone mockups) and R.cursor (moves and clicks) for tutorials.
  - R.chart (line and area charts that draw), R.stat (count-up cards) and R.iso (isometric layer stacks).
  - R.headline and R.swap (kinetic type), R.drift (continuous camera push) and R.pulse.
  - view.globe in 3D: a dotted globe with a rim glow, pins, arcs that grow and packets along them.
- **Quality gates.** The director's checks now catch frozen stretches (motion measured every half second without the ambience) and underfilled frames (content under 40% of the frame), besides errors and layout problems. Text under an opaque panel no longer counts as overlapping.
- **Planning and references.** The planner paces a new visual event every 1.5–2 s and plans longer scenes as 2–4 shots. Two new references lead the writer: a three-shot CDN explainer (3D globe, request diagram, chart) and a software tutorial (app mockup with a cursor, then a terminal).
- **MCP server.** `/api/mcp` lets Claude Code, Claude Desktop, Cursor and other MCP clients make videos in a studio: read the motion guide, create projects, write scenes, see stills with the automatic checks, revise and export. claude.ai, ChatGPT and other connector apps sign in with OAuth: discovery metadata, dynamic registration, PKCE codes approved by the signed-in owner, and one-hour access tokens with rotating refresh tokens. Other clients use personal access tokens created in Account settings → AI assistants. All tokens are stored as hashes, act only for their studio, open only the MCP endpoint and can be revoked or disconnected. Previews are limited per studio (`REELCHEMY_PREVIEWS_PER_HOUR`, default 120).
- **Workspace.**
  - A sticky editor bar holds undo, redo, saving and Approve & export.
  - The player and director sit side by side, above a compact scene strip and the timeline.
  - One editing tool is open at a time: Scene & layers, Design, Media & voice, Sound & captions, Export and Project.
  - Version history, recovery and Trash moved to Project. Storage and export records are folded away, and the studio-exports line is quiet when nothing renders.
  - A readable type scale replaces 7–11 px labels.

## 0.74.1 — 2026-11-11

Fixes from a review of 0.74 before its first deployment.

- **Project links.** `/?project=<id>` opens that project in the studio and then leaves a clean address. The MCP tools return this link as an absolute URL; before, the link they returned opened the home page.
- **App registration is bounded.** OAuth client registration needs no sign-in, so it now allows 30 registrations an hour (HTTP 429 with Retry-After beyond that) and forgets registrations that never led to a connection after a day.
- **Phone home page.** Long project names wrap in the project list.
- **Motion kit.**
  - R.captions: step captions that replace each other in one place.
  - hide() and show() on connectors and arrows, so a connector can leave with its node.
  - A size option on R.stat, and node sub text that follows the label size.
- **Motion guide.** Sizing for small diagrams, minimum gaps for labelled arrows, how flow timing works, where chart and window coordinates anchor, how far the camera can zoom on a wide diagram, and a layout recipe for each shot. These came from two trials in which a model wrote a scene from the guide alone.
- **Director planning.** The first run of the director with a real model failed at planning: the planner was asked for more detail than a plan could hold. Now:
  - over-long plan text and lists are cut to size instead of refused, and the sizes are stated in the prompt;
  - a refused plan gets a message naming each problem, and two repairs instead of one;
  - films over 20 seconds are planned as several scenes of 8–20 seconds, each with its own shots;
  - an unknown scene transition becomes a cut.
- **3D globe.** The globe draws the continents in bright dots over faint oceans (a 2-degree land map from Natural Earth's public-domain outline), and routes follow the great circle instead of sinking under the surface on long hops. `land: false` keeps the plain dotted sphere.
- **3D guide.** How big a unit is on screen, one view per shot, fading a view, what a pin returns, and where to aim the globe.
- **Phone layout.** Long button labels shrink with an ellipsis instead of widening the page. This was the cause of ten failed phone-width checks on the 0.74.0 commit (the "Use notes as captions for this scene" button was 21 px too wide).
- **Tests.** A failed browser test now prints what made the page wider than the screen.

## 0.75.0 — 2026-11-11

Assistants can bring images in and take finished videos out, and the workspace opens as a simple view with the editor one click away.

- **Overview first.** A project opens with the player, its scenes, the AI director and the export button, and nothing else. **Edit video** opens the editor; **Done editing** returns to the overview. Work done in either stays.
- **The editor.** A compact heading, the player beside the scene list, the timeline under them, then every tool as a tab: Director, Scene & layers, Design, Media & voice, Sound & captions, Export and Project. The tabs stay in reach while a long tool scrolls.
- **Your choice of start.** "Always open projects in the editor" (Project tab) is remembered in the browser.
- **Links into the editor.** `/?project=<id>&open=media` (or `editor`, `director`, `scene`, `design`, `captions`, `export`, `project`) opens a project at that tool. The MCP upload tool hands this link to people who add images by hand.
- **Less decoration.** The small capital labels above the project name, the preview, the director and the storyboard are gone.
- **MCP: images.** `upload_image` adds a small image from base64. `create_upload_link` gives a one-time link (15 minutes) that an assistant with a shell sends a file to (`curl -T logo.png <link>`), up to 25 MB. Both go through the studio's normal upload checks, storage limits and processing.
- **MCP: finished videos.** `export_status` gives a `downloadUrl` when the MP4 is ready: it works without a sign-in for one hour, with range requests. `get_download_link` makes a new link; `list_exports` lists a project's exports.
- **MCP: captions and names.** `set_captions` replaces the film's captions from a list of timed lines. `rename_project` renames a project.
- **Links.** Upload and download links are random tokens stored as hashes, each tied to one project or one export, limited to 60 live links per studio, and removed with the studio. An upload link works once; a file of the wrong type does not use it up.

## 0.76.0 — 2026-11-12

Sharper automatic checks and review, a light sweep, and faster 3D frames.

- **Text cut through by a panel is caught.** A callout laid over a checklist passed review in a live run: the layout check only compared text boxes with each other, at the six still times. It now:
  - samples every second as well as at the stills;
  - reports text that is partly hidden behind another panel (fully hidden text is fine, and so is text behind a dimmed backdrop, as under a dialog);
  - does not compare the two shots that are on screen during a shot change;
  - treats content inside any moved camera (a zoomed diagram, a shot sliding out) as framed on purpose.
- **Stricter review.** With stills, the director now judges each one against concrete faults: a third of the frame empty, a label too small to read, something cut off, a still that could be a slide, two stills alike.
- **Light sweep.** `R.shine(target)` sends a band of light once across a card, stat, button or window.
- **Tutorial reference.** Its dialog now dims the page behind it, as real interfaces do.
- **Planning.** No scene is longer than 20 seconds: a plan with a longer one is sent back with the number of scenes to split it into (a model planned one 24-second scene in a live run).
- **Guide.** Window body sizes, where a callout is attached and how to float it above a window, how long a drift lasts, the steps list's anchor, parking and hiding the cursor, and the highlighter's colour.
- **Stand-in tool.** `scripts/director-standin.ts` answers its response headers at once and keeps the connection alive, so an answer that takes more than five minutes no longer fails the run.
- **Faster 3D.** A 3D view whose shot is hidden or faded out is no longer rendered: frames with a hidden view render 20–25% faster in the measured scene (60 full-size frames).

## 0.77.0 — 2026-11-12

An inspector layout for the editor, and camera flight and depth of field in 3D.

- **Inspector.** From 1360 px wide, the editor has two columns: the player, scenes and timeline on the left; the tool tabs and the open tool on the right, scrolling on their own so the film stays in view. Below that width the tools stay under the timeline.
- **Panels fit their column.** The side column is a CSS container, and the tool panels' narrow (phone) rules also apply when a panel sits in a narrow column. The overview's side column benefits too.
- **Room for the editor.** Between 1360 and 1700 px the sidebar folds to its icon rail while the editor is open, and the account name, account settings and sign-out move to the header, as on a phone. Done editing or ← Studio unfolds it.
- **Camera flight.** `view.fly([{camera, target, fov}, …], {duration})` moves the 3D camera through poses in one smooth curve.
- **Depth of field.** `R.three({dof: {focus, aperture}})` blurs what is nearer or farther than the focus, and `view.focusOn(object)` pulls the focus to another object and follows it. It costs about 70% more render time on software rendering (60 full-size frames: 115 s against 66 s), so it is off unless asked for.
- **Tests.** `E2E_VIEWPORT=1760x1000` runs the browser suite at another window size, to exercise the inspector.

## 0.78.0 — 2026-11-13

Tool panels made for the inspector, a cheaper lens, and art direction for a more high-end look.

- **Tool panels in a narrow column.** In the inspector (and on a phone) each tool lays its fields out on a grid of at least two columns that fill their cells, instead of the phone's ragged rows. A checkbox sits beside its words rather than above them, file pickers show their button and the chosen file's name in full (they were cut to "No …osen"), the version picker takes a line of its own, and long button labels wrap instead of being cut. The inspector's tabs are one compact set of chips.
- **The Design tool's layer actions are buttons again.** Duplicate layer, Bring forward, Send backward and the centring buttons had lost their borders at every size (a rule meant for the layer list's compact buttons reached them).
- **Cheaper depth of field.** The lens now reuses the depth the view already drew, blurs a half-size copy (a gather blur in which a farther sample never spreads over a nearer, sharper one) and mixes it back by how blurred each pixel is. It looks the same and adds about a quarter to a 3D shot's render time instead of about 85% (60 full-size frames: 78–87 s against 124–127 s, and 62–71 s without it). The old bokeh pass is no longer in the bundled three.js.
- **Product shots.** `R.present(element, {from, to, push, duration})` shows a window, phone, card or logo plate in perspective, as if filmed, easing round and in, with a soft contact shadow and a moving reflection. The tutorial reference scene uses it for its terminal.
- **Restraint.** The director's guide now asks for one focal point per shot, at most three groups competing for attention, nothing kept on screen after its moment, scale rather than more things to fill a frame, and hand-drawn marks only in a hand-made style; the review judges each still for being busy. The tutorial reference scene replaces its hand-drawn marks with a shine and a glow.
