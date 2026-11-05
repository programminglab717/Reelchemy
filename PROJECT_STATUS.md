# Reelchemy project status

Reviewed 6 November 2026 (Asia/Karachi); updated after 0.61 acceptance on 5 November 2026 (UTC). This records implemented functionality and executed evidence, not a production approval or a measured completion percentage.

## Committed checkpoints

- Accepted application code: **0.62.0** on `work` (fair shared render queue), accepted from frozen source `5b9b003`. 0.61.0 was accepted from `5567641`; 0.60.0 was `ece58be`.
- `codex/render-budget` (`7768981`) is superseded by `work`; its history is preserved in `work`.
- No production deployment, original database migration/compaction, original backup removal or live AI/SMTP operation has been performed.
- The 0.61 acceptance ran in a new cloud environment. The previous workspace's `/workspace/Reelchemy-evidence` tree and private drivers were not available; new-environment evidence logs are outside Git and are summarized in VALIDATION.md.

## Implemented creator application

### Projects and editor reliability

- Blank projects, deterministic demo planning, authored starters, project search/pagination and renaming.
- Storyboard review, creative conversation, scene revisions and saved-version preview/restore.
- Autosave with optimistic concurrency, bounded undo/redo, navigation/save guards and conflict recovery.
- Bounded account/project-scoped browser draft recovery and downloadable recovery files.
- Recoverable Trash, deliberate permanent project deletion and source-aware history cleanup.
- Desktop/mobile navigation, SVG controls, keyboard interactions and readable narration-note editing.

### Visual and timeline editing

- Canvas selection, drag/resize/static rotation, snapping/alignment, layer ordering, duplicate/lock/hide.
- Text/typography controls, supported font families, colors, media fit/crop/alignment and visual layer/camera keyframes.
- Timeline zoom/scrub, scene reorder/duplication, splitting, media trim/move and scene-only preview.
- Explicit scene deletion that closes the time gap, moves later audio/captions, splits retained audio source ranges and supports one-step undo.
- Editing limits: five minutes, sixty scenes, twelve independent audio tracks and five hundred caption cues. Individual scenes remain bounded to twenty seconds; individual input video/audio files remain capped at 120 seconds, and microphone takes at sixty seconds. The five-minute limit is the assembled project duration. Document/output limits also apply.

### Media, voice and captions

- Validated PNG/JPEG, footage and audio uploads with normalization, rights metadata and private access.
- Asynchronous ingestion, failure/retry/cancellation recovery and media reuse across owned projects.
- Source waveform display, audio placement/trimming, gain/fades and source-video audio mixing.
- Microphone capture/review/retry/download/save; each take is limited to sixty seconds.
- Editable scene narration notes, a notes reader beside recording, and note changes without losing a take.
- Selected-scene caption generation, caption timing/style controls, searchable/paged cues and burned captions.
- SRT/WebVTT export/import; the 256 KiB import allowance supports all 500 maximum-length Unicode/escaped cues exported by the app.
- Three editable HD starters: 45-second vertical launch, three-minute explainer and one-minute story.

### Export and portability

- Real H.264 MP4 encoding, AAC where audio exists, preview/export shared geometry and native 1080p selection.
- Landscape, portrait and square layouts; landscape/portrait HD are 1920×1080 / 1080×1920, square is 1080×1080.
- Durable queue/history/activity, progress, cancellation, bounded retries and native-process recovery.
- Checksummed scene reuse, bounded derived-cache retention and an optimized eligible-footage compositor.
- Layout diagnostics/limited repair, audio diagnostics, full encoded-frame/decode validation and decoded scene/thumbnail/tail evidence.
- Editable project ZIP import/export with assets, saved versions and capability checks for extended timelines/HD.

## Implemented backend and operations tooling

- Private personal studios with registration, verification/reset/session flows, ownership checks and account-bound request handling.
- Bounded mail outbox, retries and private recovery; tests use synthetic delivery rather than actual SMTP.
- Validated APIs, bounded request/media/document handling, rate limits, quotas and provider usage/reservation accounting.
- Source/media/project/export/job storage allowances, admission reservations and reviewed reclamation.
- Coordinated account erasure, private receipts, immediate access denial, resumable cleanup/retry and current-authority restore fencing.
- SQLite secure deletion, explicit offline compaction and scrubbing of newly owned inactive backup/restore copies.
- Verified local backups, non-overwriting restore, and encrypted Restic repository inspect/upload/full-restore/retention tools.
- Encrypted retention previews by default; applying requires explicit repository/authority pins, a recent verified restore anchor and normal repository locks. Other namespaces and original local snapshots stay intact.
- Separate web/render/ingest/mail/privacy/migration configuration, health/readiness/heartbeats, production/build guards, operator scripts, CI configuration and runbooks.
- The current adapter targets one Linux host with SQLite and durable filesystem volumes. S3 support here is for encrypted backups; live project/media storage has not been replaced with a distributed object-store/database architecture.

## Executed verification

| Check                                                         | Recorded result               | Important boundary                                                                                                                     |
| ------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Complete backend/native suite at 0.60                         | **543/543**, 520.081 seconds  | Frozen source `b885d04`; includes real native rendering and encrypted-repository checks.                                               |
| Complete production HTTPS browser regression at 0.59          | **89/89**, 2,324.414 seconds  | Frozen source `1dcaf29`; zero skipped, unexpected or flaky cases.                                                                      |
| Current relevant production browser checks at 0.60            | **5/5**, 247.249 seconds      | Recording/mixed-media export, scene cutting, mobile typography and navigation/account layouts. This is not a new complete 89-case run. |
| Focused encrypted repository/CLI tests                        | **9/9**, 107.825 seconds      | Real encrypted local repositories; no actual S3 service or production backup was used.                                                 |
| Production build/type/lint/format at 0.60                     | Passed                        | Includes dynamic-page, private-trace and prepared-renderer guards. Actual immutable service images remain a separate gate.             |
| 0.61 policy/startup contracts                                 | **3/3**, plus type/lint       | Focused candidate checks; not a full candidate regression.                                                                             |
| Complete backend/native suite at 0.61                         | **548/548**, 735.0 seconds    | Frozen `5567641`, non-root, new 4-CPU cloud container without a resource cgroup; includes real-worker deadline/native-release checks.  |
| Production build/guards/type/lint/format at 0.61              | Passed, 64.6 seconds          | BUILD_ID `jhCNJk17WYSUPgO7rQEn4`; ten pre-existing Turbopack tracing warnings, identical at 0.60; private-trace guard passes.          |
| Complete production HTTPS browser regression at 0.61          | **89/89**, 41.7 minutes       | Same frozen source/build; zero skipped/unexpected/flaky. Disposable cloud container, not a Docker test image; no peak memory recorded. |
| Complete backend/native suite at 0.62                         | **550/550**, 748.2 seconds    | Frozen `5b9b003`, same method as 0.61; adds fair-queue ordering/position contracts.                                                    |
| Complete production HTTPS browser regression at 0.62          | **90/90**, 41.1 minutes       | Same frozen source/build (BUILD_ID `NJkjEjaOMf01C0MjtxtBW`); includes the visible queue-position case; zero skipped/flaky.             |
| Hosted GitHub Actions                                         | **Not running**               | GitHub reports zero registered workflows and runs despite committed `checks.yml`; repository-admin action needed.                      |
| Five-minute landscape HD footage/caption/audio measurement    | Passed in **545.831 seconds** | Synthetic 2 CPU/4 GiB case, 9,000 frames; not a general load/quality guarantee.                                                        |
| Five-minute portrait HD procedural-motion measurement at 0.61 | Passed in **680.990 seconds** | 1080×1920, 30 fps, 9,000 frames, 15 scenes; approximately 1.26 GiB peak, no OOM/swap, within a bounded 15-minute budget.               |

The previous portrait-motion attempt hit the old 600-second deadline. The successful rerun and that failure are both retained. The new policy scales defaults by film length within the existing fifteen-minute ceiling, keeps shorter-film ten-minute defaults and preserves explicit bounded operator overrides. It does not raise heartbeat freshness, memory/output limits or retry counts.

Detailed frozen-source identifiers, resource records, failures/corrections and artifact locations are in [VALIDATION.md](VALIDATION.md).

## Remaining coding and acceptance work

1. **0.61 acceptance — done.** Real-worker deadline enforcement exposed and fixed a consumer exit caused by an orphaned FFmpeg stitcher. The complete suites pass from one frozen source; see VALIDATION.md.
2. **Broader render capacity.** Current long-form evidence covers specific synthetic landscape-footage and portrait-motion cases. Broaden representative format/motion/mixed-media cases and measure service throughput, queue behavior and failure recovery under load. These results may require further performance fixes or clearer supported-workload guidance.
3. **Creator acceptance and usability.** Complete real editing sessions against useful videos, review the whole exported films and fix the resulting workflow/visual/audio issues. Synthetic microphone tones and codec checks cannot establish spoken narration or artistic quality. A review pack with actual exports/notes/screenshots is available in the workspace.
4. **Remaining advanced editing scope.** Custom uploaded brand fonts, arbitrary layer masks, animated rotation and a general linked-track ripple/grouping workflow are not implemented. Existing static rotation, system typography, scene splitting, track manipulation and synchronized scene deletion are available. Longer continuous source imports/takes would also need additional ingestion/recording work. Whether these capabilities are required for the first launch needs creator/use-case feedback.
5. **Final real AI integration verification.** Adapters and mocked contracts exist; actual authentication/model/endpoint behavior, plan/revision quality, latency, spending/usage and provider failures still need live checks and any resulting fixes. This stays at the end, as requested.

## Production release work still open

- Choose/provision the production host, domain/TLS/reverse proxy, durable storage and secret management; validate the real configuration.
- Build and exercise the actual immutable app/test/operator images. Local Docker VFS capacity has blocked that acceptance; source-mounted verification does not substitute for it.
- Obtain actual hosted CI results. Actions reads now work, but GitHub reports **zero registered workflows and zero runs**: Actions appears disabled for the repository and needs administrator action.
- Run staging deployment/migration/rollback and restart/crash/recovery drills on the chosen infrastructure.
- Establish measured load/capacity targets, monitoring/alerts, supervision and incident procedures.
- Configure actual encrypted off-host storage, verify a real off-host restore, and define/execute policies for original local snapshots, provider object versions/replicas and host snapshots.
- Verify actual SMTP delivery/recovery with an explicitly configured test recipient/service; no real email has been sent.
- Complete real-browser/device/microphone and maker review, then final live AI acceptance before public use.

A distributed multi-host rendering/database/media backend would be additional architecture work if that deployment is chosen. Billing, shared team collaboration and public sharing also require separate product scope decisions; the implemented confirmed baseline is a public product with separate private personal studios.

## What is needed from the user later

- A real first-video topic, audience and target length, plus creator feedback on the review pack.
- Production hosting/domain/storage choices and the relevant operational access when moving into deployment acceptance.
- AI credentials at the final live verification gate, and SMTP/off-host credentials when those services are explicitly selected for testing.

Independent coding and offline verification do not require the AI key. The earlier **2–4 focused engineering week** estimate remains provisional planning for remaining hardening/acceptance/integration, not a promised calendar date. Feedback, hosting constraints and live-provider results can change it. There is no defensible measured percentage for “100% complete”; the concrete remaining gates above are the useful measure.
