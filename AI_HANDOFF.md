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
  - how to judge the director without a provider key: `scripts/director-standin.ts <out-dir> "<brief>" [seconds] [format]` runs the real director against a local stand-in for the Messages API and writes each request to a folder; a separate model session that is shown only the request (system prompt, conversation, stills) writes the answers. Read the finished contact sheets and that session's list of what it had to guess. Three such runs shaped 0.74.1: the first failed at planning (fixed), the second made a 30-second HTTPS explainer in two scenes (8 calls), the third a 20-second 3D teaser (4 calls). For the writer's guide alone, give a model only `motionGuide()`, the two example scenes and `scripts/motion-preview.ts`;
  - the director's plan schema cuts over-long text and lists to size (`cut` in `prompts.ts`); the planner prompt states the sizes; `planFilm` allows two repairs with a readable message (`planProblem`);
  - the globe's land map is `src/motion/land-mask.ts` (how it was made is in its header);
  - a failed browser test prints what made the page wider than the viewport (`overflowReport` in `tests/e2e/fixtures.ts`).
- 0.75 added:
  - the workspace's two views in `Studio.tsx`: `editing` (from `mode`, or the browser preference `reelchemy.openInEditor`) switches between the overview and the editor. Everything stays mounted; `hidden` and the `.workspace-body.editing` styles do the rest. The body has a main column (preview, scenes, timeline) and a side column (tabs, the director panel, the tool panels). `/?project=<id>&open=<tool>` opens a tool;
  - browser tests run in the editor by default (the `overviewFirst` option in `tests/e2e/fixtures.ts` is off); `workspace-modes.spec.ts` covers the overview. The director's conversation is the "Director" tab in the editor: `openTool(page, "Director")`;
  - MCP links (`src/lib/mcp-links.ts`, `src/app/api/mcp/files/[token]/route.ts`, `src/mcp/media.ts`): one-time upload links and one-hour download links, random tokens stored as hashes. The route reaches the studio's own upload and download handlers through `internalRequest`. New tools: `upload_image`, `create_upload_link`, `get_download_link`, `list_exports`, `set_captions`, `rename_project`.
- 0.76 added:
  - the layout audit (`src/motion/audit.ts`) samples every whole second (`auditTimes` in `director.ts`) and reports text partly hidden behind another panel: three points along the text are classed as clear, veiled (a tinted layer on top) or hidden (an opaque one); clear plus hidden is a fault. Texts in different `.r-shot` elements are not compared, and `framed` looks at every camera ancestor;
  - the review prompt (`reviewUser`) lists concrete faults to judge each still against; `R.shine`; `parsePlan` refuses a scene over 22 seconds; a hidden 3D canvas is not drawn (`shown()` in `three()`);
  - a fifth stand-in run (a 24-second 2FA tutorial, two scenes, 8 calls, 690 s) is the best output so far and used every revision; `reports.json` says approved when the last attempt had no automatic findings, not when the model replied `<approved/>`.
- 0.77 added:
  - the editor's inspector (`globals.css`, the last blocks): from 1360 px the editing body is a two-column grid and `.workspace-side` scrolls on its own. `.workspace-side` is a CSS container named `inspector`; every `@media (max-width: …)` block up to 1000 px is followed by a copy as `@container inspector (max-width: 700px)`, so a new narrow-screen rule for a tool panel needs the same rule in the copy below it. Between 1360 and 1700 px `.shell:has(.workspace-body.editing)` folds the sidebar to its rail;
  - browser tests run at 1280 px (tools under the timeline). `E2E_VIEWPORT=1760x1000` runs them with the inspector and the sidebar open; at 1440 px tests that use the sidebar while a project is open cannot work, because the rail has no project search;
  - 3D: `view.fly`, `dof` and `view.focusOn` in `kit.ts` (`BokehPass` was added to the three.js bundle: `npm run vendor:three`). A view with depth of field is opaque and takes the stage's background colour.
- 0.78 added:
  - tool panels laid out for a narrow column: the block after "Tool panels in a narrow column" at the end of `globals.css`. Inside `@container inspector (max-width: 700px)`, `.layer-fields` and `.layer-toolbar` are grids of at least two columns (`minmax(min(140px, calc(50% - 6px)), 1fr)`), labels holding a checkbox, file input, range or textarea span the row, and buttons fill their cells and wrap. Checkboxes in `.scene-editor` and `.layer-editor` are small boxes beside their words at every width (`input` rules there made them 150 px blocks). File inputs in `.workspace-side` are full width with a styled `::file-selector-button`. The Design tool's layer actions get their border back (`.canvas-stack button` stripped it). The inspector's tabs are chips;
  - depth of field is `lensPass()` in `kit.ts`: the composer's render targets carry a `DepthTexture`, a half-size target holds colour plus signed blur radius, a 24-tap gather blur runs there, and a full-size mix uses `smoothstep(0.5, 1.5, radius)` so slightly defocused text stays crisp. `BokehPass` left the bundle. Note that a view drawn through the composer (bloom or dof) tone-maps its background colour, unlike a plain view, so compare lens output against `dof: {aperture: 0}`, not against no dof;
  - `R.present` (`kit-explainer.ts`): a GSAP fromTo on rotationX/rotationY/rotation and z (the push is a move toward the lens, so `scale` stays free for a window's `open()`), a shadow sibling and a sheen child. Kit positions come from the flat layout (`stageBox` uses offsets), so a cursor or callout on a presented element must be inside it;
  - guide: a "Restraint" standard and the review's "busy still" fault. Stand-in run 6 (same 2FA brief as run 5): 7 calls, 501 s; the closing shot became one figure and one line instead of a figure, chart, shield, call to action and step chips; no hand-drawn marks. The model did not use `R.present` because its cursor sat outside the window, which led to the note in the guide.
- Known weak spots, in the order they matter:
  - scenes from the live runs are accurate, well paced and use the kit as intended (mockups with a cursor, sequence diagrams, checklists, a 3D globe, stat cards), but they are solid explainer quality rather than "high-end": in-app text in interface mockups runs small, a step list often stays for a whole tutorial scene, and charts look generic. 0.76–0.78 added light sweeps, camera flight and depth of field, product shots and restraint rules; run 6 shows cleaner, more focused shots, but no run has yet used the product shot or depth of field unprompted. The coverage gate measures the outline of the content, not the composition;
  - no run has used a real provider with the owner's key: billing, rate limits and each provider's real response shape are covered by mocked tests only;
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
