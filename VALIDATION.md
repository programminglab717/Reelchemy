# Validation history

## Baseline — 27 October 2026

Executed in `/workspace/Reelchemy` on Linux with Node 24.19.0, npm 11.9.0, system Chromium, FFmpeg/ffprobe, and Remotion 4.0.539. These results describe this instance; fresh-task restoration and publication have not been tested.

| Check                                        | Result                                            |
| -------------------------------------------- | ------------------------------------------------- |
| `npm ci --cache /workspace/.npm`             | Locked reinstall verified                         |
| `npm run seed` (twice)                       | Existing sample projects preserved; no duplicates |
| `npm run lint`                               | Passed                                            |
| `npm run typecheck`                          | Passed                                            |
| `npm test`                                   | 8 passed; none skipped                            |
| `npm run build`                              | Production build passed                           |
| `npm run format:check`                       | Passed                                            |
| `npm run test:e2e` against production server | 2 passed, 24.2 seconds; none skipped              |
| `npm audit --audit-level=high`               | 0 vulnerabilities                                 |
| Five-second landscape render                 | Passed actual encoding and ffprobe verification   |
| Thirty-second portrait render                | Passed actual encoding and ffprobe verification   |

## Encoded evidence

| File                                     | Codec | Dimensions | Frame rate | Duration | Bytes     |
| ---------------------------------------- | ----- | ---------- | ---------- | -------- | --------- |
| `artifacts/sample/video.mp4`             | H.264 | 1280×720   | 30 fps     | 5.000 s  | 511,079   |
| `artifacts/sample-portrait-30/video.mp4` | H.264 | 720×1280   | 30 fps     | 30.000 s | 1,326,387 |

Both have three scenes and no audio. The renderer automatically verifies codec, dimensions, fps, and duration. Each sample folder contains nine sampled scene PNGs, three actual motion clips, a thumbnail, and `report.json`. Static checks found no declared bounds, text-box overlap, or missing-asset issues in those samples. Captured frames were inspected for the landscape sample and portrait landscape scene; this does not constitute semantic or full-motion approval.

The browser test exercises create → plan → three varied scene strategies → edit → save → approve → real render worker → actual MP4 download → ffprobe → reload saved edit. Download evidence is in `artifacts/e2e-export.mp4`. Desktop studio/storyboard and mobile screenshots are in `artifacts/ui-*.png`. The test uses unique project names so repeated runs preserve existing user work.

Unit checks cover invalid/oversized timelines, exact scene-boundary arithmetic, frame-deterministic animation, all format schemas and boundary durations, a compatible-provider request with mocked API responses, and controlled overlap/missing-asset regressions. A bounds regression demonstrates localized correction with before/after evidence and capped attempts; unresolved overlap/missing-asset issues remain surfaced rather than being reported as repaired.

## Diagnosed issues resolved during this build

- The first render included an automatically padded audio track. Verification rejected its 5.056-second container duration. Silent exports now disable audio muxing; verified sample duration is exactly 5 seconds.
- Next.js dev origin protection blocked hydration/HMR from the loopback test hostname. Explicit `127.0.0.1` dev-origin configuration and a disabled-until-initialized composer corrected the workflow.
- An early JSX closing-tag mistake was caught by type/lint checks and corrected before final tests.
- Repeated E2E runs initially selected duplicate project names ambiguously. Unique test names fixed the repeatability problem without deleting saved projects.
- A vulnerable pinned transitive Zod dependency remained after a Remotion update. A compatible-major override onto Zod 4.6.7+ removed it; unit, render, and production browser checks passed afterward.

## Baseline limitations (superseded by later checkpoints below)

Real paid-model credentials and provider network access; native Claude adapter; generated media; voice/audio/captions; uploads; automatic semantic, contrast, rendered-text, and motion QC; distributed rendering; authentication; public deployment. Square encoding has not been run (square scene schemas pass). Full 60-second encoding has not been run (60-second scene/schema arithmetic passes). Cancellation and worker-crash recovery have implementations but have not been separately exercised by the automated suite. See README for the remaining roadmap.

## Development checkpoint — 28 October 2026 (0.3.0)

- Unit/layout/asset suite: **13 passed**, none skipped. Includes real Chromium clipping detection/repair, immutable unrelated scenes, custom-keyframe validation/interpolation, native Claude request contracts, and verified PNG ingestion/local-only resolution.
- Development browser suite: **5 passed**, covering actual MP4 download, mobile layout, scene-local revision/non-destructive restore, image upload/layer edit/custom-keyframe export, and cancellation/evidence access rejection.
- Production build, lint, type checking, formatting, and dependency audit passed; audit reports **0 vulnerabilities**.
- Native Claude, uploads, rendered-text measurement, local font repair, export history, evidence gallery and motion-clip playback are now implemented. Encoded square output is exercised by the image-export browser test, with codec/resolution/timing validated by the worker.
- The final production browser run also checks a known uploaded image's pixel color in a rendered scene and reopens the completed export from history after refresh. Results are recorded after completion below.

Still unverified: real provider calls, automated semantic/artistic motion review, audio/voice/captions, public/multi-user deployment, and restoration of new local commits in a fresh cloud task. Static text diagnostics share composition styles but are not frames from the animation; the separate scene PNGs/clips are actual rendered evidence. Keyframe event sampling is capped at eight events per scene and is not exhaustive temporal review. No paid provider is configured in this environment.

Final production browser suite: **5 passed**, none skipped, in 1.4 minutes. It verified the uploaded PNG's expected color in an actual rendered scene, eleven screenshots including custom-keyframe events, and reopening the completed export after a full page refresh. Cancellation remained terminal. No required local check remains failing.

## Restored environment — 28 October 2026 (0.5.0)

The workspace reconnected after an execution-transport outage. Source files, local commits, project data, uploads and render artifacts were present. The recovered feature checkpoint is commit `058d586`. This confirms recovery of this existing instance, not restoration in a separate new task or publication of a new snapshot.

- **25 unit/layout/media/archive/queue/process/cache tests passed**, none skipped. These exercise real audio encoding and timed silence/signal regions, subprocess cancellation/timeouts, immutable queue snapshots, capped retry/restart recovery, clip checksums, and localized layout repair.
- **8 production browser tests passed**, none skipped, in 5.3 minutes. They cover actual MP4 download; reuse of exactly the two unchanged scene clips after revising the opening; mobile layout; scene-local revisions and version restore; uploaded image pixels, keyframes and export history; cancellation; AAC/caption output and subtitle download; portable project download/import; and scene-only preview with character, arrow and camera rendering.
- **Production build, type checking, lint, formatting and dependency audit passed.** Audit found zero vulnerabilities. Two dynamic-filesystem trace warnings were resolved using the compiler-supported runtime-path annotation; the final production rebuild completed without those warnings. The annotation changes build tracing, not runtime path resolution.
- The production studio and single render worker were restarted/checked after recovery. The browser suite's in-flight processes survived a transient transport reconnection and completed; no test was counted as passed merely from a PID or open port.

Live AI verification remains deliberately deferred at the user's request. Provider contract tests use mocked APIs only. Generated voices/media, automatic semantic/artistic motion evaluation, distributed workers, public/multi-user deployment and a fresh-task restore remain outside these verified results. Technical contrast/caption-speed/audio-level warnings are heuristics, not perceptual approval.

## Public-account foundation — 28 October 2026 (0.6.0)

The release audience is confirmed as a public multi-user product. Commit `fa2969d` adds the first account/resource-isolation boundary; it does not complete the production release plan.

- **28 unit/layout/media/mail/archive/queue/process/cache tests passed**, none skipped. Added checks cover immutable workspace ownership, private durable mail delivery/retry and refusal of file delivery in production.
- **10 isolated development browser tests passed**, none skipped, in 7.5 minutes. New account checks exercised verified registration, unverified sign-in denial, real sign-in/sign-out UI, password reset, previous-session revocation, cross-origin write rejection, and cross-account project/job/asset/evidence/download read/write rejection. All eight existing editor/render workflows passed using verified accounts, including actual MP4/AAC output, captions, uploaded images, clip reuse and portable project import/export.
- The browser services used a fresh temporary studio/auth database, private file mailbox, artifact/cache directories and separate Next output; real saved projects were not reset to make tests pass. Authentication rate limits and CSRF checks remained enabled. An early test fixture lacked Origin/cookie sharing; it was corrected rather than weakening server protections. An accessible password-field label was fixed after a browser failure.
- Production build, type checking, lint, formatting and dependency audit passed. Audit reported zero vulnerabilities. Authentication schema migration was run successfully and is idempotent. A pre-tenant-migration project database backup was created before the real studio schema change; existing unassigned projects remain preserved and inaccessible to arbitrary new accounts.
- Restored local development smoke checks returned 401 for anonymous project access and 200 for the sign-in page. The real-data render worker was restarted with workspace-scoped cache handling.

Not yet verified: real SMTP delivery, HTTPS/cookie behavior on a deployed staging domain, PostgreSQL/object storage, public load/abuse resilience, privacy/deletion lifecycle, team membership or live AI. Production intentionally refuses missing auth secrets, non-HTTPS auth URLs and development file mail. Do not treat a passing production build or development-mode account tests as a completed public deployment.

### Strengthened private-file checks and test isolation

A follow-up exercised real private media: the owner fetched a valid uploaded PNG and completed job JSON/MP4/thumbnail/report/scene PNG/motion clip successfully; another verified account received 404 for each. The strengthened account, password-reset and completed-export cases all passed (three targeted tests, 2.8 minutes).

That follow-up exposed two Next development servers repeatedly regenerating shared files. The isolated runner now uses a temporary source/dependency mirror with its own generated files, fresh test signing secret and forced mock AI, without copying `.env.local` or using real AI/SMTP credentials. Dependency copies are removed after service shutdown. UI tests explicitly wait for the composer bootstrap before asserting the private project list.

Final unit count is **29 passed**, including idempotent auth initialization and owner-only authentication database/signing-file permissions. The final production rebuild, lint and type checks passed after that hardening. The earlier full ten-case development suite and these strengthened targeted checks are separate runs; they are not HTTPS/SMTP production-staging verification.

## Manual editor checkpoint — 28 October 2026 (0.7.0)

- **34 unit/layout/media/mail/archive/queue/process/cache/editor tests passed**, none skipped. New coverage checks blank-project durations/formats, bounded branching undo/redo, invalid edits, canvas clamps/snapping/locked geometry, hidden-layer visual QC, and transactional stale-revision rejection while retaining concurrent asset metadata.
- Three targeted browser reliability cases passed: blank/manual creation through autosave/reopen, editing during an in-flight save without losing newer changes, and a stale tab receiving a conflict while keeping its draft and the newer server version.
- The visual motion-authoring browser case passed: layer/camera keyframes are added and edited without JSON, reset/undo/remove work, and the advanced view reflects visual changes and rejects out-of-range frames.
- The canvas browser case passed in 1.6 minutes: real pointer drag/resize, one-gesture undo/redo, lock enforcement, keyboard nudging, hide/show state, layer stacking, frame scrubbing/zoom, mobile no-overflow and an actual downloadable five-second H.264 1280×720/30fps export. Its report preserves hidden-layer state; the shared preview/export excludes hidden artwork.
- Production build, type checking, lint, formatting and dependency audit passed at this checkpoint; audit reported zero vulnerabilities. A further full-suite regression run is recorded below after completion.

Browser iteration found and fixed a real React reconciliation bug: canvas and numeric layer panels initially shared a sibling key, causing duplicated panels after undo. The regression now asserts one arrangement canvas. Test fixes also name the save-status region separately from time outputs, scroll pointer targets into view, honor real auth Retry-After responses instead of disabling rate limits, and allow development-route compilation time in UI polling. The first full attempt failed; the second was interrupted after identifying the duplicated-panel bug. Those runs are not counted as passing coverage. Targeted passes above are separate runs.

The arrangement canvas renders shared artwork with animation/camera/fades held at base geometry; Live preview and actual export provide motion. Undo is bounded in-memory history, not reload-persistent. Unsaved edits have unload/navigation protection but no durable offline cache. JSON draft downloads are recovery/inspection files rather than portable ZIP imports. Direct track trimming, scene splitting, footage ingestion, recording, five-minute/1080p support and production service hardening remain unfinished. Live AI verification remains deliberately deferred.

### Full regression result

The final full isolated development browser run passed **all 15 tests**, none skipped, in **9.8 minutes**. It exercised verified account/resource isolation and reset, all new manual editing/save/conflict/motion cases, original storyboard/revision restore, two real exports proving reuse of the two unchanged scene clips, uploaded PNG pixels in an encoded square video, terminal cancellation, AAC mixing/captions/subtitles, editable ZIP round trip, and scene-only camera/character/arrow export. The app's sixty-second cap remains unchanged; these short-video tests are not a long-video/performance benchmark.

The production rebuild at 0.7.0 passed with the main development server stopped; the isolated test server had its own source/dependency mirror and Next output. Formatting/lint/type checks passed and npm audit reported zero vulnerabilities. The real-data development server and worker were then restarted; anonymous project access returned 401 and the sign-in page returned 200. No production SMTP service or live AI call was started.

Desktop/mobile canvas evidence was reviewed and copied to `artifacts/validation-0.7/canvas-editor-desktop.png` and `artifacts/validation-0.7/canvas-editor-mobile.png`. Review caught and corrected the playhead range inheriting an overly narrow generic input style; the full run includes that correction. A screenshot could also temporarily change caret styles before React hydrated; the screenshot fixture now waits for the enabled composer before capture. This test-only readiness follow-up is separate from the 15-case run above.

The screenshot-readiness follow-up passed the isolated mobile-composer browser case (one targeted test, 11.8 seconds), with no hydration mismatch in its service log. The full 15-case run and this targeted follow-up are separate executions. Final working changes are committed locally; no remote push or public deployment is implied.

## Footage and editable-track checkpoint — 29 October 2026 (0.8.0)

The workspace reconnected with the uncommitted 0.8 source changes intact; earlier temporary test logs were absent. The work was inspected, tested again and committed as `0dd8444`. This confirms recovery of these working files; it is not evidence of a separate fresh-task restore or a public deployment.

- **43 unit/layout/media/mail/archive/queue/process/cache/editor tests passed**, none skipped. Added coverage exercises MP4/AAC and silent portrait VP9 WebM normalization, duration/byte limits, real footage archive re-encoding/remapping, private loopback delivery/ranges/allowlists/shutdown, cache keys stable across temporary ports/tokens, source trims, caption bounds, motion-phase limits and frame-by-frame custom/preset/camera continuity across splits. Keyframe slicing stays within 30 keys.
- **Two targeted isolated development browser tests passed**, none skipped, in 1.2 minutes. Footage is uploaded, added behind artwork, trimmed and split through UI controls, moved/resized with keyboard/pointer, undone/redone, saved/reloaded, rendered and downloaded. The encoded MP4 contains the expected blue source picture at 1.5 seconds and green at 2.5 seconds; decoded audio is silent before/after the chosen range and audible during it. The owner receives valid private range responses, an invalid range gets 416, and another verified customer gets 404. The second case checks direct audio/caption movement/trim, source offsets, caption non-overlap, undo and reload.
- Production build, type checking and lint passed after recovery. Broader browser regression, final formatting and audit results are recorded below when complete.

Earlier iterations are not passing evidence: embedded footage in a Remotion proxy data-URL query failed with HTTP 431; render-time delivery now uses an allowlisted temporary server bound to 127.0.0.1, with a fresh capability token and file-byte cache hashes. Browser test corrections use `report.qc.audio` and match the download link including its arrow. A partially applied audio-sequence key change was corrected during recovery; the current build and targeted export pass with that correction. No product warning was suppressed to obtain a pass.

The tests use actual Chromium/FFmpeg and fresh isolated accounts/storage; auth rate limits and CSRF remain enabled. Five-second fixture exports establish the exercised picture/timing paths, not broad codec compatibility, artistic/perceptual approval, long-video throughput or production isolation. Inputs remain capped at 25 MB/120 seconds; current project duration/output-size caps are unchanged. Waveforms, recording, ripple edits, richer crop/typography/caption tools, managed storage, quotas/retention, operations and final live-AI verification remain open release work.

### Completed regression and final timing correction

The full isolated development suite passed **all 17 cases**, none skipped, in **9.6 minutes**. It covers the existing account/access/reset, canvas, save/conflict/history, graphics/image/audio/caption/export/cache/archive workflows plus the new footage and direct-track cases.

A subsequent adversarial timing fixture exposed a genuine preview/export discrepancy: a video with an audio stream starting half a second after its picture lost that leading silence when export trimmed and reset its audio timestamps. The regression failed before the correction. The mixer now pads/trims from source timestamp zero before applying the clip's source trim, retaining that silence. **All 44 unit tests now pass**, including decoded PCM checks for leading silence, the delayed tone and trailing silence.

After that correction, **two focused browser export regressions passed**, none skipped, in **2.1 minutes**: uploaded footage and standalone audio/captions. The footage case additionally verifies a 390-pixel mobile viewport has no horizontal overflow and that a second export reuses both scene clips despite fresh private loopback ports/tokens. This follow-up and the full 17-case run are separate executions; the full run preceded the final mixer correction.

The final 0.8 production rebuild, type checking, lint and formatting passed; npm audit reported zero vulnerabilities. The main development server was stopped for its build and the real-data render worker was restarted gracefully with the final source. The restored app returned 401 for anonymous project access and 200 for sign-in. No saved jobs were active during restart. Desktop/mobile footage screenshots are retained under `artifacts/validation-0.8/` as ignored local evidence.

Live AI, production SMTP/HTTPS, public deployment, long-video benchmarks and creator acceptance remain outside these passing checks. No remote push or public deployment was performed.

## Narration, captions and studio reliability — 29 October 2026 (0.9.0)

- **56 unit tests passed**, none skipped: subtitle round trips, timing/overlap/byte/cue limits, style-dependent cache keys, Chromium caption clipping across output geometries, bounded WAV encoding and worklet flushing/limits, actual FFmpeg audio ingestion/waveforms, workspace-scoped project pagination/literal searches, metadata conflicts, and real worker heartbeat/readiness/shutdown cleanup, alongside previous media/render/account regressions.
- Targeted isolated development-browser runs passed for subtitle import/undo/reload/archive/styled MP4 pixels, audio/caption timing bars, project pagination/search/rename conflicts, synthetic microphone capture/review/download/failed-upload recovery/private waveforms/AAC export, and denied microphone permission. Desktop/mobile project access and public health probes have additional verification below.
- A production Next.js build passed after the new availability endpoints and worker heartbeat were added. CI configuration has not executed on GitHub. Final full-suite/static check evidence is recorded separately below when complete.
- All recording tests use synthetic Chromium microphone input; no real device, Safari/iOS recording or human voice quality has been verified. Waveforms describe source amplitude with clip gain, not output loudness/perceptual sync. Caption checks establish geometry and actual exported style placement, not semantic/artistic quality.
- No live AI/provider/SMTP calls, public deployment, five-minute/1080p benchmarks or real creator acceptance sessions were performed. SQLite/filesystem/single-worker operational limits still apply.

Final focused mobile/library/health run: **2 passed** in 27.9 seconds (`/tmp/reelchemy-09-library-health.log`, isolated evidence `/tmp/reelchemy-e2e-O098GL`). It includes 22 persisted projects, pagination to older work, literal `%_` search, rename CAS, preserved undo, cross-account metadata rejection, mobile reopening, no horizontal overflow and mobile sign-out. The public health endpoint returned only the expected readiness booleans. The separate synthetic microphone/permission run passed both recording cases in approximately two minutes (`/tmp/reelchemy-09-recorder-mobile.log`); its accompanying library test exposed a hidden duplicate search-input selector, corrected before this final library run.

The **full 0.9.0 isolated development browser suite passed all 22 tests**, none skipped, in 13.8 minutes (`/tmp/reelchemy-09-full.log`, evidence `/tmp/reelchemy-e2e-fWuLAK`). It includes all prior account/editor/footage/export regressions plus caption tools, project management/mobile sign-out, health probes and synthetic microphone workflows. This is development-server browser coverage; it is not a hosted production/staging acceptance run. Dependency audit reported **zero vulnerabilities**.

## Backup/restore checkpoint — 29 October 2026 (0.9.1)

- The expanded unit suite passed **59 tests**, none skipped, including three backup/restore/security cases. A real Better Auth account/session, private project, normalized image and FFmpeg MP4 survive backup/restore; old sessions return 401, fresh password sign-in and authorized project access succeed in a fresh process, pending jobs become failed, and source state stays unchanged. Corruption, traversal, extra files, symlinks, nested/aliased source destinations and overwrite attempts are rejected.
- Created and independently verified a private snapshot at `/workspace/Reelchemy-backups/2026-10-29-v0.9`: **558 files, 146,108,046 bytes**. Restored into `/workspace/Reelchemy-restore-drill/2026-10-29-v0.9`, separate from the real installation. No source data was overwritten; copied auth sessions/tokens were revoked only in the restored copy.
- The full 22-browser run above preceded backup tooling; backup is covered by its dedicated real-database/account/media integration drill. It does not exercise off-host backup, encrypted storage, production deployment, RPO/RTO or automatic retention.

The separate restored installation matched **48 projects and 31 jobs**, including 25 completed exports. All **25 retained MP4s passed a full FFmpeg decode** from the restored directories. This is local recovery evidence, not a remote-host failover or creator-quality review.

## Typography and split-motion regression — 29 October 2026 (0.10.0)

- **62 unit tests passed**, none skipped (`/tmp/reelchemy-010-unit.log`), including typography bounds/default scaling/history/portable preservation and actual Chromium horizontal glyph clipping, with all preceding backup/account/media regressions.
- **Three focused isolated browser tests passed** in 2.9 minutes (`/tmp/reelchemy-010-type-phase.log`, evidence `/tmp/reelchemy-e2e-bNfh5Q`): existing canvas gestures/locks/stack/export; orbital graphics retaining both coordinates after a split; and text styles surviving autosave/locks/reset/undo/reload and an actual MP4 export. The orbital test first failed against the old implementation with different horizontal positions, then passed after the renderer correction.
- **One mobile typography test passed** in 23.1 seconds (`/tmp/reelchemy-010-mobile.log`, evidence `/tmp/reelchemy-e2e-BVV1Uz`), including no horizontal overflow at 390 pixels. Its canvas screenshot was visually inspected.
- The production build passed (`/tmp/reelchemy-010-build.log`). The full 22-browser run recorded above precedes typography; the targeted runs exercise the changed canvas/render paths. Subsequent removal of redundant text/size fields in the secondary layer inspector is presentation-only and covered by static checks.
- Live AI and real SMTP remain unrun. No public deployment, five-minute/1080p support claim, real microphone/device acceptance or overall creator-quality acceptance is implied.

## Recoverable project Trash — 29 October 2026 (0.11.0)

- **64 unit tests passed**, none skipped, with bounded test concurrency (`/tmp/reelchemy-trash-unit-sequential.log`, 20.2 seconds). Includes terminal export cancellation, independent Trash state surviving late saves, full saved-state restoration and a three-process legacy migration retaining original data.
- The first overlapping build/browser/unbounded-unit run had one worker-startup readiness failure and one browser startup timeout; it is not counted as a clean pass. Limiting unit concurrency to two and rerunning without overlapping heavy checks resolved resource starvation without relaxing worker heartbeat freshness or browser assertions. Final browser evidence follows below.
- Production build passed (`/tmp/reelchemy-trash-build.log`), including the authenticated Trash page and private Trash mutation/restore endpoint.
- No permanent data erasure, storage reclamation or retention automation is claimed. Existing backups preserve trashed records/media as part of the private snapshot.

Final focused browser run: **6 passed**, none skipped, in 2.1 minutes (`/tmp/reelchemy-trash-final.log`, evidence `/tmp/reelchemy-e2e-weBNVs`). It covers editor autosave/undo/in-flight saves/stale tabs, library pagination/rename/mobile sign-out, Trash confirmation cancellation/acceptance, private route hiding and cross-account restore rejection, restored media/revisions, mobile Trash layout, failure/reload recovery and anonymous redirects. The real studio and render worker were restarted; anonymous projects returned 401, sign-in 200 and readiness 200 with all checks true. Formatting, lint and type checking passed.

## Persistent public request windows — 29 October 2026 (0.12.0)

- **67 unit tests passed**, none skipped, in 22 seconds (`/tmp/reelchemy-limits-unit.log`). New cases cover policy validation/fail-closed HTTP behavior, workspace/operation isolation, expiry, persisted counters in a fresh process and three-process atomic admission. Existing worker readiness also rejects invalid limit configuration.
- **Four focused isolated browser/API cases passed**, none skipped, in 53.9 seconds (`/tmp/reelchemy-limits-browser.log`, evidence `/tmp/reelchemy-e2e-9cjWyX`): availability probes, actual default write-budget exhaustion with Retry-After/private reads/independent accounts, and both Trash security/recovery workflows under the new guard.
- Live AI/provider usage and SMTP were not invoked. Request limits count attempts; this result does not establish monetary budgets, storage limits, public load capacity, decoder isolation or a public deployment.

Production build passed with the development server confirmed stopped (`/tmp/reelchemy-limits-build-clean.log`); lint, type checking and formatting passed. The ordinary dev process was explicitly stopped before that final build after the earlier shutdown detector missed it.

## Media framing and encoded-frame checks — 29 October 2026 (0.13.0)

- **69 unit tests passed**, none skipped (`/tmp/reelchemy-framing-unit.log`, 21 seconds), including constrained/default media styles, split/portable preservation and scene-local cache invalidation.
- **Five isolated browser cases passed** in 3.7 minutes (`/tmp/reelchemy-framing-encoded.log`, evidence `/tmp/reelchemy-e2e-37nhZs`): image framing, video framing, caption styling, typography/underline and mobile text controls. Framing gestures preview without saving, cancel with Escape, commit one undo step, respect locks and survive reload.
- Image/video tests decode the actual downloaded MP4 and measure known blue pixels in the selected source region. Caption tests count yellow pixels in the top area of the encoded MP4, and typography checks detect its wide encoded underline. Earlier evidence PNGs are independently rendered Remotion stills, rather than decoded MP4 frames; these stronger checks now cover actual encoded/cache output.
- An initial crop assertion failed because Sharp stats inspected the original full input rather than the preceding extract operation. The rendered framing itself was correct. The replacement directly decodes the MP4; the existing audio/caption region check also materializes its crop before collecting stats.
- Production build passed (`/tmp/reelchemy-framing-build.log`), with `/trash` correctly dynamic after moving the request-header read before auth initialization. Lint/type checking passed. No paid provider, SMTP delivery, public staging or full production service acceptance is implied.

## Container and worker lifecycle checks — 30 October 2026 (0.14.0)

- **71 unit tests passed**, none skipped (`/tmp/reelchemy-container-unit.log`, 28.2 seconds). New Linux subprocess tests forcibly kill the actual worker, reject a concurrent worker, recover with a new matching heartbeat/instance ID and retain the private coordination inode. A live legacy PID is not stolen.
- The rewritten development runner passed its focused health browser test (`/tmp/reelchemy-dev-runner-014.log`, evidence `/tmp/reelchemy-e2e-0Wkch8`). Real user state and environment files were not copied into the test app.
- A production container build passed (`/tmp/reelchemy-container-build-retry.log`), including the dynamic-page assertion. The initial build ran out of Docker storage; removing only this task's unused build/image cache recovered space. The host's VFS driver copies whole layers; no user projects, assets, exports or backups were removed.
- The first fresh production run failed readiness because the auth migration was missing. After adding the explicit migration and copying the revised runner into that disposable test container, **five production HTTPS cases passed** (`/tmp/reelchemy-prod-smoke-014-fixed.log`, evidence `/tmp/reelchemy-prod-smoke-014-fixed-evidence`): account isolation, unverified-login rejection, password-reset/session revocation, health and both Trash workflows. This was a focused corrected-container run; the final rebuilt image/full suite is recorded separately when executed.
- The local worker was gracefully upgraded only after verifying every existing export was terminal (25 completed, six cancelled). The new lifecycle entrypoint reached readiness without changing saved projects/exports. Compose configuration validates with synthetic settings; service boot under its restrictions and hosted CI are not established by that validation.

## Owned-media planning and atomic commits — 30 October 2026 (0.15.0)

- **84 unit tests passed**, none skipped (`/tmp/reelchemy-planning-unit.log`, 32.4 seconds). The new planning group uses a real isolated Better Auth account/session and actual guarded route handlers; all provider responses are intercepted in-process with synthetic credentials, without network calls.
- Cases validate a project-only media catalog and accepted owned video/audio, reject foreign image IDs, video/audio overruns, unavailable source audio and output-format changes without partial revisions/messages, preserve manual fractional-frame duration/portrait format and the immutable original brief, and preserve unrelated scenes/narration/captions through a targeted revision.
- Race checks reject a stale provider response after a concurrent edit (409), validate changed media metadata again before saving, and reject late saves after moving to Trash during both provider work and streamed editor request input (404). Active ownership, revision and media validation now share the same write transaction.
- Production build/dynamic-page check passed (`/tmp/reelchemy-planning-build.log`); lint and type checking passed. The separate full production-container browser run uses the immutable 0.14.0 checkpoint; it does not by itself validate these later provider changes. No live AI capability or artistic quality is claimed by mocked contract checks.

### Full production HTTPS run of the 0.14.0 checkpoint

The final test image was rebuilt from an immutable archive of commit `70e6f38` (`/tmp/reelchemy-container-014-rebuild.log`, image SHA-256 `fd1090976d0d98f3acac29100fad8c5f7b463e003595a4515cdc1d67952fba78`). **All 30 browser cases passed**, none skipped, in 15.0 minutes (`/tmp/reelchemy-prod-full-014.log`, copied evidence `/tmp/reelchemy-prod-full-014-evidence`). Unlike the earlier corrected-container smoke run, this image includes the migration step directly from the committed source.

The network-disabled container used the built production server, real certificate validation, production secure cookies, fresh migrated synthetic accounts, unchanged request/auth limits, demo AI and private queued mail. It exercised complete manual creation/editing/export, actual MP4 crop/text/caption pixels, footage/source-audio ranges, portable projects, autosave/concurrent saves/undo, cancellation, private scope, Trash, mobile controls and synthetic microphone narration/retry/waveforms. No SMTP worker or paid provider ran. Synthetic microphone success does not establish real-device/browser support. Hosted CI, the restricted Compose service boot, later source changes and public staging are separate validation gates.

## SQLite writer contention — 30 October 2026 (0.15.1)

The first restricted Compose test (`/tmp/reelchemy-runtime-014.log`, diagnostic `/tmp/reelchemy-runtime-TdnIar/services.log`) passed fresh authentication migration, private routes/readiness, unprivileged/read-only root filesystems and render-network/secret isolation. Its first real footage/audio export failed with `database is locked` while another process checked progress. The disposable services/volumes were removed; user storage was not involved. This run is a failure, not a passing restart test.

A new three-process regression reproduced SQLITE_BUSY before the fix (`/tmp/reelchemy-database-contention-red.log`, one failed test). SQLite deferred transactions could read an old WAL snapshot and then fail to upgrade to a writer; the busy timeout cannot make that stale snapshot writable. Read/modify/write helpers now acquire an immediate write transaction first, including outer queue/stage/Trash transactions. Established-workspace lookups retain a read-only fast path.

The contention case now completes all **4,500 writes**, preserving terminal rules and the final stage. Focused queue/planning/concurrency/browser-lifecycle tests passed **19 cases** (`/tmp/reelchemy-contention-browser-green.log`, 3.7 seconds). The browser-lifecycle helper in that run is part of the following render work; the database fix does not claim a passing new production image or restricted-service restart yet.

## Render browser ownership and module separation — 30 October 2026 (0.16.0)

- The final corrected-source full unit suite passed **86 tests**, none skipped (`/tmp/reelchemy-016-final-unit.log`, 29.9 seconds), including real Chromium connection closure after successful, failing and cancelled operations. The earlier expanded run also passed 86 (`/tmp/reelchemy-render-lifecycle-unit.log`); after separating the pure modules, 28 focused core/planning/contention/browser-lifecycle cases passed (`/tmp/reelchemy-render-boundary-unit.log`).
- The first focused export run caught a regression introduced by the 0.15.0 provider change: Remotion's demo entrypoint imported the provider, which imported Sharp/server dependencies, causing a `child_process` browser-bundle resolution failure. That run failed one case and was interrupted during the next; it is not counted as a pass (`/tmp/reelchemy-render-lifecycle-browser.log`, evidence `/tmp/reelchemy-e2e-wSa416`).
- The fix separates pure demo planning and asset-reference validation and removes provider code from the composition import graph. The new independent bundle guard passed (`/tmp/reelchemy-render-bundle-boundary.log`) and now runs in `npm run build` alongside the Next/dynamic-page checks.
- **Eight focused isolated browser cases passed** on corrected source in 5.8 minutes (`/tmp/reelchemy-render-lifecycle-browser-fixed.log`, evidence `/tmp/reelchemy-e2e-a8LFK1`): caption/encoded styling, stale-save conflict, footage pictures/audio/source cuts and scene reuse, image/video encoded crop pixels, active-frame cancellation followed by a successful new export, targeted scene revisions, and character/arrow/camera export.
- The new service check exercises the actual app image, not only the test image. It uses unique ephemeral volumes, no mail worker/provider calls, read-only application files, bounded resources and a forced crash while a second job is rendering; recovery must finish exactly one automatic retry and preserve the first completed MP4. A passing rebuilt-image/service run will be recorded separately; the earlier 0.14.0 database-lock failure is not converted into a pass by these source tests.
