import { openBrowser } from "@remotion/renderer";
export type RenderBrowser = Awaited<ReturnType<typeof openBrowser>>;

// One isolated browser per job; share it across composition selection, scene
// renders and evidence stills, then release it on success, error or cancellation.
export async function withRenderBrowser<T>(
  executable: string,
  operation: (browser: RenderBrowser) => Promise<T>,
): Promise<T> {
  const browser = await openBrowser("chrome", {
    browserExecutable: executable,
  });
  try {
    return await operation(browser);
  } finally {
    await browser.close({ silent: true });
  }
}
