# Reelchemy production release plan

Prepared 28 October 2026 from the repository at `1d3d601`. This is a proposed release definition and effort estimate, not a statement that the listed features are implemented or a promised delivery date. Live AI verification is deliberately deferred until the final release gate; missing API keys do not block independent development or offline tests.

## Current engineering checkpoint — 4 November 2026 (0.54.0)

The studio includes visual/timeline editing, autosave/CAS/undo and durable draft recovery, footage/images/audio/recording/captions, private accounts and media reuse, real MP4 export/cache/retry/cancellation, permanent project removal and coordinated snapshots. Source/media, project-history, binary-export and detailed-job storage have explicit allowances and reviewed cleanup that preserve current edits and original-media references. No live provider or SMTP consumer has been used.

Account deletion now has deliberate fresh-password confirmation, a saved private receipt, immediate session/producer denial, resumable credential-free cleanup, native/media/mail lease coordination and provider cost preservation. Format-5 backups and every supported restore reconcile inactive copies against an independent current approval authority, preventing approved identities from reopening through normal restore. Settings and public receipt recovery preserve another signed-in maker and clear only the erased account's browser drafts. This covers active-service removal; physical database/WAL and historical/off-host backup disposal remain separate work.

The complete backend/native suite passes **503/503** at `57ee5da`, including all native-HD/legacy behavior and archive/backup compatibility, following 26 focused checks. Selectable native 1080p and matching preview/canvas/caption/layout geometry preserve standard dimensions for existing work. Final static/production build/private traces/prepared-renderer guards and both new production HTTPS HD maker flows pass at `6c702c1`, including real decoded downloads and reviewed mobile controls. The latest complete mixed production-browser baseline remains **79/79 at 0.52**, with the two new HD flows recorded separately. A synthetic native-HD footage minute passes in 210.514 seconds on the recorded 4 CPU/6 GiB runner; production-sized resources and longer projects remain open. Evidence and retained failures are in VALIDATION.md and `/workspace/Reelchemy-evidence`. Development checkpoints are pushed to GitHub; actual user storage has not been upgraded or deployed.

Public release gates remain open: physical DB/WAL/backup retention, remaining creator workflow polish, representative longer-video/native-HD performance and creator acceptance. Hosted staging/CI, real mail delivery, off-host restore, monitoring/load acceptance, immutable images for all service roles and final live-AI verification remain required. Immutable-image acceptance is blocked by unaccounted Docker VFS storage; mounted-source checks do not close it. Hosted Actions API inspection returns Forbidden, so source pushes do not establish hosted CI acceptance. Current duration/scene limits remain **60 seconds/12 scenes**; landscape/portrait now have selectable native 1080p, while standard dimensions and 1080-square stay available. Production-sized HD and longer-video acceptance remain open. The measured static-minute optimization does not establish five-minute moving-footage/native-HD support. Missing AI keys do not block independent coding or offline tests.

The planning estimate remains **2–4 more weeks of focused engineering and release testing**, subject to performance/hosting findings and external credentials. Roughly a final quarter remaining is a planning judgment, not a measured percentage or promised delivery date.

## Working release target

The user confirmed **a public multi-user product**. Separate customers must be able to register, verify an account, sign in and access only their own studio, projects, media and exports. Tenant isolation, account recovery, abuse controls and public-service operations are release requirements. Shared team workspaces and billing require separate product decisions; public signup does not by itself imply either feature.

Proposed video target: complete publishable videos from 30 seconds through five minutes, 1080p, 30 fps, in 16:9, 9:16 and 1:1. These limits need representative render/memory/disk benchmarks before they become supported guarantees. This release includes procedural animation, user-supplied images/video/audio, captions, and recorded narration. Arbitrary photorealistic character acting and feature-film generation are not acceptance criteria. Creative examples below demonstrate breadth rather than imposing required genres or templates.

A useful product must let a maker complete the ordinary creative workflow through the UI, without editing JSON or invoking shell commands. Manual editing must work without any AI provider.

## Baseline when this plan was prepared (0.5.0)

The 0.5.0 foundation had deterministic Remotion/FFmpeg exports, a restricted scene DSL, demo planning, mocked-contract Claude/compatible adapters, scene revisions and restore, basic layer/scene controls, frame-keyframe and camera JSON editors, image/audio uploads, timed audio/captions, project ZIP round trips, render activity/recovery/cancellation, checksummed scene clip reuse, and technical QC evidence. Its verified suite was 25 unit tests and eight production browser tests, plus build/lint/type/format checks and an audit with zero reported vulnerabilities.

These tests validate implemented paths. They do not establish overall editor usability, artistic quality, production security, long-video performance, supported-codec breadth or service reliability under real users.

At that baseline, limits included a 60-second timeline, 12 scenes, local SQLite/filesystem storage, one render worker, 720p landscape/portrait outputs, fixed three-scene demo planning, no video-clip ingestion, no autosave/undo/redo, no user authentication/authorization, no database migration workflow, and no deployment/backup/monitoring system. Many of these gaps are now closed as described above. A production Next.js build is not a deployed production service.

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

## Typography progress (0.10.0)

Text can now be edited/styled directly from the selected canvas layer: system family, weight, alignment, spacing and decorations share preview/export/QC styles and survive autosave/history/archives. Narrow glyph clipping receives actual Chromium scroll-dimension checks. A split-phase regression in orbital graphics was reproduced and fixed. Rotation, brand fonts, richer crop/ripple editing, duration/output benchmarks and creator acceptance remain open alongside the public-service backend/operations work.

## Project Trash progress (0.11.0)

Recoverable project removal and restoration are implemented with save/take guards, active-job cancellation, owner-scoped search/pagination and resource hiding until restore. Additive migrations are serialized/tested across parallel starts. This advances deliberate delete/restore UX while retaining all files and versions; permanent privacy erasure, storage reclamation and retention policy remain open.

## Request-budget progress (0.12.0)

Persistent per-workspace windows now bound write/upload/planning/export attempts with atomic cross-process admission, origin/ownership-first enforcement and useful retry errors. Readiness detects invalid operator policy. This is an initial public abuse-control layer; byte quotas, actual provider token/spend accounting, global ingestion isolation, deletion/privacy, chosen hosting/storage and production load/abuse tests remain required.

## Media framing progress (0.13.0)

Images/video now have canvas fit/fill/crop alignment controls, live gesture preview, one-step gesture undo and non-destructive source preservation. Actual downloaded MP4 frame pixels validate both image and footage framing. Caption/text export checks also decode MP4 frames directly. The production Trash page remains dynamic independently of build-time credentials. Rotation/masks, ripple editing, long-video benchmarks, private draft durability, public storage/spend/privacy/ingestion controls and deployment/creator acceptance remain open.

## Runtime and planning progress (0.14.0–0.15.0)

A reproducible container image, single-host service template, explicit production authentication migration, dynamic-page build guard and kernel-managed worker lifecycle are implemented. All 30 browser cases passed against the committed 0.14.0 production build over verified loopback HTTPS with secure cookies and no external runtime network; this is local disposable acceptance, not hosted staging or live mail/provider delivery.

Planning now receives project-owned media metadata, rejects invalid/foreign references and ranges, respects the current edited format/duration and preserves unrelated scene/audio/caption work. Editor and planning commits recheck ownership, Trash, revisions and media under one write transaction. The 0.15.0 unit suite passes 84 cases with intercepted provider responses. Real planning quality, actual token/spend accounting, storage quotas/ingestion isolation, durable offline recovery, long-video benchmarks, deployment operations and creator acceptance remain open. Missing AI keys still do not block independent development.

## Media allowance progress (0.17.0)

Retained normalized media now has per-studio accounting and a configurable 512 MiB default ceiling, including Trash and actual imported-file sizes. Upload/import admission serializes quota, ownership and asset-count checks, cleans rejected files and prevents late uploads from changing a project moved to Trash. Private usage/retry UI and explicit studio/account migration/recount tooling advance the public-service storage controls. Existing manual/media-free work remains available above the allowance.

This closes the initial retained-media byte-admission gap. Global decoder isolation, export/cache/backup retention, permanent privacy erasure, actual provider spend budgets, large-project/history performance and five-minute/1080p benchmarks remain open alongside public staging and creator acceptance. Live AI verification stays deferred.

## Export admission checkpoint — 0.18.0, 30 October 2026

Public exports now use an atomic active-owner/revision/media/QC/capacity check and an optional durable project-scoped idempotency receipt. The editor saves first and approves that revision; a stale tab uses draft/open-latest recovery, and a lost response can be retried within the open editor without a duplicate render. Receipts survive backup/restore, preserve terminal states and do not bypass request allowances. This closes the observed late-Trash admission race. Cross-reload offline recovery, lifecycle erasure of job/receipt/media history, broader capacity/spend controls and the longer-video production targets remain separate work.

## Render media-memory checkpoint — 0.19.0, 30 October 2026

Image/audio bytes no longer enter composition props; all render media uses job-scoped private loopback URLs, streamed fingerprints, bounded ranges and attempt-owned descriptors. Chromium still decodes full images and rendering still consumes CPU/memory; this change alone does not establish a five-minute/1080p guarantee or globally isolated ingestion. Unit checks also receive a fresh private fallback root rather than writing media-only fixture files into the actual studio. Longer mixed-media benchmarks, normalized revision storage, ingestion capacity controls and privacy erasure remain open.

## Project library memory checkpoint — 0.20.0, 30 October 2026

Studio/Trash listings now extract compact private metadata in SQLite; they do not hydrate/transfer complete histories on each search or navigation refresh. The existing full API remains compatible and editor opening still fetches the complete project. A 400-revision fixture retains its data while its summary stays under 250 bytes. This is a listing improvement; embedded histories still need normalization/lazy loading before larger-project performance can be claimed.

## Layer rotation checkpoint — 0.21.0, 30 October 2026

The editor now exposes static layer angles, matching selection/resize geometry and preview/export transforms, with save/history/split/archive preservation. Canvas pointer rotation previews and commits one undo step; numeric/keyboard and quarter-turn controls remain available on mobile and respect locks. Geometric overlap checks account for rotated text, and base-position clipping is a warning rather than an automatic angle/size change. Animated rotation, masks/brand fonts, ripple editing, durable offline drafts, long-video benchmarks and the remaining public-service work are separate gaps.

## Active export admission/visibility checkpoint — 0.22.0, 30 October 2026

The public queue now limits a studio to two active jobs by default within the five shared slots, atomically across concurrent web processes, and exposes private cross-project progress/cancellation in the Studio. Receipts replay without allocating another slot; queued/rendering work counts together and terminal/Trash cancellation releases admission. Explicit capacity responses differ from daily request windows. This advances multi-user admission/UX; it does not implement globally budgeted ingestion/provider spending, a distributed worker system, strict round-robin scheduling or measured public-service capacity.

## Private account storage checkpoint — 0.23.0, 30 October 2026

Production accounts/mail/signing-file material now use a separate configured root and private service volume. The renderer receives neither that mount nor authentication/provider/SMTP environment credentials; mail receives only the private account mount. Legacy production data requires coordinated backup/restore into new separate roots rather than in-place deletion. Build guards reject runtime credentials/media in server traces. Unit and real legacy-snapshot restore checks are executed; current app-image filesystem/production HTTP acceptance is recorded separately. Web-side media ingestion remains in the web process, and global decoder isolation/budgets, permanent erasure/retention, longer videos, hosting operations and creator acceptance are still open.

## Provider error boundary checkpoint — 1 November 2026 (0.24.0)

Server configuration validation, credential-safe fixed errors, redirect refusal, bounded response streams and no automatic retries are implemented with offline contracts for both adapters. Authenticated route regressions verify that failures preserve the saved project and a later valid plan still works. These controls do not meter actual provider token/dollar usage or establish real model quality. Live requests remain deferred; public staging, SMTP delivery, budgets, global ingestion isolation, permanent erasure/retention, durable drafts and longer-video acceptance remain open.

## Browser timeline recovery checkpoint — 1 November 2026 (0.25.0)

Durable browser copies of unsaved timeline edits, explicit recovery/discard/download, separate concurrent-tab records and account-scoped sign-out cleanup are implemented. Recovery from a different saved base requires confirmation and saves through the existing optimistic-concurrency API; version history and undo are retained. Local storage is bounded per record, never evicts other work automatically, and reports failures with a download fallback. Reopening projects still requires the server; uploaded media/microphone takes, full offline operation and server backups of browser-only edits are outside this feature. Current-source production browser acceptance is recorded separately after execution. Permanent server-side erasure/retention, spending/global processing controls and long-video benchmarks remain open.

## Permanent project removal checkpoint — 1 November 2026 (0.28.0)

Confirmed owner-scoped permanent removal, durable cleanup/retry, shared/history/job reference protection, resource hiding, quota reclamation, browser-copy scoping and new-backup normalization are implemented. Real worker tests cover cancellation before cleanup, preserved exports/media, a later successful export, symlink/parent safety, repaired retry and non-resurrection on restore. Production browser/container acceptance is recorded separately after execution. This closes the project-level active-storage reclamation gap; it does not close account erasure, historical backup retention/forensic erasure, global ingestion/spending/cache/metadata controls, long-video optimization/1080p support, hosted operations or creator acceptance. The cold 60-second square fixture completed in about 7.1 minutes under 2 CPU/4 GiB, so longer targets need measured optimization before limits change.

## Browser account-switch checkpoint — 1 November 2026 (0.29.0)

Private browser requests now declare the server-rendered account and fail before workspace/quota/data access if its verified cookie belongs to another account. Studio/Trash remount on a server account change. Once a tab detects changed/expired authentication it rejects new and late private responses, keeps original-account local edits/downloads, and offers reload. The actual sign-out request also checks this binding. Real SQLite/auth and transport-race tests pass; production browser acceptance is recorded after execution. This closes the stale-tab cross-account recovery-scope gap; it does not replace ordinary cookie authentication, owner checks, origin/rate controls or address the remaining production/creator gates above.

## Static-scene render efficiency checkpoint — 1 November 2026 (0.30.0)

Eligible static title cards reuse bounded real browser captures and still encode every output frame; captions retain exact starts/ends and ordinary animation/footage rendering remains available. Actual paired short exports match decoded baseline pixels, color metadata and frame counts in all three formats, including rotated media/captions, cache reuse and cancellation cleanup. The paired restricted cold static-minute job fell from 242.208 to 168.694 seconds (30.35% in that fixture), with full-resolution SSIM 1.000000 across all 1,800 frames and identical decoded PCM audio. This addresses repeated captures of unchanged visuals; it does not establish the five-minute/1080p landscape/portrait target or accelerate continuously moving footage. Current duration/resolution limits remain unchanged while the remaining performance and public-service work continues.

## Studio media reuse checkpoint — 1 November 2026 (0.31.0)

Makers can search/filter/page through their own active-project uploads and reuse existing normalized images/footage/audio in another project. Shared files retain rights/provenance, consume storage once, preserve current editor drafts and remain available after source removal when still referenced. Atomic ownership/activity checks and retry-safe links are implemented, including safe legacy IDs and per-project limits; selected-scene capacity no longer blocks insertion into a different scene. Nine real auth/SQLite/file-safety checks pass; full/backend/build/browser acceptance is recorded after execution. The public-service ingestion isolation, cost ledger, account erasure/retention, history scaling, longer-video/1080p target, brand-font/richer creative tools and deployment/creator gates remain open.

## Saved-version browsing checkpoint — 0.37.0, 2 November 2026

Makers can page through private saved-edit metadata, preview a selected retained film, and restore it as a new version. Preview/read failures retry without changing current unsaved work; a lost restore response recovers through the current saved film rather than silently overwriting a later edit. Mobile controls, keyboard/focus behavior and recording guards have targeted production HTTPS acceptance, including actual narration export. The backend passes 236 tests. Initial editor reads/saves still carry embedded history; normalized/lazy editor storage and archive compatibility beyond legacy history limits remain next work. Account erasure/retention, longer-video targets, richer creative tools, hosted operations and maker/live acceptance remain open.

## Portable retained-history checkpoint — 0.38.0, 2 November 2026

Editable projects with more than 500 versions or 1,000 messages now use an explicitly declared format-3 capability and round-trip up to 10,000 of each within the existing independent byte limits. The exporter validates the portable data and anchored regular media files; unknown server fields do not travel. Failed/cancelled downloads remain recoverable through the UI and do not become error ZIPs. Focused cleanup/ownership/size/canary tests, 251 backend tests, the production build and four selected HTTPS workflows pass. Embedded main-editor history remains a scaling gap. The next code work rechecks active ownership/current media and history selection atomically when a restore body streams across a Trash/concurrent edit, before proceeding with storage/editor scaling.

## Atomic restore checkpoint — 0.38.1, 2 November 2026

Saved-version restore now atomically rechecks active ownership, Trash/deletion intent, CAS revision and current media, with unique bounded snapshot selection and private fixed errors. Regressions reproduced three unsafe responses in the earlier code and pass with the fix. Focused backend and three selected desktop/mobile production HTTPS cases pass. The next independent task is compact main-editor reads/responses and bounded conversation paging; the underlying embedded JSON/history storage still needs a later normalization step.

## Compact main-editor checkpoint — 0.39.0, 2 November 2026

Current-film editor reads and declared mutation responses carry bounded current data, recent version metadata and paged saved directions. Older work remains accessible, saved metadata counts remain accurate, unsaved edits survive read retry, and projected mutation responses cannot silently adopt a later writer's revision. Focused and 267 complete backend tests, production build and four targeted HTTPS workflows pass. Complete production HTTPS browser acceptance now passes 66/66. Server-side embedded history rewrites, metadata quotas/normalization and derived-cache retention remain separate work alongside the other production/creator gates.

## Derived scene-cache retention checkpoint — 0.40.0, 2 November 2026

Shared/per-studio byte ceilings, entry count and age limits now reclaim known derived clips between jobs under the permanent render lifecycle lock. Read-only inspection and explicit apply refuse unsafe/unknown roots and preserve source media, finished exports, other studios and the coordination inode. Real expiry/rebuild/reuse/cancellation and project-cleanup checks, all 288 backend tests, production build and ten selected HTTPS workflows pass. This bounds steady-state derived clips; an active job can temporarily exceed cache byte ceilings. Normalized history/metadata quotas, export/backup retention, account erasure, longer-video/HD benchmarks, richer creator tools and hosted/creator/live acceptance remain open. The next implementation prepares the composition during the application build to remove production runtime compilation/cache pressure.

## Prepared production rendering checkpoint — 0.41.0, 2 November 2026

The complete build now retains a content-verified video composition tied to the Next build identity. Production workers refuse incomplete/mixed/corrupt assets before readiness or queue claim, and exports use the immutable composition without runtime webpack compilation/cache writes. Native tests use one real prepared fixture while preserving all existing assertions/timeouts. All 293 backend tests, build/type/lint/format and the complete 66-case production HTTPS browser suite pass. Before/after inventories confirm no runtime compiler bundles were created. This removes production cold-compilation work; longer-video/native-HD capacity still needs measurement. The next independent implementation adds bounded retained-project data admission and deliberate reviewed saved-history cleanup; normalized storage, exports/backups/account erasure and hosted/creator/live gates remain open.

## Retained-project allowance and cleanup checkpoint — 0.42.0, 2 November 2026

Logical project JSON/count/version/direction limits now use an additive trigger-maintained UTF-8 census and atomic growth admission. Existing overages remain readable, reductions remain allowed, and reviewed owner-scoped history cleanup keeps the current saved film/latest ID, unsaved work/undo/recovery, uploads and immutable exports. Exact-data previews reject intervening edits, and bounded receipts recover a lost apply response without adopting a newer save base. Reviewed narration takes remain available while freeing their allowance. All 312 backend tests, build/type/lint/format and thirteen targeted production HTTPS workflows pass; the complete 66-case baseline remains 0.41. These are logical allowances, not physical DB/backup erasure. The next independent work adds shared normalized-upload admission and operator storage visibility; export/backups/account erasure, normalized append-only history, longer-video/native-HD and hosting/creator/live gates remain open.

## Retained-export budget checkpoint — 0.49 candidate

Atomic studio/shared byte and count admission, captured output ceilings, verified native settlement/recovery, private usage, studio-wide file management, stopped-writer census and portable copied-ledger normalization are implemented in the candidate. Targeted offline/API/operator/race and actual Chromium/FFmpeg quota-cleanup-fresh-MP4 checks pass; full backend/build/browser acceptance is pending. The manager preserves the currently edited film while reviewing another project's files. No automatic eviction or actual data upgrade occurs. Cooperative metering is not a strict filesystem quota. This advances completed-export capacity and reclamation; historical job/document growth, account erasure, backup/physical retention, richer creator tools, longer-video/native-HD performance and hosted operations remain open. Live AI verification stays at the final release gate.

## Export activity checkpoint — 0.50 candidate, 4 November 2026

Job report/timeline/receipt capacity, bounded source-aware activity retirement, private usage/paging/downloads, old-writer guards and portable v4 accounting/source preservation are implemented. All 417 final backend/native checks and the first full-500-record real MP4/mobile workflow pass. The final legacy-read variant also has ten targeted passes; final production build/browser acceptance is pending. Current films/undo/originals and other retained MP4s stay intact; retired records and their source references stay bounded and explicit. This closes the initial unbounded detailed-job growth path, while physical database/WAL/backup retention, account erasure, longer-video/native-HD/creator work and hosted release gates remain open. The full browser baseline remains 74/74 at 0.49 until the next complete run finishes. Live AI verification stays deferred until the final gate.

## Account-erasure checkpoint — 0.52.0, 4 November 2026

Deliberate whole-account confirmation, saved private receipts, immediate authentication/producer denial, credential-free resumable cleanup, captured-mail settlement, provider ownership detachment preserving global charges, format-5/current-authority restore reconciliation, incomplete-restore refusal and scoped browser-copy fencing are implemented and verified. Complete 491-case backend/native acceptance and the subsequent eight preflight checks are recorded separately from the final 79-case production HTTPS browser pass; final build/static/visual checks pass. Earlier 481/482 shutdown failure and its correction remain documented. No actual installation was migrated or erased.

Active-service account removal closes this functional gap. Operator cleanup retry, physical DB/WAL/historical-backup retention, longer/native-HD capacity, richer creator workflows/representative maker acceptance, immutable-image/hosted/load/restore/monitoring acceptance and final live SMTP/AI checks remain. Supported duration/output limits remain unchanged.

## Operator recovery checkpoint — 0.53.0, 4 November 2026

A private explicit command now requeues bounded failed cleanup tasks after the underlying fault is corrected. It requires current pending authority, exact local approval and project ownership, uses existing pinned private stores without initializing/migrating them, and preserves other makers and all captured holds. Thirteen targeted store/real-command checks and the complete 497-case backend/native suite pass. The unchanged UI's complete production HTTPS baseline remains 79/79 at 0.52; no newer build/browser result is claimed. Physical retention and the remaining long-video/native-HD/creator/hosted/live release gates stay open.

## Selectable-HD checkpoint — 0.54.0, 4 November 2026

An explicit native-HD option now survives save/undo/versions/archive/backup and drives preview, layout, cache and actual encoding consistently. All 503 backend/native cases, production build and two new HTTPS maker flows pass; mobile controls and real downloaded frame dimensions are verified. Archive/backup capabilities prevent old tooling silently losing HD intent. A measured minute takes 3.5 minutes on the isolated 4 CPU/6 GiB runner, so this does not justify five-minute admission or production-sized memory claims. Fixed-artwork footage compositing and a bounded fallback decoder cache are the next independent performance work. Remaining retention/creator/hosted/image/live gates are unchanged.
