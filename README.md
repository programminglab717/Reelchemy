# Reelchemy

A conversation-first creative studio. Start with an idea, review a storyboard, edit scenes, preview a deterministic composition, and download an actual MP4.

This is an actively developed local build toward the public product, with release gates still open. Demo mode uses a deterministic planner with three varied scenes; it is explicitly not an AI model. An OpenAI-compatible adapter is available and tested against mocked API responses. Native Claude Messages is also implemented. Both adapters have mocked-response tests; real paid-provider requests have not been verified.

## Run

Requirements: Node.js 24 (see `.node-version`; minimum 22.13), npm, FFmpeg/ffprobe on PATH, Chromium and Linux `flock` for the render and ingestion workers. This cloud machine already supplies them. On Debian/Ubuntu, install system prerequisites with `sudo apt-get update && sudo apt-get install -y ffmpeg chromium util-linux`; installation may require host permission. Other platforms must provide a compatible Chromium and set `CHROMIUM_PATH`.

```sh
cd /workspace/Reelchemy
npm ci --cache /workspace/.npm
npm run seed
npm run db:migrate
# Terminal 1: keep the render worker running
npm run worker
# Terminal 2: keep the media worker running
npm run ingest:worker
# Terminal 3: start the studio
npm run dev -- --port 3001
```

The development UI uses port 3001 because the onboarding machine already uses port 3000. This is a local development instance of a public-product work in progress. Authentication/resource isolation are implemented; do not deploy publicly until the production release gates in PRODUCTION_PLAN.md are met. No API credentials are required for the default workflow.

Optional server configuration: copy `.env.example` to `.env.local` without committing it. Next.js reads `.env.local`. For CLI rendering, export `CHROMIUM_PATH` and `RENDER_CONCURRENCY` in the worker's shell if overriding the defaults. Chromium defaults to `/usr/bin/chromium`, with two concurrent render frames (clamped to 1–4). In development, restart the worker after changing composition code: its bundle is cached for its lifetime. For production, rebuild and replace the immutable application image before restarting workers.

For a real model, set `AI_PROVIDER=compatible`, `AI_BASE_URL` to an HTTPS OpenAI-compatible API base, `AI_MODEL`, and `AI_API_KEY` on the server. Ensure that provider host is permitted by environment network settings. Keys are never sent to the browser. The mock path works without provider network access. This adapter expects JSON-object response support; compatibility varies by provider. For native Claude use `AI_PROVIDER=anthropic`, `AI_MODEL`, and `AI_API_KEY`; the default base is `https://api.anthropic.com/v1`.

Live planning also requires explicit input/output USD prices per million tokens for the selected model/gateway. The server reserves estimated cost before network work, with shared and per-studio rolling allowances and concurrency limits. Reported token counts settle that estimate even if a storyboard fails validation or loses a save race. Missing usage, transport failures and interrupted calls retain their reservation until a known receipt or explicit operator reconciliation. Demo planning/manual editing need no prices or key. See [OPERATIONS.md](OPERATIONS.md) for pricing, uncertainty and the read-only usage report; these estimates are separate from customer billing and the provider's invoice.

## Verify

Run the web server, render worker and ingestion worker before E2E tests:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run render:sample
npm run test:e2e
npm run format:check
```

Do not run `next build` against the same `.next` directory while `next dev` is running. Stop the development server for builds, then restart it for browser tests. Playwright defaults to port 3001 and system Chromium; use `PLAYWRIGHT_BASE_URL` to override the test server address.

`render:sample` creates `artifacts/sample/video.mp4`: five seconds, 1280×720, 30 fps, H.264, with three scenes and no audio. The command fails if ffprobe finds a codec, resolution, fps, or duration mismatch. Tolerance is one frame plus 10 ms. Each export also contains nine scene PNGs, three short motion clips, a thumbnail, and `report.json`. Motion clips are evidence for human inspection, not an automated temporal-QC pass.

The browser test creates a project, plans three scene strategies, saves an edit, approves an export, downloads the actual file, verifies it with ffprobe, and reloads the persisted project. It also captures desktop and mobile screenshots. See [VALIDATION.md](VALIDATION.md) for the most recent executed results.

## Architecture

```text
src/app/                 Next.js studio and Node API routes
src/components/Studio    Idea composer, preview, storyboard, editor, export UI
src/lib/schema           Zod scene DSL, domain types, timing and animation math
src/lib/provider         Deterministic demo + server-only compatible API adapter
src/lib/db               SQLite projects, messages, revisions, immutable job inputs
src/lib/qc               Bounds/overlap/missing-asset checks and capped bounds repair
src/lib/render           Remotion bundle/render, FFmpeg clips, ffprobe verification
src/lib/layout-qc        Chromium text measurement and capped font repair
src/lib/assets           Validated local image ingestion/resolution
src/video/               Shared frame-addressable preview/export components
scripts/worker           Single-worker SQLite queue, progress, cancellation, logs
scripts/seed             Idempotent demo-project initialization
examples/                Three valid scene-JSON examples
artifacts/               Ignored exports and visual evidence
.data/                   Ignored SQLite database and worker lock
```

Flow: brief → structured timeline → user approval → immutable job snapshot → capped bounds repair → deterministic frames → H.264 → ffprobe → QC evidence → download. No arbitrary generated JavaScript, remote asset URLs, or AI tool execution reaches the renderer. Uploaded images are decoded, re-encoded and resolved from local immutable files; original filenames never become storage paths. React escapes text; colors and geometry are constrained. One worker processes up to five queued/active jobs; each timeline is limited to 12 scenes, 20 layers per scene, and 60 seconds. Provider output is capped at 6,000 tokens and 60 seconds per request; repeated requests can still incur costs.

SQLite WAL supports the API and separate worker. Revisions retain every saved storyboard. Render jobs snapshot inputs so subsequent edits cannot alter an active export. A cancelled job never becomes completed. Export history survives refresh. On restart, an interrupted job is requeued once from its original timeline snapshot; another interruption after that limit marks it failed. Terminal jobs cannot be revived by late progress callbacks. Managed workers hold a permanent kernel lifecycle lock; never delete or replace `worker.lifecycle.lock` or `ingest.lifecycle.lock`. A crash releases the kernel lock automatically. Before handling an old diagnostic `.data/worker.lock`, stop older workers and inspect the recorded PID. Do not remove the database.

Animations depend only on frame index and fixed inputs. Rendering uses local Arial/system font fallback; identical inputs are deterministic on this machine, but cross-platform pixel identity is not promised. Files are stored locally by generated job ID. The DSL has no network or filesystem primitives. Custom motion keyframes are sampled at up to eight event frames per scene in addition to beginning/middle/end. Each project retains at most 30 image/video/audio uploads. Raw images/audio are capped at 10 MB, video at 25 MB, and decoded images at 16 million pixels. This is a restricted DSL rather than a container sandbox for arbitrary code.

## Current limits and next work

- The demo planner always produces three illustrative scene strategies. It does not understand an arbitrary story or create arbitrary characters.
- Editing supports scene-local or whole-plan prompt revisions, version restore, text/accent, scene reorder/duplicate/delete, duration, transition, format, layer geometry/color/motion, and custom frame keyframes. PNG/JPEG uploads include source/rights metadata and can be placed as image layers. Edits autosave; failed saves keep the current draft open during studio navigation.
- QC checks declared geometry/assets, keyframe bounds, and actual Chromium text geometry with shared rendering styles. Clipped text receives up to two local font-size correction passes; unresolved defects block export. Declared-background contrast, caption speed, and audio level checks produce warnings. Actual gradient/composite contrast, semantic analysis, and artistic motion review remain unimplemented. QC reports, stills, and clips are accessible from export history. Decoding every encoded frame checks file integrity, not motion quality.
- Optional uploaded audio supports frame-based start, trim, gain and fades (up to four tracks), AAC encoding, codec/duration checks and peak measurement. Captions are burned into preview/MP4 and downloadable as SRT/VTT. Projects without audio stay silent. Voice generation, advanced character rigs, generated media and external stock integrations remain to build. A simple layered character, arrows, gradients and whole-scene camera keyframes are available as deterministic primitives.
- Queue execution supports persisted stages/activity, cancellation, one automatic retry for transient browser/media timeouts, and bounded restart recovery. Identical scene video clips are reused through a content-addressed cache; still/clip evidence is recaptured per export. The render role has a non-root, read-only, network-disabled container with CPU/memory/PID limits. Distributed render workers, separate ingestion isolation and actual provider spend accounting remain future work.
- Formats 16:9, 9:16, and 1:1 have schema/preview support; verified encoded outputs are listed in VALIDATION.md.
- Account authentication, private studios and permanent project removal are implemented. Shared-workspace collaboration, expiring sharing, managed cloud storage, account erasure/retention and chosen-host production operations remain to build. Project data still lives on this machine.

See [CHANGELOG.md](CHANGELOG.md) for checkpoints. Verified checkpoints are committed locally as requested; no remote pushes have been made.

## Sound, captions and portable projects

Upload an audio file with its source/usage rights, add it in **Sound & captions**, then edit start/offset/duration in frames (30 fps), gain and fades. Audio files are capped at 10 MB and 120 seconds, decoded locally and normalized to 48 kHz stereo WAV. AAC exports are padded/trimmed to the video duration, with a limiter on the final mix. Preview uses per-track gain; the exported overlapping mix additionally limits peaks. Review narration timing and creative sound choices yourself; the checks verify technical timing and levels, not perceptual quality.

Caption cues must not overlap or exceed the timeline. Each cue is limited to 80 characters, displayed in the bottom safe area, and exported as SRT/VTT alongside the MP4. Cue boundaries are frame-based; subtitle milliseconds round to the nearest millisecond.

**Download editable project** saves scenes, chat, versions and local assets as a ZIP. Import it on the Studio home page to create a separate copy with new asset IDs. ZIP import is capped at 50 MB compressed / 150 MB declared uncompressed, 31 allowlisted entries, 25 MB per asset and a 10 MB project manifest. Assets are revalidated on import. Completed videos, render jobs, server configuration and credentials are excluded; rerender the imported project. Never assume the ZIP is a database backup or an environment snapshot.

## Recovery and incremental rendering

A single worker processes the queue. Automatic retries are limited to one and apply to transient browser crashes/disconnects and media command timeouts; schema, asset and QC failures are not blindly retried. Cancellation is terminal. `RENDER_JOB_TIMEOUT_MS` sets the per-attempt deadline (default 600000, clamped to 60000–900000). Subprocesses receive termination on cancellation/deadline and are killed if they do not exit. Activity logs are capped at 100 entries per job.

Scene video clips are cached under `artifacts/.scene-cache`. Cache keys include local scene/caption data, referenced image/video bytes, rendering source files, Remotion metadata and Chromium version. Checksums and codec/dimension/fps/duration checks validate cached entries. Cached clips are concatenated before audio mixing; changing standalone audio tracks alone does not invalidate visual clips. Video-layer settings currently participate in the scene cache key, including source volume. Captions do invalidate the affected scene clips because they are burned into the picture. Still and motion evidence is generated again for each export. Development code changes require a worker restart; production code changes require a rebuilt application image and worker restart. The bundle and source fingerprint are cached for the worker lifetime.

This is a single-worker local cache, not a shared render farm. Do not run multiple cache-writing CLI renderers against it at the same time. Cache files are derived and can be removed while all renderers are stopped; never remove `.data` or user exports to clear a cache. Managed Linux rendering now applies the bounded scene-cache retention policy below between exports; finished exports, project history and backups have separate retention. `REELCHEMY_RENDER_CACHE_DIR` overrides the cache location; `REELCHEMY_DATA_DIR` / `REELCHEMY_ARTIFACT_DIR` are available for isolated test data. Keep these paths consistent between API and worker.

Select **Selected scene only** in Live preview to loop a scene without rebasing its audio or caption timing. Camera keys affect the scene world; caption overlays stay fixed. Review camera motion and graphics manually—static layout diagnostics do not establish motion continuity or artistic quality.

## Public-account foundation (0.6)

The release target is now a public multi-user product. The current checkpoint adds identity and private resource boundaries; the editor, managed production storage, deployment/operations, wider abuse controls and public launch gates in PRODUCTION_PLAN.md are still being built.

All studio APIs now require a verified account. Create one at `/sign-in`, verify its email, then sign in. A new account gets its own empty studio. Project lists, edits, revisions, media, render jobs, evidence, MP4 downloads and editable archives are scoped to that studio. Render workers are trusted internal processes; they must not be exposed as customer-controlled services. The current migration still uses local SQLite/files, pending the production database/object-storage workstream.

For local development, auth creates a random private signing key in `.data/auth-secret`; verification/reset mail is queued as private `.data/mail/*.json` files. These files contain credentials/links: never commit, log or expose them through an API. Automated tests consume only their own synthetic mail. Use configured SMTP for normal manual email delivery. Production refuses the file-mail fallback and requires `BETTER_AUTH_SECRET` (32+ random characters), an HTTPS `BETTER_AUTH_URL`, `EMAIL_DELIVERY=smtp`, `SMTP_HOST`, `EMAIL_FROM` and a separate `REELCHEMY_AUTH_DIR` outside media/exports. Configure SMTP credentials in the deployment secret manager; do not supply them in chat. Signing secrets must be raw server-side deployment secrets, not network-proxy credential placeholders.

Run `npm run db:migrate` before serving a production deployment, with the same environment settings as the web service. Keep `npm run mail:worker` running alongside the web and render workers for SMTP delivery. The private outbox persists messages, caps delivery attempts, backs off failures and moves stale/exhausted messages to its `failed` folder. Delivery is at least once; inspect failed-mail counts through operational tooling rather than printing message bodies or token URLs. A real mail service and HTTPS staging deployment have not been live-validated in this checkpoint.

Existing prototype projects remain on disk but are not assigned to an arbitrary new customer. After registering/verifying the intended owner, run `npm run workspace:claim -- --email=owner@example.com` to inspect the legacy project count. Add `--apply` to assign only still-unowned projects. Never expose that operation as a public route. `.data/backups/studio-before-tenant-migration.sqlite` preserves the pre-migration project database; uploaded files remain in `.data/assets`.

Use `npm run test:isolated` for the complete browser suite. It starts its own development server on port 3002, render worker, private mailbox, temporary database/artifacts/cache and a temporary source/dependency mirror with its own Next-generated files. It never clears the real workspace or copies `.env.local` into the test app; it forces mock AI and a fresh test signing secret. Dependency copies are removed when the test services stop. `npm run test:isolated -- accounts.spec.ts` runs only the account/access/reset checks. This is development-mode integration coverage, not a claim of a configured public production deployment. `E2E_PORT` overrides the isolated port. The prior direct `test:e2e` command now requires an authenticated, development-mail-capable test server and matching data path for its fixtures.

## Manual editor and safe saving (0.7)

Choose **Start from a blank canvas** to edit without a planner. **Arrange scene** uses the same layer artwork as the renderer, with motion/camera/fades held at the base layout for placement. Select layers on the canvas or in the stack; drag, resize with the corner, center, reorder, hide or lock them. Snapping targets canvas edges/center; hold Alt to bypass it. Arrow keys move a focused layer by one composition pixel, or ten with Shift. Hidden layers stay in the project but are omitted from preview/export and visual QC. Locking prevents manual changes to a layer; it is an editing aid, not an authorization boundary.

The timeline provides a frame playhead, scene selection, zoom and visible scene/audio/caption ranges. The 0.8 controls below add direct movement/trimming and scene splitting. Audio waveforms remain to build.

Edits autosave after 900 ms without further changes. Saves run in order, and a response cannot replace a newer local edit. Undo/redo keeps up to 50 timeline states across saves while a project is open; reopening/reloading starts a new undo history. Use the saved version list for older persisted states. Ctrl/Cmd-Z and Shift-Ctrl/Cmd-Z operate on the editor outside text inputs; Ctrl/Cmd-S saves. Native input undo remains available while typing. Invalid timeline edits are rejected with a visible message.

Studio navigation and sign-out save outstanding edits first; failed saves keep the current draft open. Browser unload warns while changes are unsaved. Timeline edits keep bounded, account-scoped browser recovery copies as described below. Browser storage can still be cleared or unavailable; important work should be saved or downloaded. Save conflicts preserve local work, offer a JSON draft download, and require an explicit replacement action to open the latest server version. The JSON draft is an inspection/recovery file, not an importable project archive; editable project ZIPs remain the supported portable format.

Project PATCH uses `{timeline, baseRevisionId}`; the base is the last saved revision ID (or null for a project without versions). A stale base returns HTTP 409 with `REVISION_CONFLICT`. Restore requests also include `baseRevisionId`. Timeline commits compare the persisted revision inside a SQLite transaction and retain newly uploaded asset metadata. Asset uploads merge into the open editor without replacing its local timeline/history. Each settled timeline save currently adds a persisted version; production retention/storage quotas remain unfinished.

Layer **Custom keyframes** and **Scene camera keyframes** now provide frame markers, a frame slider, offset/scale/opacity fields, and add/remove/reset actions. Values at an unkeyed frame begin with the interpolated pose. Custom keys replace a layer's preset animation and interpolate linearly. Up to 30 keys fit within each scene. Advanced JSON remains optional; it validates order/timing and follows visual edits. Inspect actual movement in **Live preview** and the export's motion clips; the arrangement canvas deliberately displays base geometry.

## Footage and editable tracks (0.8)

Upload **MP4 / MOV / WebM** with its source/usage rights, then choose **Add video to selected scene**. A clip starts behind the existing artwork so titles remain on top. **Footage range** controls set scene start, source in, length, fit-entire-clip versus fill/crop, and source-audio volume. Values use seconds and snap to 30 fps. Hide mutes the clip as well as hiding its picture. Lock prevents direct clip edits. Source audio joins the existing audio tracks in preview and the AAC export mix, with at most 32 audible clips/tracks in a timeline.

Input clips are capped at 25 MB, 120 seconds, 8.3 megapixels and 120 fps. H.264, HEVC, VP8, VP9 and AV1 in MP4/MOV/WebM containers are accepted by the validator. Normalization removes source metadata, limits picture size to fit within 1920×1080 without upscaling, converts to 30 fps H.264 and retains source audio as AAC. The normalized file must also fit 25 MB, preserve duration within three frames and fully decode. Normalization has a two-minute deadline; decoder support and performance remain platform-dependent. These limits do not raise the current sixty-second project/output-size caps or constitute an OS-level media sandbox.

Private media GET supports single HTTP byte ranges for browser seeking, with authentication/resource authorization applied before range handling. Render-time images, video and audio are served by `render-assets.ts` only on a random loopback port with a fresh capability token and an allowlist of that immutable job's media IDs. The server streams bounded ranges from retained regular-file descriptors, serves no directory, rejects symlinks/pipes, and closes connections/files after the attempt. Media bytes are never embedded in renderer props or URL queries. Image rendering waits for decode before capturing a frame. Cache keys use streamed file SHA-256 values, so temporary source ports/tokens do not defeat clip reuse. Keep worker ports private; they are internal services rather than public media endpoints.

Select a scene and move the playhead, then use **Split scene at playhead**. Both parts require at least one second and the project stays within 12 scenes. A split preserves total duration, global captions/audio, source frame ranges, preset phase, custom/camera keyframe poses, and the original outer fades; it introduces a cut between the two parts. Undo/redo includes the entire split. Background-only scenes are valid when a source clip ends before the cut.

Video, audio and caption bars can be dragged to move; their edge handles trim. A focused handle supports Left/Right by one frame, or ten with Shift. A gesture creates one undo step. Source-media and scene boundaries clamp edits; a left trim also adjusts the source offset. Caption bars stay between neighboring cues and cannot overlap them. Short audio trims cap fade length to half the resulting range. Numeric controls remain available. Waveforms, freeform crop positioning, ripple/delete-time edits, recording and long-video performance targets remain future work.

Editable ZIPs include normalized footage, clip settings and source-audio metadata. Import revalidates/re-encodes footage, remaps IDs and checks ranges against the real decoded source. Portable archives are capped at 50 MB compressed / 150 MB uncompressed / 25 MB per asset; export rejects an oversized ZIP rather than offering a file the importer cannot accept.

## Narration, captions and project management (0.9.0)

Use **Record narration** in Project assets to capture up to 60 seconds. Recording needs HTTPS or localhost, microphone permission and AudioWorklet support. Preview/download the take, give it a name and usage rights, and save it to assets; **Add audio** places it on the timeline. Start pauses the preview to avoid feedback. Unsaved takes stay in browser memory and are guarded during in-app navigation/sign-out and page unload; save or download them before closing the tab. Upload errors retain the take for retry. Hardware/browser recording quality still needs creator testing.

Audio and audible-footage bars display frame-based waveforms that follow source in/out points and clip volume. They show source amplitude, not loudness or the final mix; fades, the multi-track sum and the export limiter still need listening. A waveform error offers retry without blocking normal editing/export.

Sound & captions includes global font/color/position/alignment/background controls. Font size scales with the shorter output edge; captions stay within an 8% side safe area and use the chosen 3–12% top/bottom margin. Chromium measures every cue for clipping before rendering; shorten text or reduce size when a caption does not fit. Contrast warnings need visual review.

Import plain UTF-8 `.srt`/`.vtt` files up to 64 KB and 100 non-overlapping cues, each 1–80 characters, within the current video duration. Review before merging or explicitly replacing existing cues; either action is one undo step. Timing rounds to 30 fps, line breaks flatten, supported basic markup is removed, and unsupported positioning/STYLE/REGION/embedded timestamp syntax fails explicitly. Download current SRT/VTT without exporting an MP4. Subtitle files carry text/timing; appearance is stored in the project and burned into the MP4.

Search projects by name and load additional pages from the sidebar or mobile project library. Rename changes metadata without clearing timeline undo/history; a stale concurrent rename returns a visible conflict. Trash, restore and explicit permanent project removal are private operations. Account erasure and operator retention still have open release gates.

`GET /api/health/live` reports process liveness. `GET /api/health` returns 200 only when the studio database, authentication initialization, writable storage/free-space floor and a render-worker heartbeat are healthy; otherwise it returns 503. Responses contain booleans only, without paths, credentials or project details. Heartbeats expire after 30 seconds. `REELCHEMY_MIN_FREE_BYTES` defaults to 200 MB (clamped to 50 MB–10 GB). This is an availability probe, not a render-capacity or SMTP-delivery guarantee. AI credentials are not required for readiness.

The GitHub Actions workflow runs local/static/unit/build checks and isolated browser/media tests with demo AI and private synthetic mail. It is configuration until a hosted run is recorded; no remote push was performed.

## Backup and restore

`npm run backup -- create <new-directory>`, `verify <backup-directory>` and `restore <backup-directory> <new-restore-directory>` provide private checksummed SQLite/media/export snapshots. Restore preserves the source installation, verifies before copying, revokes copied sessions/tokens and marks pending exports failed for an explicit restart. Stop all writers for a coordinated snapshot; use a new destination each time. See [OPERATIONS.md](OPERATIONS.md) for inclusion/exclusion rules, private storage requirements, an isolated restore drill and remaining production operations work.

## Text styling (0.10.0)

Select a text layer on the canvas to edit its content, size, system font family, weight, alignment, line/letter spacing, italic and underline styling. The same controls are available in the layer inspector. Locked layers disable editing. Reset keeps content and size, and resets the other text styling; undo restores the previous appearance. Autosave, versions, scene splits and portable archives retain the styles.

Rendering and layout diagnostics use the same style function. Text that cannot fit after bounded font repair blocks export. These are system font families with platform fallbacks; uploaded brand fonts, arbitrary font URLs, masks and ripple editing are still separate work.

## Recoverable project removal (0.11.0)

**Move project to Trash** saves the editor first and asks for confirmation. Media, saved versions and completed exports are retained; queued/rendering exports are cancelled. Normal resource routes become unavailable until the owner restores the project from the searchable Trash page. Restore does not restart cancelled renders. An unsaved narration take must be saved or discarded before Trash navigation/removal.

Trash works on desktop/mobile and offers retry for loading errors. Trash alone retains files/storage without an automatic deadline. Its explicit permanent-removal workflow is described below; account erasure and operator backup/cache retention remain production release gates.

Unit/media checks use at most two test processes to keep worker startup and Chromium layout checks reliable on a small host. Run builds and browser/media checks sequentially when sharing limited CPU resources; do not increase heartbeat freshness allowances to hide an unavailable worker.

## Public request windows (0.12.0)

Verified workspaces share persistent request counters across web-process restarts. Defaults are **120 writes per minute**, **30 media upload/import attempts per hour**, **60 planning attempts per 24 hours**, and **30 export attempts per 24 hours**. Windows start with the first request after expiry. The general write limit also applies to the specific operations. Ownership and origin are checked first; request attempts that later fail validation/provider/queue processing still count. Reading saved work/media is not charged to these write windows.

Exhaustion returns HTTP 429, `RATE_LIMITED`, and a `Retry-After` value. Editing keeps local unsaved work when a save is limited; recording uploads retain the take for retry/download. Counters are scoped to the workspace and transactionally admitted. Invalid limit configuration disables mutations with 503 and makes readiness fail.

Server settings in `.env.example` tune these positive-integer counts. Isolated functional tests use the real default policy and synthetic accounts. These are request abuse controls, not stored-byte quotas, actual token/spend accounting, paid credits, IP/WAF protection or distributed media-process isolation. Those remain public-production work.

## Media framing (0.13.0)

Select an image or video layer on the canvas to **Fit** the complete source or **Fill and crop** to the layer box. Horizontal/vertical framing selects which portion is visible. Drag previews update the canvas; release commits one undo step, and Escape cancels. **Center media** resets alignment while retaining the fit choice. Locked layers disable these controls.

The source file stays intact. Autosave, versions, scene splitting, portable projects and exports preserve the fit/framing. Framing is constrained to normalized positions; generated scene data cannot inject arbitrary CSS or remote media sources. Rotation and more advanced masking remain separate work.

## Production runtime checks (0.14.0)

The Dockerfile supplies a non-root Node/Chromium/FFmpeg runtime and an isolated HTTPS test target. `npm run container:build -- --target test` builds the test image; its default command runs all browser/media workflows against the production build with secure cookies, a trusted disposable local CA, fresh migrated accounts and no external network. AI stays in demo mode and account mail stays in a private outbox. See [OPERATIONS.md](OPERATIONS.md) for commands, evidence collection and the single-host Compose template.

`npm run worker` now holds a Linux kernel filesystem lock, so a forced crash releases ownership without trusting a potentially reused container PID. A second worker is rejected, and managed restart replaces stale diagnostics. Stop any old plain-PID worker before upgrading; retain the lifecycle lock inode. Production startup uses an explicit authentication migration. The build also checks that authenticated studio/Trash pages remain dynamic.

These runtime checks do not constitute public deployment or launch acceptance. Hosting, public HTTPS/SMTP delivery, durable off-host operations, capacity/long-video benchmarks and the remaining product release gates still need completion. Hosted CI is configured; its execution is not claimed here.

## Planning with project media (0.15.0)

Configured provider requests include this project's image/video/audio IDs and descriptive media metadata, so a director can select uploaded media. Source files, local source paths, credentials and other customers' asset catalogs are not included. Returned timelines must reference media owned by this project, match its media types and source ranges, and retain the requested output format/duration. These contracts are tested with offline provider responses; live planning quality remains unverified.

A whole-plan revision uses the current edited duration and format while retaining the original brief. A targeted scene revision sends that scene and preserves unrelated scenes, narration and captions. Editor/planning commits check current ownership, Trash status, revision and media metadata together under a database write lock. A late response cannot replace a newer saved revision or save into a project moved to Trash.

## Render lifecycle checks (0.16.0)

An export reuses one Remotion browser across composition selection, scene encoding and preview stills, then closes it on success, failure or cancellation. The layout checker has its own separately closed browser. The demo planner and asset-reference validation are pure modules; browser composition code does not import native server image processing or provider code. `npm run build` compiles both Next and the independent Remotion browser entrypoint.

`npm run test:runtime -- --image reelchemy:local` checks the built app image under the Compose restrictions using a unique disposable project/volumes and synthetic media. It checks migration/readiness, non-root/read-only filesystems, render network/environment credentials, a real footage/caption/AAC export, duplicate-worker rejection and forced in-flight container-crash recovery. It never starts SMTP delivery or a paid provider, and cleans up only its disposable services/volumes. See [VALIDATION.md](VALIDATION.md) for executed outcomes; script availability alone does not mean the service test or public staging has passed.

## Studio media allowance (0.17.0)

Each private studio defaults to **512 MiB of processed image/video/audio files**, configurable with `REELCHEMY_MEDIA_STORAGE_BYTES`. The allowance includes all its projects and Trash. The assets panel shows usage and offers refresh/retry. Processed PNG/WAV/MP4 files can occupy more space than the original upload; admission measures stored files and recalculates imported media.

Uploads/imports that exceed the allowance return private HTTP 413 with `MEDIA_STORAGE_LIMIT` and owned usage/required/remaining byte counts. They leave no partial project or newly processed accepted files. Ownership, active project state, asset count and quota are checked in one write transaction. Reading/exporting existing media, manual editing and imports without added media remain available when already over the allowance. Moving a project to Trash retains its storage usage.

`GET /api/workspace/storage` reports only the verified caller's studio. Invalid policy values fail uploads closed with 503 and fail the readiness limits check. This is a retained-media allowance; exports, cache files, backups, provider costs and global processing capacity require their separate controls. Use `npm run db:migrate` before starting a new production version; [OPERATIONS.md](OPERATIONS.md) covers coordinated backups and index repair.

## Safe export retries (0.18.0)

The editor saves pending changes before export and approves that exact saved revision. If another tab saved a newer video, export returns a revision conflict and offers draft download/open-latest recovery rather than exporting unseen changes. Active ownership, Trash state, current media validation, static QC, queue capacity and snapshot admission are checked in one SQLite write transaction.

`POST /api/projects/:id/render` accepts an optional JSON `{baseRevisionId}` and an optional UUID `Idempotency-Key` header. Bodyless clients still export the latest saved project. Repeating the same project/key/requested revision returns the original job with `Idempotency-Replayed: true`, including a completed, failed or cancelled job; it never starts it again. Reusing that key for a different requested revision returns 409. Start a deliberate new export with a new key. Keys are scoped to a project and remain private behind its ownership/active-state checks. The current editor preserves a retry key while that editor remains open after an uncertain response; this is not cross-reload/offline request recovery.

Retry attempts still consume the normal write/export request allowances. A stored receipt can replay even when the global queue is full, but cannot bypass authentication, Trash or those request limits. Receipts are retained alongside job history in the studio database, included in snapshots and preserved by restore; restored interrupted jobs remain failed when replayed and require a new key for a new export.

## Isolated unit checks

`npm test` gives media-only tests a fresh private fallback data/artifact/cache root, forces offline demo/file-mail settings, removes inherited provider/SMTP/signing credentials and cleans that fallback root when the suite exits. Individual database/account tests retain their own isolated fixtures. No application `.env` or saved user storage is needed. Use `npm test -- tests/assets.test.ts tests/archive.test.ts` to select files. Tests default to a two-minute timeout; the three-format full-resolution render comparison has a four-minute integration deadline. Run expensive browser/build/unit checks sequentially on this four-core host. For Chromium-heavy checks here, use the disposable tini verification container to reap browser descendants.

## Compact project libraries (0.20.0)

Studio search/pagination and Trash request `GET /api/projects?view=summary`. Each result contains only `id`, `name`, `createdAt`, `revisionCount` and, for Trash, `trashedAt`. Existing filters, private scope and pagination headers apply; metadata is extracted in SQLite without hydrating full project histories in JavaScript or the browser. Opening a project fetches its full saved editor data. Omitting `view` (or choosing `full`) preserves the existing full-project API response for clients.

This reduces listing payloads and browser memory. Histories still reside inside project JSON and are loaded when opening/saving a project; normalized/lazy history storage and realistic long-project benchmarks remain open.

## Layer rotation (0.21.0)

Select a canvas layer to rotate it from −180° to 180° with a slider, a typed angle, quarter-turn buttons or reset. Canvas slider drags preview without saving and commit as one undo step; Escape cancels. Numeric edits commit on blur/Enter, and invalid or cancelled values keep the previous layer. Locked layers disable the controls. The layer panel provides the same saved angle.

Artwork and selection rotate around their center in actual composition pixels. The resize handle follows the rotated corner; dragging it changes local width/height while keeping the opposite corner fixed, within existing base-geometry limits. Moving/nudging still uses canvas axes. Rotation is retained in saves, versions, scene splits and portable projects. It is a static layer angle; animated rotation keys are not implemented.

Rotated artwork can extend beyond the composition and be cropped. QC warns about that base-position crop without silently changing the angle; resize or reposition if it is unintended. Text-overlap checks use rotated rectangles. These are geometric checks, not glyph-level collision or complete motion/perceptual review.

Portable archives containing rotated current or historical layers declare archive version 2 and require `layer-rotation-v1`. Older releases reject these archives instead of silently dropping the angle. Projects without rotation continue to use version 1; the current importer accepts both formats and rejects unknown required features before ingesting media.

## Active Studio exports (0.22.0)

The Studio exports panel shows queued/rendering videos across your private projects, their progress and actions to open a project or cancel its export. It refreshes automatically and offers explicit retry after a failed check. Finished exports remain in each project's history; moving a project to Trash cancels its active jobs.

Public admission defaults to **two active exports per studio**, within the existing five-job shared queue. `REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO` accepts whole values 1–5; invalid settings fail readiness/new admission. Capacity checks run inside the same immediate transaction as ownership/revision validation and snapshot/receipt creation. A retry receipt replays its existing job even at the studio/shared ceiling. Trusted offline `createJob` callers retain only the shared cap.

A studio ceiling returns 429; a full shared queue returns 503. Both carry `EXPORT_CAPACITY`, a private no-store response and a 30-second Retry-After hint, which does not reserve a future slot. Retry attempts still consume the normal write/export request allowance. `GET /api/workspace/exports` returns only the caller's active metadata/current limit; it accepts no alternate workspace selector. Queue/project indexes avoid repeatedly scanning completed-job history. This is admission control for the single worker, not autoscaling, a load benchmark or a provider spending budget.

## Private account storage (0.23.0)

Production requires `REELCHEMY_AUTH_DIR` outside the media and export directories. Accounts, local signing-file material and queued mail use that directory. The Compose template mounts its private authentication volume into web/migration/mail services and omits it from render; the mail service has no media/export volume. Build guards exclude runtime/account/environment files from server traces. Development retains the existing `.data` account fallback unless a separate directory is configured.

Existing combined production storage must undergo a coordinated **backup → restore to new directories → switch mounts** cutover; production refuses known legacy account/mail files left in media storage. Restore always returns separate `data`, `auth`, and `artifacts` paths, preserves the source, and revokes sessions/tokens only in the restored copy. Supply all returned paths; a development restore also refuses a missing account-path setting instead of creating an empty account database. See [OPERATIONS.md](OPERATIONS.md) for the cutover/drill. No in-place credential deletion or real-workspace auth cutover is performed by this update.

### AI failure handling (0.24.0)

Configured provider bases must be HTTPS URLs without embedded credentials, query strings or fragments. Keys must be nonempty visible ASCII without whitespace (maximum 4096 characters); model identifiers use the same character rule with a 200-character maximum. These checks run locally without a provider request. Keep the default demo mode until final live verification.

Requests refuse redirects and are not automatically retried. A 60-second timeout includes response streaming; successful response envelopes are limited to 512 KiB. Invalid configuration, connection/HTTP failures, timeouts and unusable storyboards return fixed error codes and messages without exposing raw provider bodies or secrets. Failed plans do not create partial revisions. Request counts and the 0.36 shared/studio spending ledger are separate controls. Real usage/invoice reconciliation and output quality remain final live release gates.

### Recover unsaved timeline edits (0.25.0)

The editor keeps account/project/tab-scoped recovery copies in this browser when the timeline changes. After a failed save or reload, reopen the project and review the recovery panel. Recovering is an explicit edit with undo and autosave; a copy based on an older saved version needs confirmation and does not remove saved versions. Download or deliberately discard individual copies. Other tabs keep separate records; a changed copy cannot be erased by a stale discard/save action.

A successful save removes its matching recovery copies. Signing out clears this account's copies, with confirmation when copies remain. No unrelated browser/account data is cleared. Records are validated and limited to 512 KiB each; a full or unavailable browser store shows a download fallback and does not block ordinary saving or evict other drafts. Recovery contains the timeline, saved-base ID and account/project identifiers; uploaded media, microphone takes and full version history are not copied into browser storage.

This is recovery for timeline edits, not a fully offline application: reopening projects and saving/exporting still need the server. Browser storage can be cleared by the browser or device owner and is not an encrypted backup. Use a private browser profile on shared devices and download important unsaved work. The application's coordinated backups include saved server state, not these browser copies.

Downloaded recovery files can be reopened through **Keep your project → Recover a downloaded draft** in the original account/project (2 MiB maximum). Both current recovery JSON and earlier unsaved whole-project JSON are supported; only the timeline and saved-base identifier are imported. The original uploaded media must still belong to the project. Recovering an older base needs confirmation and creates an edit through normal version/concurrency checks. Use an editable project ZIP for transferring a complete project with media/history into another project or account.

### Permanent project removal (0.28.0)

From Trash, choose **Delete permanently**, review the named project's scope and type **DELETE**. Cancellation leaves it in Trash. Confirmed removal immediately hides its resources and cancels unfinished exports; the worker removes its files after the current operation closes. The Project removals panel shows progress/failures and allows retry. A lost response can be retried safely, including after cleanup completes. The studio's retained-media allowance is reclaimed when cleanup finishes.

Cleanup preserves media still referenced by another project, its saved history or an immutable export. It removes only the selected project's export folders and clears that studio's rebuildable scene cache; other projects' finished exports remain. Existing recovery copies for the selected project in this browser are cleared; other projects/accounts are untouched. This cannot be undone through Trash. Previously downloaded copies, other devices, older backups and storage-provider snapshots have separate retention.

New coordinated backups omit projects already requested for permanent removal, even while cleanup is pending or needs retry. They preserve deletion intent on restore and keep shared/other-project data. This normalization changes only the new backup copy, never the live source. Older backups are retained under the operator's separate policy. This is removal from active application storage, not a claim of cryptographic/forensic erasure or permanent account deletion.

Private studio requests are bound to the account that opened the page. If another tab changes that account or the session expires, the open studio stops private requests, keeps its local timeline recovery copies and offers a reload. Download unsaved edits before reloading. The newly signed-in account does not inherit those recovery copies; sign back into the original account to recover them. Downloads and media URLs continue to require their verified owner.

Exports can reuse captures within static cut scenes containing still text, images and shapes with a few caption changes. The resulting file still contains every frame at 30 fps, with exact caption boundaries. Moving footage, continuous SVG motion, layer/camera animation and fades use the regular renderer. This optimization does not increase the supported project duration or output sizes.

Open **Reuse media from your studio** in Project assets to search images, footage and audio from your other active projects. Filter by type or load more results, then reuse an upload and add it to a scene or audio track. The original normalized file and usage rights stay shared, so it counts once toward the studio's storage. Permanently deleting its source project keeps the file while another project or retained export needs it. Reuse preserves unsaved timeline edits; an uncertain response can be retried. Trash uploads require restoring the source before a new reuse, and the per-project 30-upload limit still applies. Asset insertion respects the selected scene's layer limit, so a full scene does not block another scene.

Studio navigation and controls use inline SVG icons, so a minimal system-font installation can render them. The current account's name appears in the desktop profile and mobile studio identity row. Long names are visually bounded; account-switch recovery still belongs to the account that opened the editor.

## Durable media processing

Uploads/imports and uncached waveforms are processed by `npm run ingest:worker`. The web process reserves a bounded slot before reading a body; by default four input requests share a 256 MiB raw-file reservation budget, with one outstanding input per studio. Waveforms have separate analysis admission and a 120-per-hour preparation allowance; existing cached waveforms remain readable. Image/audio/video format, duration, pixel, retained-byte and project limits still apply.

Clients may send `Prefer: respond-async`, a UUID `Idempotency-Key` and an optional canonical `X-Reelchemy-Media-Intent` SHA-256 to upload/import endpoints. A 202 response contains a private request receipt and Location. `GET /api/media-requests/:id`, `GET /api/workspace/media-requests?offset=0` and `POST /api/media-requests/:id/cancel` require the verified owner and preserve account binding. Unfinished work survives a browser disconnect; completed attachments cannot be removed by cancelling the receipt. Existing clients receive their 201 project response after completion. Retries remain subject to normal request windows.

Receipts are retained for seven days after terminal cleanup, so idempotent replay is bounded to that period. Processing uses one kernel-locked consumer and at most one automatic crash retry, preallocated output IDs, fresh target/rights/quota checks, and atomic attachment/completion. Trash cancels pending input; permanent removal waits for its cleanup acknowledgment. A receipt never releases raw capacity before physical cleanup. Configure native worker media paths/allowances in its environment to match the web process; Next's `.env.local` is not loaded by the codec worker. The production Compose role supplies the shared settings and mounts only studio data, with no network or auth/artifact volume. This is separate from the public staging/load and live-provider release gates.

The studio's **Media processing** panel shows accepted uploads/imports even after refresh. You can cancel unfinished work or open its completed project. File controls keep their selection after a failed response; narration keeps the local take for retry/download, and imports offer **Retry import**. Retrying the same file/name/rights in that control recovers its existing receipt. Changing the file or metadata starts a separate request. A local polling timeout does not discard already accepted work; check the panel before starting another upload. Refreshing clears the browser's file selection but preserves accepted server requests.

Completed uploads refresh the private media catalogue at `GET /api/projects/[id]/assets`, which returns only the project ID and at most 30 validated asset metadata entries. It excludes timelines, conversations and version history, and preserves unsaved timeline edits in the editor. Main editor reads and normal save/plan/restore/rename responses now use the compact 0.39 view described below. A completed archive import can still initially return its bounded full portable project.

Each new input records the web process's admitted retained-byte allowance. Attachment enforces the lower of that value and the worker's current limit, so a missing or larger worker-shell setting cannot expand the admitted budget. Keep all roles on the same release/configuration and restart them together when changing storage policy. Native fault-injection browser cases refuse to signal processes outside the disposable `test:isolated`/`test:production` fixture; use those harnesses for the complete suite.

**Browse saved versions** opens a paginated history with read-only film playback before restoration. Previewing keeps your current timeline and browser draft intact. Finish saving and save/discard any narration take before restoring; restoration creates a new saved version while retaining earlier work. If a restore response is lost, its revision check prevents another append from the same baseline; **Reload current saved film** recovers the server's confirmed state. The quick-restore selector remains available. History previews use bounded metadata and one snapshot read; initial project opening and saves still use the existing embedded-history contract, so normalized/lazy editor storage remains separate work.

### Browse and preview saved edits (0.37.0)

Choose **Version history → Browse saved versions** to page through retained edit metadata and preview a selected film before restoring it. The current preview pauses while the history dialog is open. Preview remains available while current timeline edits are unsaved; restore waits until they are saved. A restore adds a version and preserves earlier work. Read failures have retry controls; an uncertain restore offers retry or explicit reload of the current saved film. Private history metadata is paged 20 at a time, and one validated preview is limited to 2 MiB. The 0.39 main editor uses a compact current-film view; the underlying history remains in embedded storage.

### Portable retained history and reliable downloads (0.38.0)

Editable ZIPs now preserve up to 10,000 saved versions and 10,000 conversation entries within the independent 10 MB manifest cap. Exceeding a count or byte limit returns an error and leaves all source history intact. Format 3 declares `large-history-v1` when history exceeds the older 500-version/1,000-message limits, plus `layer-rotation-v1` when needed. Smaller projects keep format 1 or 2 for older importers. Older releases cannot import format 3; update the receiving application. Unknown or duplicate required features are refused before normalization. Imports repair empty, control-character or duplicate revision IDs only in the imported copy; usable unique legacy IDs and all retained edit content remain intact.

**Download editable project** saves pending timeline edits, uses the rendered account's private API, and checks status, ZIP content type and bounded received bytes before offering a file. Failures remain visible with the same retry button; **Cancel download** stops the browser request. Editing can continue during preparation, and edits made afterward stay in the current project. Media export reads only bounded regular files through an anchored private directory; missing/changed media, symlinks, FIFOs and oversized files produce fixed errors without private paths. These are portable project files, not backups of accounts, exports or server configuration.

### Restore concurrency (0.38.1)

Restoring a retained film rechecks current ownership, Trash/deletion intent, saved revision and owned media in the same database transaction as the new version. A project moved to Trash or changed while the request is arriving cannot be silently restored over that change. Invalid/ambiguous retained snapshots are refused without changing the current film; the browser offers retry or explicit current-film recovery when a response is uncertain.

### Compact main-editor history and saved directions (0.39.0)

Opening a film loads the current validated timeline, owned media, 20 recent version summaries and up to 50 recent creative directions. **Browse saved versions** continues to expose older films. The director panel offers **Earlier directions**, **Newer directions** and **Latest directions** in pages of 50; a failed read retries without replacing current edits. The version count reflects all retained versions. No saved history or directions are pruned by these reads.

The browser declares `X-Reelchemy-Project-View: editor-v1` on its private requests. Project creation/read/save/plan/restore/rename responses use the typed editor representation with total counts; revision summaries contain identities/labels/dates, rather than historical timelines. Omit the header to retain the legacy full-project API. `GET /api/projects/[id]/conversation?before=N` uses an exclusive absolute message index, so concurrent appends do not shift earlier ranges. Invalid legacy entries advance raw cursors and show an unavailable-entry notice. Current timeline projection is limited to 2 MiB; arbitrary legacy fields never enter the editor view. A changed saved revision during response preparation yields a conflict rather than adopting another writer's revision as this edit's baseline. Rename also rechecks active ownership after receiving its body.

This reduces browser transfer/state and avoids full historical JSON hydration for ordinary editor GETs. Storage is still embedded JSON, and server-side mutation paths still hydrate/rewrite complete projects; database normalization and metadata/history retention quotas remain separate work. Completed import admission can initially return the full portable project within archive limits.

### Rebuildable scene-cache retention (0.40.0)

The managed Linux renderer maintains at most **1 GiB shared / 256 MiB per studio / 5,000 completed clips**, with **seven-day** expiry, between exports. Successful checksum/codec validation refreshes a clip's last-used time. Interrupted private staging entries are reclaimed under the same render lifecycle lock. Current rendering can temporarily exceed the steady-state budget; these limits do not reserve disk for an active export or govern originals, finished videos, history or backups. Logical managed bytes differ from total filesystem usage; hard-linked temporary still frames are counted once.

Configure the renderer only with `REELCHEMY_SCENE_CACHE_BYTES` (1 MiB–64 GiB), `REELCHEMY_SCENE_CACHE_BYTES_PER_STUDIO` (1 MiB–16 GiB, no greater than shared), `REELCHEMY_SCENE_CACHE_ENTRIES` (1–20,000) and `REELCHEMY_SCENE_CACHE_DAYS` (1–90). Native workers do not read the web's `.env.local`; export these settings in their shell or use the Compose renderer settings. `REELCHEMY_RENDER_CACHE_DIR` must name a dedicated cache directory, outside account storage and primary upload/input/waveform/export locations. The default remains `artifacts/.scene-cache`.

`npm run cache:prune` reports a read-only aggregate plan without creating directories, databases, authentication files or lifecycle locks. After stopping all render producers, `npm run cache:prune -- --apply` applies a freshly checked plan under the permanent render lock. A live kernel owner or old worker PID refuses the command. The worker and sample-render command use that same lock; sample rendering respects `REELCHEMY_ARTIFACT_DIR` and cancels native work before releasing its lock. Never delete or replace `worker.lifecycle.lock`.

Cache maintenance admits only known cache namespaces, hash entries, clip/manifest files and interrupted still-capture layouts, using stable no-follow directory descriptors and identity rechecks. Unknown files, symlinks, changed directories, unsafe configuration or inspection limits pause new exports and mark the worker not ready; queued work stays queued. Move unexpected data to a private quarantine with renderers stopped, or configure a new empty dedicated cache path, then retry. Do not blindly delete unrecognized files. Permanent project cleanup uses the same guarded cache scope. Published cache reuse still requires a bounded manifest, regular video, full SHA256, codec/dimension/fps/frame-count/duration checks and an unchanged file; retention does not replace those checks.

### Prepared production video renderer (0.41)

`npm run build` retains a compiled Remotion composition in `.next/reelchemy-renderer`, with a bounded content inventory tied to that build's `BUILD_ID`. Ship the complete build directory in the immutable application image. Production workers verify these assets before readiness or taking exports; missing, mixed or corrupt assets require a clean application build. Production rendering uses these read-only assets without importing the webpack compiler or writing a runtime webpack cache. Development/test rendering still compiles on demand. Existing scene-cache, video quality and cancellation checks remain enabled. This reduces runtime compilation work; longer-video and higher-resolution support still need measured acceptance.

### Retained project allowance and saved-history cleanup (0.42 candidate)

Retained current-film/history/direction/asset-metadata JSON has shared, studio and project admission limits. Defaults are 32 MB per project, 256 MB per studio and 4 GB shared, with 500 projects per studio, 20,000 shared, and 10,000 versions/directions per project. Trash counts until permanent removal completes; unassigned legacy projects count toward the shared budget. Atomic admission refuses growth without changing saved work. Existing overages remain readable and can shrink. These are logical JSON allowances, separate from binary media, exports, physical SQLite/WAL pages and backups.

Use **Manage saved history** to preview exact removal counts, choose how many recent versions/directions to keep, then explicitly confirm. The preview is bound to all saved project data and the chosen counts; intervening edits, uploads, renames or ownership/activity changes require a fresh preview. The current saved film/latest revision ID, unsaved edits, undo/recovery copies, media and export snapshots are preserved. A lost response retries the same bounded receipt rather than removing more history. Retained versions are renumbered; existing IDs/dates remain. Cleanup cannot be undone in the app, and older backups may still contain removed history.
