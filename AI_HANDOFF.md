# Prompt for the next AI developer

Continue development of `programminglab717/Reelchemy` into a usable public multi-user video-creation product. This is an existing substantial application; inspect it and continue from the current checkpoints.

Read `AGENTS.md`, `PROJECT_STATUS.md`, `VALIDATION.md`, `PRODUCTION_PLAN.md`, `OPERATIONS.md` and the latest `CHANGELOG.md` entries before changing code. Follow the repository's Next.js documentation requirement. Treat older historical milestone descriptions as historical; use the latest status and validation records for current capabilities.

## Git state

- `origin/work` contains the accepted 0.60 application, detailed status report and this handoff. Accepted application code is `ece58be`; the status report was committed in `f9e83b8` and clarified in `7d09a75`.
- `origin/codex/render-budget` contains the separate 0.61 candidate. Its implementation is `59c6ec5`; its latest validation checkpoint is `7768981`.
- Do not assume `main` is current. Fetch and inspect the remote branches. Continue the render-budget candidate and bring in the latest `work` documentation without losing either branch's changes. Keep the candidate separate from accepted code until its remaining acceptance checks pass.
- All live worktrees were clean at handoff. Commit and push regularly; do not force-push or rewrite existing history.

## User instructions

Continue autonomously through milestones until the coding is complete or genuine user input is required. Do not stop after every milestone or repeatedly ask permission to continue. Give meaningful progress updates. Preserve original databases, media, backups and permanent lifecycle lock inodes; use isolated fixtures for migrations, deletion, compaction and restore tests. Do not deploy or operate on an actual installation without authorization.

Keep live AI verification until the very end; the user will supply the key later. Mocked providers, synthetic accounts/mail and real local Chromium/FFmpeg tests should support independent progress now. Actual SMTP/cloud service tests require appropriate configuration and authorization. Do not claim production readiness from offline tests alone.

## Implemented baseline and evidence

The application includes private accounts/personal studios, project CRUD/search/history, autosave/CAS/undo/recovery, canvas/timeline editing, media ingestion/reuse, microphone recording, narration notes, caption tools, authored starters, real native-HD MP4 exports, cancellation/recovery, quotas, privacy/deletion and local/encrypted backup tooling. Exact capabilities and remaining advanced editing gaps are in `PROJECT_STATUS.md`.

- Complete backend/native regression at 0.60: **543/543 passed**.
- Complete production HTTPS browser regression at 0.59: **89/89 passed**.
- Current relevant creator/mobile production browser checks at 0.60: **5/5 passed**.
- 0.60 production build, type, lint, formatting and private/prepared-renderer guards passed.
- Nine real local encrypted Restic repository/CLI/lock/cancellation checks passed; these are included in the 543 suite.
- 0.61 has **three focused policy/startup checks plus type/lint passes**, not a complete candidate regression.

Do not describe those different-source results as one complete latest-source browser/test pass.

## Immediate next work: finish 0.61

A valid five-minute portrait HD procedural-motion export hit the old 600-second attempt deadline without memory pressure. The candidate captures a duration-based policy at worker startup: automatic budgets are at least ten minutes, three times film running time for longer work, and at most the existing fifteen-minute ceiling. Explicit positive-integer operator overrides retain 1–15 minute clamping. Invalid settings refuse before creating worker state; Compose exposes the optional override. Worker and synthetic benchmark share the policy. Heartbeat freshness, memory/output caps and retry allowances are unchanged.

The same full five-minute portrait motion case **passed in 680.990 seconds** on **2 CPU/4 GiB**, exact 9,000 frames, 1080×1920/30fps H.264, with no memory pressure/OOM/swap. Its output is 7,064,447 bytes; total output footprint is 17,164,228 bytes. Source was frozen at `59c6ec5`; all 495 checked inputs matched. This proves one constrained synthetic pipeline case, not general load, public job admission or artistic acceptance.

Next:

1. Add/run focused real-worker coverage for explicit deadline enforcement, native-process teardown and a subsequent successful export, preserving saved work, leases and lifecycle inodes. Native tests use the prepared renderer through `scripts/test-unit.ts`; update its native-test selection if adding a new render test file.
2. Run the complete candidate backend/native suite, production build/guards, and appropriate relevant worker/browser checks. Record exact source IDs and actual results.
3. Integrate and push 0.61 after acceptance; then continue capacity/creator/operations work from the status report.

## Remaining release work

Broader motion/format/mixed-media and load measurements; real creator sessions and usability fixes; any essential advanced tools identified by those sessions; actual immutable app/test/operator images; hosted CI/staging/deploy/rollback/monitoring; actual off-host restore and historical local/provider-object retention; SMTP acceptance; final live AI quality/authentication/usage/failure verification. Current live storage is single-host SQLite/filesystem. Distributed live-media/database architecture, billing and shared team collaboration would be additional scope decisions.

## Environment and artifact notes

Use the pinned Node version and Linux FFmpeg/ffprobe, Chromium, `flock`, and Restic >=0.14. Avoid concurrent heavy build/native/browser runs on a constrained host.

If continuing in the same workspace, `/workspace/Reelchemy` is the accepted worktree and `/workspace/Reelchemy-render-budget` is the candidate. Evidence is under `/workspace/Reelchemy-evidence`, including `0.60`, `0.61`, and `review-0.60/REVIEW.md`. Private `fresh-unit.py`, `fresh-build.py`, `fresh-browser.py` and `fresh-benchmark.py` drivers record frozen source and resource limits. Source-mounted runners do not establish immutable-image acceptance.

Local Docker VFS capacity has blocked actual image acceptance; do not prune opaque Docker internals or remove original backups to work around it. Hosted Actions API reads have been forbidden; configured/pushed CI is not a verified hosted result. An earlier GitHub push was blocked by an account-usage approval-review failure; retry only through normal approval when available, never bypass it.

Generated large artifacts are outside Git. A different machine may not have them or the private drivers; use committed validation summaries and rerun needed checks rather than claiming unavailable evidence exists. Frozen workspace proof media may be hard-linked for deduplication; copy before editing.

An optional creator question is pending: the first real video's topic, audience and target length. Do not invent the user's answer. Continue independent work while waiting.
