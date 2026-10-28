import { RenderQCError } from "./layout-qc";
import { CommandCancelledError, CommandTimeoutError } from "./process";
export function transientRenderError(error: unknown) {
  if (error instanceof RenderQCError || error instanceof CommandCancelledError)
    return false;
  return (
    error instanceof CommandTimeoutError ||
    (error instanceof Error &&
      /Target closed|browser.*(?:crash|closed)|ECONNRESET|page crashed/i.test(
        error.message,
      ))
  );
}
