import { MAX_TIMELINE_FRAMES } from "./timeline-limits";

const MIN_OVERRIDE_MS = 60000;
const MIN_DEFAULT_MS = 600000;
const MAX_ATTEMPT_MS = 900000;
export class RenderAttemptPolicyUnavailable extends Error {
  constructor() {
    super(
      "Render attempt settings unavailable. Leave RENDER_JOB_TIMEOUT_MS empty for automatic budgets, or use a positive integer; explicit budgets are clamped to 1–15 minutes.",
    );
  }
}
// Capture operator configuration once at startup. Defaults allow three times
// running time for long films, bounded by the existing 10–15 minute window.
// Heartbeats, native startup/command limits, output metering and retries are
// separate policies and are not relaxed by this time budget.
export function renderAttemptPolicy(
  configured = process.env.RENDER_JOB_TIMEOUT_MS,
) {
  let override: number | undefined;
  const value = configured?.trim();
  if (value) {
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) <= 0
    )
      throw new RenderAttemptPolicyUnavailable();
    override = Math.max(
      MIN_OVERRIDE_MS,
      Math.min(MAX_ATTEMPT_MS, Number(value)),
    );
  }
  return (frames: number) => {
    if (
      !Number.isSafeInteger(frames) ||
      frames <= 0 ||
      frames > MAX_TIMELINE_FRAMES
    )
      throw new RenderAttemptPolicyUnavailable();
    return (
      override ??
      Math.max(MIN_DEFAULT_MS, Math.min(MAX_ATTEMPT_MS, frames * 100))
    );
  };
}
