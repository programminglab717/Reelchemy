# Prompt for the next AI developer

Continue development of `programminglab717/Reelchemy` into a usable public multi-user video-creation product. This is an existing substantial application; inspect it and continue from the current checkpoints.

Read `AGENTS.md`, `PROJECT_STATUS.md`, `VALIDATION.md`, `PRODUCTION_PLAN.md`, `OPERATIONS.md` and the latest `CHANGELOG.md` entries before changing code. Follow the repository's Next.js documentation requirement. Treat older historical milestone descriptions as historical; use the latest status and validation records for current capabilities.

## Git state

- `origin/work` contains the accepted **0.61** application (accepted source `5567641`), status report and this handoff. It includes the former `codex/render-budget` candidate history, which is now superseded.
- Do not assume `main` is current. Fetch and inspect remote branches before work. Keep new candidates separate from accepted code until their acceptance checks pass. Do not force-push or rewrite existing history.

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
- 0.61 complete acceptance from one frozen source: **548/548** backend/native, production build/guards, **89/89** production browser (new cloud environment, non-root, no resource cgroup).

Do not describe those different-source results as one complete latest-source browser/test pass.

## 0.61 acceptance (done)

The duration-based attempt budget is accepted. New real-worker coverage (`tests/render-deadline-worker.test.ts`) found that a deadline-expired long export left Remotion's FFmpeg stitcher alive, so the consumer failed closed and exited. The worker now releases only its own marked descendant processes (grace, then PID-checked SIGTERM/SIGKILL) and still fails closed if anything survives. One frozen source passes 548/548 backend/native, production build/guards and the complete 89/89 production browser regression; details are in VALIDATION.md. Run native/browser suites as a **non-root** user: one `/proc` recovery check intentionally fails as root.

## Immediate next work

1. Fair shared render queue and queue position for makers (started after 0.61; see the latest CHANGELOG/VALIDATION for its state).
2. Broader constrained capacity measurements (square/landscape motion, full-footage mixed media) under 2 CPU/4 GiB. Where Docker is unavailable, cgroup-v1 CPU/memory limits work in the cloud container.
3. Continue creator usability, operations and release work below.

## Remaining release work

Broader motion/format/mixed-media and load measurements; real creator sessions and usability fixes; any essential advanced tools identified by those sessions; actual immutable app/test/operator images; hosted CI/staging/deploy/rollback/monitoring; actual off-host restore and historical local/provider-object retention; SMTP acceptance; final live AI quality/authentication/usage/failure verification. Current live storage is single-host SQLite/filesystem. Distributed live-media/database architecture, billing and shared team collaboration would be additional scope decisions.

## Environment and artifact notes

Use the pinned Node version and Linux FFmpeg/ffprobe, Chromium, `flock`, and Restic >=0.14. Avoid concurrent heavy build/native/browser runs on a constrained host.

If continuing in the original workspace, `/workspace/Reelchemy` is the earlier worktree. Evidence is under `/workspace/Reelchemy-evidence`, including `0.60`, `0.61`, and `review-0.60/REVIEW.md`. Private `fresh-unit.py`, `fresh-build.py`, `fresh-browser.py` and `fresh-benchmark.py` drivers record frozen source and resource limits. Source-mounted runners do not establish immutable-image acceptance.

Local Docker VFS capacity has blocked actual image acceptance; do not prune opaque Docker internals or remove original backups to work around it. Hosted Actions API reads have been forbidden; configured/pushed CI is not a verified hosted result. An earlier GitHub push was blocked by an account-usage approval-review failure; retry only through normal approval when available, never bypass it.

Generated large artifacts are outside Git. A different machine may not have them or the private drivers; use committed validation summaries and rerun needed checks rather than claiming unavailable evidence exists. Frozen workspace proof media may be hard-linked for deduplication; copy before editing.

An optional creator question is pending: the first real video's topic, audience and target length. Do not invent the user's answer. Continue independent work while waiting.
