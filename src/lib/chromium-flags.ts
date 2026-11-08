import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Chromium's crash handler needs a writable report directory. In read-only
// containers it can otherwise start without one and abort the browser
// ("chrome_crashpad_handler: --database is required"). Point it at private
// temporary storage, which the services mount writable.
export function chromiumCrashArgs() {
  const directory = path.join(tmpdir(), "reelchemy-chromium-crashes");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return [`--crash-dumps-dir=${directory}`];
}

// Keeps sandboxed code-scene documents in the page's renderer process so a
// screenshot taken after the scene reports a painted frame includes it.
export const SAME_PROCESS_SANDBOXED_FRAMES = [
  "--disable-features=IsolateSandboxedIframes",
];

// WebGL for 3D code scenes on GPU-less machines: permit Chromium's software
// (SwiftShader) fallback, which recent versions only use when asked. The
// graphics backend itself is left at its default.
export const SOFTWARE_WEBGL = ["--enable-unsafe-swiftshader"];
