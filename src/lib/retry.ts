import { RenderQCError } from "./layout-qc";
import { CommandCancelledError, CommandTimeoutError } from "./process";
import { RenderBrowserCleanupError } from "./render-browser-process";
export function transientRenderError(error: unknown) {
  if (
    error instanceof RenderQCError ||
    error instanceof CommandCancelledError ||
    error instanceof RenderBrowserCleanupError
  )
    return false;
  return (
    error instanceof CommandTimeoutError ||
    (error instanceof Error &&
      (/Target closed|browser.*(?:crash|closed)|ECONNRESET|page crashed/i.test(
        error.message,
      ) ||
        /^Timed out after [1-9]\d{0,5} ms while trying to connect to the browser! Chrome logged the following:/.test(
          error.message,
        )))
  );
}
