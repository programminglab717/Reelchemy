# Reelchemy

A conversation-first creative studio. Start with an idea, review a storyboard, edit scenes, preview a deterministic composition, and download an actual MP4.

This is an actively developed local MVP, not the complete product scope. Demo mode uses a deterministic planner with three varied scenes; it is explicitly not an AI model. An OpenAI-compatible adapter is available and tested against mocked API responses. Native Claude Messages is also implemented. Both adapters have mocked-response tests; real paid-provider requests have not been verified.

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
- Editing supports scene-local or whole-plan prompt revisions, version restore, text/accent, scene reorder/duplicate/delete, duration, transition, format, layer geometry/color/motion, and custom frame keyframes. PNG/JPEG uploads include source/rights metadata and can be placed as image layers. Save edits before leaving a project.
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

Scene video clips are cached under `artifacts/.scene-cache`. Cache keys include local scene/caption data, referenced image bytes, rendering source files, Remotion metadata and Chromium version. Checksums and codec/dimension/fps/duration checks validate cached entries. Cached clips are concatenated before audio mixing; changing audio alone does not invalidate visual clips. Captions do invalidate the affected scene clips because they are burned into the picture. Still and motion evidence is generated again for each export. Restart the worker after code changes; its bundle and source fingerprint are cached for its lifetime.

This is a single-worker local cache, not a shared render farm. Do not run multiple cache-writing CLI renderers against it at the same time. Cache files are derived and can be removed while all renderers are stopped; never remove `.data` or user exports to clear a cache. There is no automatic disk eviction yet. `REELCHEMY_RENDER_CACHE_DIR` overrides the cache location; `REELCHEMY_DATA_DIR` / `REELCHEMY_ARTIFACT_DIR` are available for isolated test data. Keep these paths consistent between API and worker.

Select **Selected scene only** in Live preview to loop a scene without rebasing its audio or caption timing. Camera keys affect the scene world; caption overlays stay fixed. Review camera motion and graphics manually—static layout diagnostics do not establish motion continuity or artistic quality.

## Public-account foundation (0.6)

The release target is now a public multi-user product. The current checkpoint adds identity and private resource boundaries; the editor, managed production storage, deployment/operations, wider abuse controls and public launch gates in PRODUCTION_PLAN.md are still being built.

All studio APIs now require a verified account. Create one at `/sign-in`, verify its email, then sign in. A new account gets its own empty studio. Project lists, edits, revisions, media, render jobs, evidence, MP4 downloads and editable archives are scoped to that studio. Render workers are trusted internal processes; they must not be exposed as customer-controlled services. The current migration still uses local SQLite/files, pending the production database/object-storage workstream.

For local development, auth creates a random private signing key in `.data/auth-secret`; verification/reset mail is queued as private `.data/mail/*.json` files. These files contain credentials/links: never commit, log or expose them through an API. Automated tests consume only their own synthetic mail. Use configured SMTP for normal manual email delivery. Production refuses the file-mail fallback and requires `BETTER_AUTH_SECRET` (32+ random characters), an HTTPS `BETTER_AUTH_URL`, `EMAIL_DELIVERY=smtp`, `SMTP_HOST` and `EMAIL_FROM`. Configure SMTP credentials in the deployment secret manager; do not supply them in chat. Signing secrets must be raw server-side deployment secrets, not network-proxy credential placeholders.

Run `npm run auth:migrate` before serving a production deployment, with the same environment settings as the web service. Keep `npm run mail:worker` running alongside the web and render workers for SMTP delivery. The private outbox persists messages, caps delivery attempts, backs off failures and moves stale/exhausted messages to its `failed` folder. Delivery is at least once; inspect failed-mail counts through operational tooling rather than printing message bodies or token URLs. A real mail service and HTTPS staging deployment have not been live-validated in this checkpoint.

Existing prototype projects remain on disk but are not assigned to an arbitrary new customer. After registering/verifying the intended owner, run `npm run workspace:claim -- --email=owner@example.com` to inspect the legacy project count. Add `--apply` to assign only still-unowned projects. Never expose that operation as a public route. `.data/backups/studio-before-tenant-migration.sqlite` preserves the pre-migration project database; uploaded files remain in `.data/assets`.

Use `npm run test:isolated` for the complete browser suite. It starts its own development server on port 3002, render worker, private mailbox, temporary database/artifacts/cache and a temporary source/dependency mirror with its own Next-generated files. It never clears the real workspace or copies `.env.local` into the test app; it forces mock AI and a fresh test signing secret. Dependency copies are removed when the test services stop. `npm run test:isolated -- accounts.spec.ts` runs only the account/access/reset checks. This is development-mode integration coverage, not a claim of a configured public production deployment. `E2E_PORT` overrides the isolated port. The prior direct `test:e2e` command now requires an authenticated, development-mail-capable test server and matching data path for its fixtures.
