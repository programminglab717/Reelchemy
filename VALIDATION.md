# Validation — 27 October 2026

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

## Not validated / not implemented

Real paid-model credentials and provider network access; native Claude adapter; generated media; voice/audio/captions; uploads; automatic semantic, contrast, rendered-text, and motion QC; distributed rendering; authentication; public deployment. Square encoding has not been run (square scene schemas pass). Full 60-second encoding has not been run (60-second scene/schema arithmetic passes). Cancellation and worker-crash recovery have implementations but have not been separately exercised by the automated suite. See README for the remaining roadmap.
