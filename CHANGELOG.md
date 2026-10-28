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
