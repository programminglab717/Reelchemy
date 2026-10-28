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
