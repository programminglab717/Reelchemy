import { openBrowser } from "@remotion/renderer";
import { prepareRenderBrowser } from "./render-browser-process";
export type RenderBrowser = Awaited<ReturnType<typeof openBrowser>>;

// One isolated browser per job; share it across composition selection, scene
// renders and evidence stills, then release it on success, error or cancellation.
export async function withRenderBrowser<T>(
  executable: string,
  operation: (browser: RenderBrowser) => Promise<T>,
): Promise<T> {
  const launch = await prepareRenderBrowser(executable);
  let browser: RenderBrowser | undefined;
  try {
    browser = await openBrowser("chrome", {
      browserExecutable: launch.executable,
      // Chromium's default graphics backend: changing it alters how 2D
      // frames are composited. The launcher only permits the software WebGL
      // fallback that 3D code scenes need on GPU-less servers.
      ...(launch.userAgent
        ? { chromiumOptions: { userAgent: launch.userAgent } }
        : {}),
    });
    return await operation(browser);
  } finally {
    try {
      await browser?.close({ silent: true });
    } finally {
      await launch.close();
    }
  }
}
