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
