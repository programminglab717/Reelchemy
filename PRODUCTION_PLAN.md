# Reelchemy production release plan

Prepared 28 October 2026 from the repository at `1d3d601`. This is a proposed release definition and effort estimate, not a statement that the listed features are implemented or a promised delivery date. Live AI verification is deliberately deferred until the final release gate; missing API keys do not block independent development or offline tests.

## Working release target

The user confirmed **a public multi-user product**. Separate customers must be able to register, verify an account, sign in and access only their own studio, projects, media and exports. Tenant isolation, account recovery, abuse controls and public-service operations are release requirements. Shared team workspaces and billing require separate product decisions; public signup does not by itself imply either feature.

Proposed video target: complete publishable videos from 30 seconds through five minutes, 1080p, 30 fps, in 16:9, 9:16 and 1:1. These limits need representative render/memory/disk benchmarks before they become supported guarantees. This release includes procedural animation, user-supplied images/video/audio, captions, and recorded narration. Arbitrary photorealistic character acting and feature-film generation are not acceptance criteria. Creative examples below demonstrate breadth rather than imposing required genres or templates.

A useful product must let a maker complete the ordinary creative workflow through the UI, without editing JSON or invoking shell commands. Manual editing must work without any AI provider.

## Baseline when this plan was prepared (0.5.0)

The current 0.5.0 foundation has deterministic Remotion/FFmpeg exports, a restricted scene DSL, demo planning, mocked-contract Claude/compatible adapters, scene revisions and restore, basic layer/scene controls, frame-keyframe and camera JSON editors, image/audio uploads, timed audio/captions, project ZIP round trips, render activity/recovery/cancellation, checksummed scene clip reuse, and technical QC evidence. The last verified suite was 25 unit tests and eight production browser tests, plus build/lint/type/format checks and an audit with zero reported vulnerabilities.

These tests validate implemented paths. They do not establish overall editor usability, artistic quality, production security, long-video performance, supported-codec breadth or service reliability under real users.

Current limits include a 60-second timeline, 12 scenes, local SQLite/filesystem storage, one render worker, 720p landscape/portrait outputs, fixed three-scene demo planning, no video-clip ingestion, no autosave/undo/redo, no user authentication/authorization, no database migration workflow, and no deployment/backup/monitoring system. A production Next.js build is not a deployed production service.

## Delivery workstreams and exit criteria

| Workstream         | Already present                                                  | Required for usable v1                                                                                                                                                                                              |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project UX         | Create/list, chat, storyboard, revisions                         | Create from blank; rename/search/pagination; autosave/recovery; undo/redo; reliable navigation; deliberate delete/restore; accessible errors/empty/loading states                                                   |
| Visual editing     | Numeric geometry, layer types, keyframe JSON                     | Canvas selection/drag/resize/rotate; stack/lock/hide layers; alignment/snapping; typography/font controls; visual keyframe/easing controls; responsive panels and keyboard actions                                  |
| Timeline           | Scene reorder/duplicate/duration; scene-only preview             | Zoom/scrub; scene and media trim/split; visible track timing; audio waveforms; caption cue manipulation; no JSON required for normal edits                                                                          |
| Media              | PNG/JPEG and local audio                                         | Uploaded video clips with fit/crop and in/out ranges; asset browser/reuse; brand colors/fonts; built-in licensed visual elements; microphone narration; actionable format/size errors                               |
| Audio/captions     | Frame trims, gain/fades, four-track mix; burned captions/SRT/VTT | Timeline-driven controls; waveform/safe-level feedback; caption styling/safe areas/import; recording; previews checked against export timing                                                                        |
| Creative workflow  | Demo plan and provider adapters                                  | Editable brief/script/shot plan; real asset selection in planning; targeted scene edits that preserve unrelated work; reproducible fixtures and failure handling; final live evaluation later                       |
| Export/QC          | Valid MP4, scene cache, stills/clips, layout repair              | Benchmarked five-minute/1080p targets; explicit quality settings; cancellation across stages; visual/motion regression projects; clear unresolved warnings; disk/cache retention policy                             |
| Backend/API        | Local project/job/asset endpoints                                | Complete validated CRUD; optimistic concurrency/idempotency; schema migrations; auth and resource authorization; quotas/rate limits; data deletion/retention; persisted provider usage/budgets; API error contracts |
| Storage/operations | Local SQLite/WAL and files                                       | Chosen production database/object-store adapters, durable media URLs, job supervision/heartbeats, structured redacted logs, health/readiness, backups and verified restore, monitoring/alerts                       |
| Deployment         | Local scripts/build                                              | Repeatable container/service configuration; staging; environment validation; pinned runtime dependencies; CI; migration/deployment/rollback scripts; operational runbook                                            |

Storage architecture should follow the deployment target. PostgreSQL and S3-compatible storage are the working recommendation for an internet-hosted team service; a deliberately single-host deployment can retain SQLite only with documented concurrency/durability limits and tested backups. Do not make an unchosen hosting vendor a blocker to writing adapters, local integration tests or deployment templates.

## Production acceptance gates

1. A maker can complete, reopen, revise and export three representative projects entirely inside the product: a vertical 45-second promotion, a three-minute narrated explainer, and a one-minute mixed-media story. Existing footage, images, recorded voice, captions and procedural scenes are usable without an external editor. These are test projects, not mandatory templates.
2. Standard edits use the canvas and timeline. Reloading or a recoverable interruption does not lose saved work. Undo/redo, versions and autosave have clearly defined and tested boundaries. Concurrent saves cannot silently overwrite a later revision.
3. Supported video sizes/durations/codecs are documented from actual benchmarks. MP4 codec, dimensions, frame rate, duration, audio timing/levels and caption timings are verified. Preview/export comparison and visual regression tests include long text, missing assets, portrait reflow, scene cuts, camera motion, clipping and mixed audio.
4. Every project, asset, revision, job, evidence and download endpoint enforces identity/resource authorization. Upload, remote-fetch and archive handling remain bounded. Keys never reach browser bundles/logs/exports. Public sharing is disabled unless expiring authorized sharing is implemented and tested.
5. Worker restart, cancellation, duplicate requests, timeouts, full disks, missing/corrupt media and interrupted deploys produce bounded, recoverable outcomes. Queue capacity, storage retention and provider budgets are explicit. The cache cannot grow without a managed retention policy.
6. A clean environment can install, migrate, start, run smoke tests, back up, restore and roll back using documented scripts. A staging deploy and a restore drill succeed. Monitoring detects worker loss and repeated failed renders.
7. The team completes realistic editing sessions and produces videos it would actually publish. Usability and quality feedback is fixed before calling the release production-ready. Passing technical tests alone does not satisfy this gate.
8. At the very end, configure the chosen real provider and verify authentication, endpoint/model compatibility, schema compliance, prompt-to-plan quality, targeted revisions, latency, token/spend reporting and failures. Real TTS/generated-media integrations get live checks only if included in the release. A failed live check may require implementation fixes; key entry is not assumed to be a formality.

## Test strategy without keys

Keep the deterministic demo path and add recorded/handcrafted provider response fixtures for valid, malformed, truncated, rate-limited, unauthorized, slow and unavailable responses. Test provider output validation and budget accounting with mocked usage, without presenting mocked results as real model quality.

Expand unit and integration coverage around undo/history/concurrency, media/timeline arithmetic, supported codec ingestion, storage/database adapters, ownership checks, migrations, quotas, worker lifecycle and archive limits. Use real Chromium/FFmpeg for media/browser tests. Run functional UI tests from blank project through editing/export, plus keyboard/accessibility checks, visual snapshots and representative long-video/resource benchmarks.

Use a staging environment with demo providers to validate deployment, permissions, backups, restore, failure injection and end-to-end workflows before introducing a paid API key. Preserve passed/failed/skipped/unrun outcomes separately. Do not equate sampled frames or codec validation with semantic/full-motion approval.

## Provisional effort and sequence — revised for public multi-user release

Planning assumption: one experienced engineer working full time, the public multi-user scope above, stable execution infrastructure and prompt product feedback. These are engineering-effort ranges, not elapsed times promised by this chat; no background delivery schedule has been established. Refine after the editor design, deployment choice and first realistic render benchmarks.

| Phase                                                  | Effort range               | Reviewable result                                                                                                |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Release definition and editor architecture             | 2–3 working days           | Confirmed release gates, UX flows, prioritized backlog, data contracts, benchmark baseline                       |
| Visual editor, timeline and project reliability        | 2–3 weeks                  | Useful manual editing, canvas controls, autosave/undo/redo, time-based trimming/splitting and media workflow     |
| Video/audio/caption and creative-workflow completeness | 1–2 weeks                  | Footage editing, recording, caption/style controls, coherent brief/script/asset workflow; expanded offline tests |
| Production backend, storage and deployment             | 1–2 weeks                  | Auth/authorization, migrations, durable storage/jobs, quotas, staging, backup/restore and runbook                |
| Hardening and creator acceptance                       | 1–2 weeks                  | Real editing sessions, long-video tests, performance/failure/accessibility fixes, reproducible release candidate |
| Final live AI verification                             | 1–3 working days initially | Real provider evidence and fixes; unexpected provider/quality issues can extend this gate                        |

For the confirmed public multi-user target, provisionally allow **10–16 focused engineering weeks**, including integration, security and creator feedback. This supersedes the earlier 6–10 week internal-release estimate. Tasks overlap and the range needs refinement after the editor benchmark and deployment design; it is not a calendar commitment. A security-sensitive public release needs explicit acceptance evidence, not just a larger feature list. Billing is included only if monetization is chosen.

## First implementation priorities

Start with editor state and project reliability: define an editing-command/undo model, autosave/concurrency contract, and a manual blank-project flow. Then build the visual canvas/timeline around those contracts; avoid growing the current numeric forms into the final editor. Add video media support and benchmark the five-minute/1080p target before increasing limits. Production auth/storage/deployment work can proceed with local adapters and demo providers while keys remain absent.

Maintain small, reviewed local commits with meaningful tests and update VALIDATION.md as each capability is exercised. No remote push or public deployment is implied by this plan. The release audience is now confirmed. Decisions still needed before deployment are hosting/storage target, intended usage volume, operational budget and monetization; these do not block the initial editor work.

## Completed since the public-scope decision (0.6.0)

The first public-account foundation is implemented: verified-email accounts, password reset/session revocation, private personal studios, resource authorization, workspace-scoped render caches, private media responses, durable mail outbox and an offline legacy-owner assignment script. The current checkpoint still uses development SQLite/files and has not been deployed publicly. These changes reduce the backend work remaining; they do not complete account deletion/privacy, public abuse protection, managed storage or deployment gates. See CHANGELOG.md and VALIDATION.md for the current executed evidence rather than treating the original gap matrix as a claim that every listed item is still absent.

## Manual editor progress (0.7.0)

The next checkpoint implements blank manual projects, bounded undo/redo, autosave, transactional stale-save rejection, save-before-navigation and visible draft recovery actions. A shared-renderer layout canvas adds selection/drag/resize, snapping/alignment, lock/hide and layer ordering. A timeline adds zoom, frame scrubbing and scene/media timing displays; layer/camera motion now has visual keyframe controls.

These are implemented capabilities, not completion of the editor workstream. Undo history is session-local; unsaved browser state is not durably cached offline. Rotation, typography controls, scene split/trim, waveform/media-bar manipulation, footage ingestion, recording, broader caption tooling and realistic creator acceptance remain open. Sixty-second/output-size caps are unchanged pending long-video benchmarks. See the current validation record for browser/render evidence.

## Footage and timeline progress (0.8.0)

Footage upload/normalization, fit/source-range/source-volume controls, source-audio mixing, private seeking and portable footage archives are implemented. Scene splitting preserves global audio/caption timing and original motion/source phases. Video/audio/caption bars now move and trim directly with source/scene/neighbor bounds and undo.

This advances the manual mixed-media workflow. Remaining work includes waveforms, recording, ripple editing, richer typography/rotation, caption styling/import, five-minute/1080p benchmarks and creator acceptance, alongside production storage/quotas/retention/abuse controls and deployment operations. Upload normalization is bounded local processing, not distributed ingestion or an OS-level decoder sandbox. Sixty-second project/output limits and deferred live-AI verification are unchanged.

## Narration, captions and project reliability progress (0.9.0)

The manual workflow now includes microphone take capture/review/download/retry, source waveforms, plain SRT/WebVTT import, burned-caption style controls, clipping checks for every cue, project-name search/pagination and concurrent-safe renaming. Mobile can reopen saved projects and sign out. Liveness/readiness probes and a render-worker heartbeat cover basic availability; a CI workflow is configured but has not run on GitHub.

These changes do not complete creator acceptance, real microphone/device testing, richer typography/rotation/crop/ripple editing, long-video benchmarks, offline draft durability, deletion/privacy, public quotas/budgets, managed storage, backup/restore/staging or production operations. Live AI remains deferred. Existing duration/output caps remain in force.

## Local backup and restore progress (0.9.1)

Private checksummed snapshots and non-overwriting restore are implemented for the existing SQLite/filesystem adapter, with a real account/media/authentication drill and a separate snapshot/restore of this workspace. Sessions/tokens are revoked in the restored copy and pending renders require explicit restart. The runbook requires coordinated writer shutdown. This closes the initial local backup-tooling gap; chosen off-host storage/encryption, scheduling/retention, staging and measured production restore objectives remain open. This is not a managed database/object-store adapter or a public deployment.
