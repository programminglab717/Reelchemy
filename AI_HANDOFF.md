# Prompt for the next AI developer

Continue development of `programminglab717/Reelchemy` into a usable public multi-user video-creation product. This is an existing substantial application; inspect it and continue from the current checkpoints.

Read `AGENTS.md`, `PROJECT_STATUS.md`, `VALIDATION.md`, `PRODUCTION_PLAN.md`, `OPERATIONS.md` and the latest `CHANGELOG.md` entries before changing code. Follow the repository's Next.js documentation requirement. Treat older historical milestone descriptions as historical; use the latest status and validation records for current capabilities.

## Git state

- `origin/work` contains the **0.71** application (animated code scenes, motion kit, AI director, code editor; see below). Before that, 0.70 added resumable uploads, and the **0.69** application (own AI keys, Cloudflare Tunnel deployment helper, five-minute sources, animated rotation, masks, brand fonts, scene-length ripple); its verification is in VALIDATION.md. The last fully accepted release was **0.66** (accepted source `74b29e2`; 0.65 `33fa994`; 0.64 `a3941f4`; 0.63 `7eed554`; 0.62 `5b9b003`; 0.61 `5567641`), status report and this handoff. It includes the former `codex/render-budget` candidate history, which is now superseded.
- `main` mirrors `work` as of 0.70 (created 6 November from `work`); develop on `work` and fast-forward `main` when releasing. `codex/mail-reliability` is an older 0.51 copy with unrelated history, fully superseded by `work`; do not merge it. Fetch and inspect remote branches before work. Keep new candidates separate from accepted code until their acceptance checks pass. Do not force-push or rewrite existing history.

## Motion engine and AI director (0.71)

The owner's goal: the AI should produce sophisticated, motion-graphics explainer videos (for example a 15–30 second clip on how PostgreSQL works), not text slides. The audit found the original pipeline could not do this. The planner emitted a restricted layer DSL, so the output was always a handful of text cards. 0.71 adds:

- **Code scenes** (`scene.code = {html, css, js, libraries?}`): `src/motion/` holds the runtime.
  - `clock.ts` is the virtual clock injected into the scene document.
  - `document.ts` builds the sandboxed scene document (CSP: no network; scripts, styles and fonts only from the allowlisted file server).
  - `kit.ts` is the `R` helper kit; `libraries.ts` and `motion-files.ts` define and serve the allowlisted files.
  - `preflight.ts` (headless stills and metrics) and `audit.ts` (in-scene layout checks) check scenes.
  - `src/video/MotionScene.tsx` hosts a scene in Remotion with one `delayRender` per frame. Seeking backwards reloads the iframe.
  - Exports serve the same files from each job's private asset server (`render-assets.ts`).
- **Director** (`src/director/`):
  - `prompts.ts` holds the planner and writer instructions and the three reference scenes from `src/motion/examples/`;
  - `director.ts` runs plan → write → preflight → vision review → revise, keeping the best attempt with a title-card fallback;
  - `jobs.ts` stores the background job state; `runner.ts` runs it in the web process;
  - `llm.ts` makes image-capable multi-turn calls to Anthropic or OpenAI-compatible providers, with the same metering as planning.
  - API: `/api/projects/[id]/direct` (POST start, GET latest, DELETE cancel). The UI pieces are `useDirector.ts` and `DirectorStatus.tsx`.
- **Studio**: `CodeSceneEditor.tsx` edits code scenes and converts layered scenes.
- Quality levers, in order of impact: the kit primitives, the reference scenes, the writer's design standards, and the review loop. To judge a change, render the references and real director output with `scripts/motion-preview.ts` and look at the contact sheets.
- Not yet verified: a live run with a real model. The owner will run it with their own key. Mocked-model tests cover the pipeline (`tests/director*.test.ts`); kit and runtime tests render real frames.
- 0.73 added:
  - 3D (`R.three`; three.js and add-ons pre-built into one classic script committed at `src/motion/vendor/three.js` (regenerate with `npm run vendor:three`; `tests/motion.test.ts` checks it is current), served as `three.js`; drawn by the clock's once-per-frame draw hooks);
  - the maker's images in code scenes (declared `code.assets`, bytes posted in by the host);
  - style references (`src/director/reference.ts`), presets (`src/director/presets.ts`), `R.finish` and an extra-polish mode.
- 0.74 added:
  - the explainer kit in `src/motion/kit-explainer.ts` (inserted into `KIT_SOURCE`; same closure): shots with transitions, arrows, callouts, marks, steps, UI windows, cursor, charts, stats, isometric stacks, kinetic type, drift and pulse; `view.globe` lives in `kit.ts`'s `three()`;
  - quality gates: `probeTimes` (motion without ambience) and `coverageAt` in `preflight.ts`, `COVERAGE_SOURCE` in `audit.ts`, and `stillStretches`/`sceneProblems` in `director.ts` (thresholds STILL, LONGEST_STILL, MIN_COVERAGE were calibrated on the references);
  - references `cdn-globe.ts` and `deploy-walkthrough.ts` (both tested against the director's own problems in `tests/motion-kit.test.ts`);
  - the MCP server: `src/mcp/server.ts` (JSON-RPC, resources, prompt), `src/mcp/tools.ts` (tools call the studio's route handlers through `internalRequest` in `access.ts`), `src/app/api/mcp/route.ts` (token auth), `src/lib/mcp-tokens.ts`, token management at `/api/account/mcp-tokens` and `AssistantTokens.tsx`; `tests/mcp.test.ts`;
  - the workspace tabs (`EditorToolsNav.tsx` and the `tool-panel` regions in `Studio.tsx`); e2e tests open a tool with `openTool(page, name)` and the folded records with `openRecords(page)` from `tests/e2e/fixtures.ts`.
- 0.74.1 (review before the first deployment of 0.74):
  - `/?project=<id>` deep links (`Studio.tsx`), which the MCP tools return as `studioUrl`; bounded OAuth client registration (`mcp-oauth.ts`); `R.captions`, `hide()`/`show()` on strokes and arrows, `size` on `R.stat`;
  - OAuth for connectors exists since 0.74 (`src/lib/mcp-oauth.ts`, `src/app/api/oauth/*`, `src/app/oauth/authorize`, `/.well-known/*`). It was exercised over real HTTP with the official MCP SDK client; the real claude.ai and ChatGPT connector screens are untested;
  - how to judge the writer's instructions: give a model only `motionGuide()`, the two example scenes and `scripts/motion-preview.ts`, ask for a scene on a topic, and read both the contact sheet and the model's list of things it had to guess. Two such trials shaped the 0.74.1 guide text;
  - a failed browser test prints what made the page wider than the viewport (`overflowReport` in `tests/e2e/fixtures.ts`).
- Known weak spots, in the order they matter:
  - scenes written from the guide are accurate and well paced but not yet "high-end": sub-labels run small, diagram shots get crowded, and charts look generic. The coverage gate measures the outline of the content, not the composition;
  - the workspace is a reorganised single page, not an editor layout: the scene strip and the timeline repeat each other, and the editing tabs start below the fold on a laptop;
  - MCP cannot upload images or return a download link for a finished export;
  - the two 0.74 reference scenes passed preflight but were not exported through the renderer.
- Open ideas: transparent/alpha clip exports (ProRes 4444 or WebM), a whole-film critique pass, sound design (music bed and synced effects), richer cross-scene transitions, and more reference scenes for other genres.

## User instructions

Continue autonomously through milestones until the coding is complete or genuine user input is required. Do not stop after every milestone or repeatedly ask permission to continue. Give meaningful progress updates. Preserve original databases, media, backups and permanent lifecycle lock inodes; use isolated fixtures for migrations, deletion, compaction and restore tests. Do not deploy or operate on an actual installation without authorization.

Keep live AI verification until the very end. The owner will test with their own key, entered in Account settings → AI director (encrypted per studio, deletable); never ask for the key in chat or put it in files or environment variables. Mocked providers, synthetic accounts/mail and real local Chromium/FFmpeg tests should support independent progress now. Actual SMTP/cloud service tests require appropriate configuration and authorization. Do not claim production readiness from offline tests alone.

## Implemented baseline and evidence

The application includes private accounts/personal studios, project CRUD/search/history, autosave/CAS/undo/recovery, canvas/timeline editing, media ingestion/reuse, microphone recording, narration notes, caption tools, authored starters, real native-HD MP4 exports, cancellation/recovery, quotas, privacy/deletion and local/encrypted backup tooling. Exact capabilities and remaining advanced editing gaps are in `PROJECT_STATUS.md`.

- Complete backend/native regression at 0.60: **543/543 passed**.
- Complete production HTTPS browser regression at 0.59: **89/89 passed**.
- Current relevant creator/mobile production browser checks at 0.60: **5/5 passed**.
- 0.60 production build, type, lint, formatting and private/prepared-renderer guards passed.
- Nine real local encrypted Restic repository/CLI/lock/cancellation checks passed; these are included in the 543 suite.
- 0.61 complete acceptance from one frozen source: **548/548** backend/native, production build/guards, **89/89** production browser (new cloud environment, non-root, no resource cgroup).

Do not describe those different-source results as one complete latest-source browser/test pass.

## 0.61 acceptance (done)

The duration-based attempt budget is accepted. New real-worker coverage (`tests/render-deadline-worker.test.ts`) found that a deadline-expired long export left Remotion's FFmpeg stitcher alive, so the consumer failed closed and exited. The worker now releases only its own marked descendant processes (grace, then PID-checked SIGTERM/SIGKILL) and still fails closed if anything survives. One frozen source passes 548/548 backend/native, production build/guards and the complete 89/89 production browser regression; details are in VALIDATION.md. Run native/browser suites as a **non-root** user: one `/proc` recovery check intentionally fails as root.

## Immediate next work

0. 0.67–0.69: hosted Actions is enabled and runs `checks.yml` on every push to `work` (it cancels the previous run on the same branch). The owner plans to deploy on their office Ubuntu server behind a Cloudflare Tunnel with `deploy/reelchemy.sh` (DEPLOYMENT.md) once authorized, then add SMTP details (`--smtp-*`) when provided. Planned commercial model: studios bring their own Anthropic/OpenAI/Gemini key and/or use the platform key with metered usage (`REELCHEMY_PLATFORM_AI`, `ai:entitlement`, `ai:usage`); pricing is undecided.

1. Accepted: fair shared render queue (0.62) and creator-first layout from a screenshot walkthrough (0.63).
2. Done in 0.64: constrained five-minute capacity for square/landscape motion and full-footage under 2 CPU/4 GiB/256 tasks (cgroup-v1 runner), including a task-limit fix. Next capacity steps: concurrent throughput and many-core hosts.
3. Done in 0.65: immutable app/test/backup images pass the restricted runtime check and the in-image 90-case browser suite. In this cloud environment, start `dockerd --data-root /home/dockerdata`, build the sandbox base from upstream node plus `/root/.ccr/ca-bundle.crt` with HTTPS Debian sources, and pass `--build-arg NODE_VERSION=24.19.0-ccrproxy`; never ship those images.
4. Done in 0.66: `check-runtime.ts --upgrade-from <previous>` upgrade/rollback drill (0.61 ⇄ 0.66 passes) and an account-cleanup readiness fix.
5. Continue creator usability, operations and release work below.

## Remaining release work

Broader motion/format/mixed-media and load measurements; real creator sessions and usability fixes; any essential advanced tools identified by those sessions; actual immutable app/test/operator images; hosted CI/staging/deploy/rollback/monitoring; actual off-host restore and historical local/provider-object retention; SMTP acceptance; final live AI quality/authentication/usage/failure verification. Current live storage is single-host SQLite/filesystem. Distributed live-media/database architecture, billing and shared team collaboration would be additional scope decisions.

## Environment and artifact notes

Use the pinned Node version and Linux FFmpeg/ffprobe, Chromium, `flock`, and Restic >=0.14. Avoid concurrent heavy build/native/browser runs on a constrained host.

If continuing in the original workspace, `/workspace/Reelchemy` is the earlier worktree. Evidence is under `/workspace/Reelchemy-evidence`, including `0.60`, `0.61`, and `review-0.60/REVIEW.md`. Private `fresh-unit.py`, `fresh-build.py`, `fresh-browser.py` and `fresh-benchmark.py` drivers record frozen source and resource limits. Source-mounted runners do not establish immutable-image acceptance.

Earlier, local Docker VFS capacity blocked image acceptance; the newer cloud environment's overlayfs Docker works (0.65). Hosted Actions API reads have been forbidden; configured/pushed CI is not a verified hosted result. An earlier GitHub push was blocked by an account-usage approval-review failure; retry only through normal approval when available, never bypass it.

Generated large artifacts are outside Git. A different machine may not have them or the private drivers; use committed validation summaries and rerun needed checks rather than claiming unavailable evidence exists. Frozen workspace proof media may be hard-linked for deduplication; copy before editing.

An optional creator question is pending: the first real video's topic, audience and target length. Do not invent the user's answer. Continue independent work while waiting.
