# Reelchemy

A conversation-first creative studio. Start with an idea, review a storyboard, edit scenes, preview a deterministic composition, and download an actual MP4.

This is an actively developed local build toward the public product, with release gates still open. Demo mode uses a deterministic planner with three varied scenes; it is explicitly not an AI model. An OpenAI-compatible adapter is available and tested against mocked API responses. Native Claude Messages is also implemented. Both adapters have mocked-response tests; real paid-provider requests have not been verified.

## Run

Requirements: Node.js 24 (see `.node-version`; minimum 22.13), npm, FFmpeg/ffprobe on PATH, and Chromium. This cloud machine already supplies all four. On Debian/Ubuntu, install system prerequisites with `sudo apt-get update && sudo apt-get install -y ffmpeg chromium`; installation may require host permission. Other platforms must provide a compatible Chromium and set `CHROMIUM_PATH`.

```sh
cd /workspace/Reelchemy
npm ci --cache /workspace/.npm
npm run seed
# Terminal 1: keep the render worker running
npm run worker
# Terminal 2: start the studio
npm run dev -- --port 3001
```

The development UI uses port 3001 because the onboarding machine already uses port 3000. This is a local development instance of a public-product work in progress. Authentication/resource isolation are implemented; do not deploy publicly until the production release gates in PRODUCTION_PLAN.md are met. No API credentials are required for the default workflow.

Optional server configuration: copy `.env.example` to `.env.local` without committing it. Next.js reads `.env.local`. For CLI rendering, export `CHROMIUM_PATH` and `RENDER_CONCURRENCY` in the worker's shell if overriding the defaults. Chromium defaults to `/usr/bin/chromium`, with two concurrent render frames (clamped to 1–4). Restart the worker after changing composition code: its bundle is cached for its lifetime.

For a real model, set `AI_PROVIDER=compatible`, `AI_BASE_URL` to an HTTPS OpenAI-compatible API base, `AI_MODEL`, and `AI_API_KEY` on the server. Ensure that provider host is permitted by environment network settings. Keys are never sent to the browser. The mock path works without provider network access. This adapter expects JSON-object response support; compatibility varies by provider. For native Claude use `AI_PROVIDER=anthropic`, `AI_MODEL`, and `AI_API_KEY`; the default base is `https://api.anthropic.com/v1`.

## Verify

Run the web server and worker before E2E tests:

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

SQLite WAL supports the API and separate worker. Revisions retain every saved storyboard. Render jobs snapshot inputs so subsequent edits cannot alter an active export. A cancelled job never becomes completed. Export history survives refresh. On restart, an interrupted job is requeued once from its original timeline snapshot; another interruption after that limit marks it failed. Terminal jobs cannot be revived by late progress callbacks. The worker uses a single-instance lock; after a hard crash, check that the PID in `.data/worker.lock` is no longer running before deleting that lock. Do not remove the database.

Animations depend only on frame index and fixed inputs. Rendering uses local Arial/system font fallback; identical inputs are deterministic on this machine, but cross-platform pixel identity is not promised. Files are stored locally by generated job ID. The DSL has no network or filesystem primitives. Custom motion keyframes are sampled at up to eight event frames per scene in addition to beginning/middle/end. Project image assets are capped at 30, each uploaded file at 10 MB, decoded images at 16 million pixels. This is a restricted DSL rather than a container sandbox for arbitrary code.

## Current limits and next work

- The demo planner always produces three illustrative scene strategies. It does not understand an arbitrary story or create arbitrary characters.
- Editing supports scene-local or whole-plan prompt revisions, version restore, text/accent, scene reorder/duplicate/delete, duration, transition, format, layer geometry/color/motion, and custom frame keyframes. PNG/JPEG uploads include source/rights metadata and can be placed as image layers. Edits autosave; failed saves keep the current draft open during studio navigation.
- QC checks declared geometry/assets, keyframe bounds, and actual Chromium text geometry with shared rendering styles. Clipped text receives up to two local font-size correction passes; unresolved defects block export. Declared-background contrast, caption speed, and audio level checks produce warnings. Actual gradient/composite contrast, semantic analysis, and artistic motion review remain unimplemented. QC reports, stills, and clips are accessible from export history. Decoding every encoded frame checks file integrity, not motion quality.
- Optional uploaded audio supports frame-based start, trim, gain and fades (up to four tracks), AAC encoding, codec/duration checks and peak measurement. Captions are burned into preview/MP4 and downloadable as SRT/VTT. Projects without audio stay silent. Voice generation, advanced character rigs, generated media and external stock integrations remain to build. A simple layered character, arrows, gradients and whole-scene camera keyframes are available as deterministic primitives.
- Queue execution supports persisted stages/activity, cancellation, one automatic retry for transient browser/media timeouts, and bounded restart recovery. Identical scene video clips are reused through a content-addressed cache; still/clip evidence is recaptured per export. Distributed workers, OS-level resource isolation and cost accounting remain future work.
- Formats 16:9, 9:16, and 1:1 have schema/preview support; verified encoded outputs are listed in VALIDATION.md.
- Account authentication and per-account authorization are implemented. Shared-workspace collaboration, expiring sharing, managed cloud storage, deletion UI and deployment setup remain to build. Project data still lives on this machine.

See [CHANGELOG.md](CHANGELOG.md) for checkpoints. Verified checkpoints are committed locally as requested; no remote pushes have been made.

## Sound, captions and portable projects

Upload an audio file with its source/usage rights, add it in **Sound & captions**, then edit start/offset/duration in frames (30 fps), gain and fades. Audio files are capped at 10 MB and 120 seconds, decoded locally and normalized to 48 kHz stereo WAV. AAC exports are padded/trimmed to the video duration, with a limiter on the final mix. Preview uses per-track gain; the exported overlapping mix additionally limits peaks. Review narration timing and creative sound choices yourself; the checks verify technical timing and levels, not perceptual quality.

Caption cues must not overlap or exceed the timeline. Each cue is limited to 80 characters, displayed in the bottom safe area, and exported as SRT/VTT alongside the MP4. Cue boundaries are frame-based; subtitle milliseconds round to the nearest millisecond.

**Download editable project** saves scenes, chat, versions and local assets as a ZIP. Import it on the Studio home page to create a separate copy with new asset IDs. ZIP import is capped at 50 MB compressed / 150 MB declared uncompressed, 31 allowlisted entries and 25 MB per entry. Assets are revalidated on import. Completed videos, render jobs, server configuration and credentials are excluded; rerender the imported project. Never assume the ZIP is a database backup or an environment snapshot.

## Recovery and incremental rendering

A single worker processes the queue. Automatic retries are limited to one and apply to transient browser crashes/disconnects and media command timeouts; schema, asset and QC failures are not blindly retried. Cancellation is terminal. `RENDER_JOB_TIMEOUT_MS` sets the per-attempt deadline (default 600000, clamped to 60000–900000). Subprocesses receive termination on cancellation/deadline and are killed if they do not exit. Activity logs are capped at 100 entries per job.

Scene video clips are cached under `artifacts/.scene-cache`. Cache keys include local scene/caption data, referenced image/video bytes, rendering source files, Remotion metadata and Chromium version. Checksums and codec/dimension/fps/duration checks validate cached entries. Cached clips are concatenated before audio mixing; changing standalone audio tracks alone does not invalidate visual clips. Video-layer settings currently participate in the scene cache key, including source volume. Captions do invalidate the affected scene clips because they are burned into the picture. Still and motion evidence is generated again for each export. Restart the worker after code changes; its bundle and source fingerprint are cached for its lifetime.

This is a single-worker local cache, not a shared render farm. Do not run multiple cache-writing CLI renderers against it at the same time. Cache files are derived and can be removed while all renderers are stopped; never remove `.data` or user exports to clear a cache. There is no automatic disk eviction yet. `REELCHEMY_RENDER_CACHE_DIR` overrides the cache location; `REELCHEMY_DATA_DIR` / `REELCHEMY_ARTIFACT_DIR` are available for isolated test data. Keep these paths consistent between API and worker.

Select **Selected scene only** in Live preview to loop a scene without rebasing its audio or caption timing. Camera keys affect the scene world; caption overlays stay fixed. Review camera motion and graphics manually—static layout diagnostics do not establish motion continuity or artistic quality.

## Public-account foundation (0.6)

The release target is now a public multi-user product. The current checkpoint adds identity and private resource boundaries; the editor, managed production storage, deployment/operations, wider abuse controls and public launch gates in PRODUCTION_PLAN.md are still being built.

All studio APIs now require a verified account. Create one at `/sign-in`, verify its email, then sign in. A new account gets its own empty studio. Project lists, edits, revisions, media, render jobs, evidence, MP4 downloads and editable archives are scoped to that studio. Render workers are trusted internal processes; they must not be exposed as customer-controlled services. The current migration still uses local SQLite/files, pending the production database/object-storage workstream.

For local development, auth creates a random private signing key in `.data/auth-secret`; verification/reset mail is queued as private `.data/mail/*.json` files. These files contain credentials/links: never commit, log or expose them through an API. Automated tests consume only their own synthetic mail. Use configured SMTP for normal manual email delivery. Production refuses the file-mail fallback and requires `BETTER_AUTH_SECRET` (32+ random characters), an HTTPS `BETTER_AUTH_URL`, `EMAIL_DELIVERY=smtp`, `SMTP_HOST` and `EMAIL_FROM`. Configure SMTP credentials in the deployment secret manager; do not supply them in chat. Signing secrets must be raw server-side deployment secrets, not network-proxy credential placeholders.

Run `npm run auth:migrate` before serving a production deployment, with the same environment settings as the web service. Keep `npm run mail:worker` running alongside the web and render workers for SMTP delivery. The private outbox persists messages, caps delivery attempts, backs off failures and moves stale/exhausted messages to its `failed` folder. Delivery is at least once; inspect failed-mail counts through operational tooling rather than printing message bodies or token URLs. A real mail service and HTTPS staging deployment have not been live-validated in this checkpoint.

Existing prototype projects remain on disk but are not assigned to an arbitrary new customer. After registering/verifying the intended owner, run `npm run workspace:claim -- --email=owner@example.com` to inspect the legacy project count. Add `--apply` to assign only still-unowned projects. Never expose that operation as a public route. `.data/backups/studio-before-tenant-migration.sqlite` preserves the pre-migration project database; uploaded files remain in `.data/assets`.

Use `npm run test:isolated` for the complete browser suite. It starts its own development server on port 3002, render worker, private mailbox, temporary database/artifacts/cache and a temporary source/dependency mirror with its own Next-generated files. It never clears the real workspace or copies `.env.local` into the test app; it forces mock AI and a fresh test signing secret. Dependency copies are removed when the test services stop. `npm run test:isolated -- accounts.spec.ts` runs only the account/access/reset checks. This is development-mode integration coverage, not a claim of a configured public production deployment. `E2E_PORT` overrides the isolated port. The prior direct `test:e2e` command now requires an authenticated, development-mail-capable test server and matching data path for its fixtures.

## Manual editor and safe saving (0.7)

Choose **Start from a blank canvas** to edit without a planner. **Arrange scene** uses the same layer artwork as the renderer, with motion/camera/fades held at the base layout for placement. Select layers on the canvas or in the stack; drag, resize with the corner, center, reorder, hide or lock them. Snapping targets canvas edges/center; hold Alt to bypass it. Arrow keys move a focused layer by one composition pixel, or ten with Shift. Hidden layers stay in the project but are omitted from preview/export and visual QC. Locking prevents manual changes to a layer; it is an editing aid, not an authorization boundary.

The timeline provides a frame playhead, scene selection, zoom and visible scene/audio/caption ranges. The 0.8 controls below add direct movement/trimming and scene splitting. Audio waveforms remain to build.

Edits autosave after 900 ms without further changes. Saves run in order, and a response cannot replace a newer local edit. Undo/redo keeps up to 50 timeline states across saves while a project is open; reopening/reloading starts a new undo history. Use the saved version list for older persisted states. Ctrl/Cmd-Z and Shift-Ctrl/Cmd-Z operate on the editor outside text inputs; Ctrl/Cmd-S saves. Native input undo remains available while typing. Invalid timeline edits are rejected with a visible message.

Studio navigation and sign-out save outstanding edits first; failed saves keep the current draft open. Browser unload warns while changes are unsaved. Unsaved drafts are held in memory, not a durable offline cache. A forced close before successful saving can lose those edits. Save conflicts preserve local work, offer a JSON draft download, and require an explicit replacement action to open the latest server version. The JSON draft is an inspection/recovery file, not an importable project archive; editable project ZIPs remain the supported portable format.

Project PATCH uses `{timeline, baseRevisionId}`; the base is the last saved revision ID (or null for a project without versions). A stale base returns HTTP 409 with `REVISION_CONFLICT`. Restore requests also include `baseRevisionId`. Timeline commits compare the persisted revision inside a SQLite transaction and retain newly uploaded asset metadata. Asset uploads merge into the open editor without replacing its local timeline/history. Each settled timeline save currently adds a persisted version; production retention/storage quotas remain unfinished.

Layer **Custom keyframes** and **Scene camera keyframes** now provide frame markers, a frame slider, offset/scale/opacity fields, and add/remove/reset actions. Values at an unkeyed frame begin with the interpolated pose. Custom keys replace a layer's preset animation and interpolate linearly. Up to 30 keys fit within each scene. Advanced JSON remains optional; it validates order/timing and follows visual edits. Inspect actual movement in **Live preview** and the export's motion clips; the arrangement canvas deliberately displays base geometry.

## Footage and editable tracks (0.8)

Upload **MP4 / MOV / WebM** with its source/usage rights, then choose **Add video to selected scene**. A clip starts behind the existing artwork so titles remain on top. **Footage range** controls set scene start, source in, length, fit-entire-clip versus fill/crop, and source-audio volume. Values use seconds and snap to 30 fps. Hide mutes the clip as well as hiding its picture. Lock prevents direct clip edits. Source audio joins the existing audio tracks in preview and the AAC export mix, with at most 32 audible clips/tracks in a timeline.

Input clips are capped at 25 MB, 120 seconds, 8.3 megapixels and 120 fps. H.264, HEVC, VP8, VP9 and AV1 in MP4/MOV/WebM containers are accepted by the validator. Normalization removes source metadata, limits picture size to fit within 1920×1080 without upscaling, converts to 30 fps H.264 and retains source audio as AAC. The normalized file must also fit 25 MB, preserve duration within three frames and fully decode. Normalization has a two-minute deadline; decoder support and performance remain platform-dependent. These limits do not raise the current sixty-second project/output-size caps or constitute an OS-level media sandbox.

Private media GET supports single HTTP byte ranges for browser seeking, with authentication/resource authorization applied before range handling. Render-time video is served only on a random loopback port with a fresh capability token and an allowlist of that immutable job's video IDs. The server streams those files, serves no directory, and closes after the attempt. Video bytes are never embedded in renderer URL queries. Cache keys use file SHA-256 values, so temporary source ports/tokens do not defeat clip reuse. Keep worker ports private; they are internal services rather than public media endpoints.

Select a scene and move the playhead, then use **Split scene at playhead**. Both parts require at least one second and the project stays within 12 scenes. A split preserves total duration, global captions/audio, source frame ranges, preset phase, custom/camera keyframe poses, and the original outer fades; it introduces a cut between the two parts. Undo/redo includes the entire split. Background-only scenes are valid when a source clip ends before the cut.

Video, audio and caption bars can be dragged to move; their edge handles trim. A focused handle supports Left/Right by one frame, or ten with Shift. A gesture creates one undo step. Source-media and scene boundaries clamp edits; a left trim also adjusts the source offset. Caption bars stay between neighboring cues and cannot overlap them. Short audio trims cap fade length to half the resulting range. Numeric controls remain available. Waveforms, freeform crop positioning, ripple/delete-time edits, recording and long-video performance targets remain future work.

Editable ZIPs include normalized footage, clip settings and source-audio metadata. Import revalidates/re-encodes footage, remaps IDs and checks ranges against the real decoded source. Portable archives are capped at 50 MB compressed / 150 MB uncompressed / 25 MB per asset; export rejects an oversized ZIP rather than offering a file the importer cannot accept.

## Narration, captions and project management (0.9.0)

Use **Record narration** in Project assets to capture up to 60 seconds. Recording needs HTTPS or localhost, microphone permission and AudioWorklet support. Preview/download the take, give it a name and usage rights, and save it to assets; **Add audio** places it on the timeline. Start pauses the preview to avoid feedback. Unsaved takes stay in browser memory and are guarded during in-app navigation/sign-out and page unload; save or download them before closing the tab. Upload errors retain the take for retry. Hardware/browser recording quality still needs creator testing.

Audio and audible-footage bars display frame-based waveforms that follow source in/out points and clip volume. They show source amplitude, not loudness or the final mix; fades, the multi-track sum and the export limiter still need listening. A waveform error offers retry without blocking normal editing/export.

Sound & captions includes global font/color/position/alignment/background controls. Font size scales with the shorter output edge; captions stay within an 8% side safe area and use the chosen 3–12% top/bottom margin. Chromium measures every cue for clipping before rendering; shorten text or reduce size when a caption does not fit. Contrast warnings need visual review.

Import plain UTF-8 `.srt`/`.vtt` files up to 64 KB and 100 non-overlapping cues, each 1–80 characters, within the current video duration. Review before merging or explicitly replacing existing cues; either action is one undo step. Timing rounds to 30 fps, line breaks flatten, supported basic markup is removed, and unsupported positioning/STYLE/REGION/embedded timestamp syntax fails explicitly. Download current SRT/VTT without exporting an MP4. Subtitle files carry text/timing; appearance is stored in the project and burned into the MP4.

Search projects by name and load additional pages from the sidebar or mobile project library. Rename changes metadata without clearing timeline undo/history; a stale concurrent rename returns a visible conflict. These are private project operations. Trash, permanent deletion/privacy workflows and retention are still open.

`GET /api/health/live` reports process liveness. `GET /api/health` returns 200 only when the studio database, authentication initialization, writable storage/free-space floor and a render-worker heartbeat are healthy; otherwise it returns 503. Responses contain booleans only, without paths, credentials or project details. Heartbeats expire after 30 seconds. `REELCHEMY_MIN_FREE_BYTES` defaults to 200 MB (clamped to 50 MB–10 GB). This is an availability probe, not a render-capacity or SMTP-delivery guarantee. AI credentials are not required for readiness.

The GitHub Actions workflow runs local/static/unit/build checks and isolated browser/media tests with demo AI and private synthetic mail. It is configuration until a hosted run is recorded; no remote push was performed.

## Backup and restore

`npm run backup -- create <new-directory>`, `verify <backup-directory>` and `restore <backup-directory> <new-restore-directory>` provide private checksummed SQLite/media/export snapshots. Restore preserves the source installation, verifies before copying, revokes copied sessions/tokens and marks pending exports failed for an explicit restart. Stop all writers for a coordinated snapshot; use a new destination each time. See [OPERATIONS.md](OPERATIONS.md) for inclusion/exclusion rules, private storage requirements, an isolated restore drill and remaining production operations work.

## Text styling (0.10.0)

Select a text layer on the canvas to edit its content, size, system font family, weight, alignment, line/letter spacing, italic and underline styling. The same controls are available in the layer inspector. Locked layers disable editing. Reset keeps content and size, and resets the other text styling; undo restores the previous appearance. Autosave, versions, scene splits and portable archives retain the styles.

Rendering and layout diagnostics use the same style function. Text that cannot fit after bounded font repair blocks export. These are system font families with platform fallbacks; uploaded brand fonts, arbitrary font URLs, rotation and richer crop tools are still separate work.

## Recoverable project removal (0.11.0)

**Move project to Trash** saves the editor first and asks for confirmation. Media, saved versions and completed exports are retained; queued/rendering exports are cancelled. Normal resource routes become unavailable until the owner restores the project from the searchable Trash page. Restore does not restart cancelled renders. An unsaved narration take must be saved or discarded before Trash navigation/removal.

Trash works on desktop/mobile and offers retry for loading errors. It is not permanent deletion: files still consume storage, and no automatic retention deadline applies. Permanent project/account erasure remains a production release gate.

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
