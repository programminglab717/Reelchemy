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

The development UI uses port 3001 because the onboarding machine already uses port 3000. This project is a local, single-user prototype; do not expose it as a public multi-user service without adding authentication and storage authorization. No API credentials are required for the default workflow.

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

SQLite WAL supports the API and separate worker. Revisions retain every saved storyboard. Render jobs snapshot inputs so subsequent edits cannot alter an active export. A cancelled job never becomes completed. Export history survives refresh. If the worker is interrupted, restart marks in-flight jobs failed and allows a new export. The worker uses a single-instance lock; after a hard crash, check that the PID in `.data/worker.lock` is no longer running before deleting that lock. Do not remove the database.

Animations depend only on frame index and fixed inputs. Rendering uses local Arial/system font fallback; identical inputs are deterministic on this machine, but cross-platform pixel identity is not promised. Files are stored locally by generated job ID. The DSL has no network or filesystem primitives. Custom motion keyframes are sampled at up to eight event frames per scene in addition to beginning/middle/end. Project image assets are capped at 30, each uploaded file at 10 MB, decoded images at 16 million pixels. This is a restricted DSL rather than a container sandbox for arbitrary code.

## Current limits and next work

- The demo planner always produces three illustrative scene strategies. It does not understand an arbitrary story or create arbitrary characters.
- Editing supports scene-local or whole-plan prompt revisions, version restore, text/accent, scene reorder/duplicate/delete, duration, transition, format, layer geometry/color/motion, and custom frame keyframes. PNG/JPEG uploads include source/rights metadata and can be placed as image layers. Save edits before leaving a project.
- QC checks declared geometry/assets, keyframe bounds, and actual Chromium text geometry with shared rendering styles. Clipped text receives up to two local font-size correction passes; unresolved defects block export. Contrast, semantic analysis, and artistic motion review remain unimplemented. QC reports, stills, and clips are accessible from export history. Decoding every encoded frame checks file integrity, not motion quality.
- Exports are silent. Captions, audio/voice generation, character rigs, generated media, and external stock integrations remain to build.
- Queue execution supports progress, cancellation, and manual retry by starting a new export. Automatic retry, resumable partial renders, worker-level resource isolation, and cost accounting are future work.
- Formats 16:9, 9:16, and 1:1 have schema/preview support; verified encoded outputs are listed in VALIDATION.md.
- No authentication, collaboration, expiring sharing, cloud storage, deletion UI, or deployment setup yet. Project data lives on this machine.

See [CHANGELOG.md](CHANGELOG.md) for checkpoints. Verified checkpoints are committed locally as requested; no remote pushes have been made.
