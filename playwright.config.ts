import { defineConfig } from "@playwright/test";
// E2E_VIEWPORT=1440x900 runs the suite at another default window size (the
// editor's inspector layout starts at 1360 px wide; the default is 1280).
const size = /^(\d{3,4})x(\d{3,4})$/.exec(process.env.E2E_VIEWPORT ?? "");
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 240000,
  // Isolated development routes compile on first use on a CPU-limited host.
  // Poll UI state; this is functional coverage, not a production latency test.
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001",
    headless: true,
    ...(size
      ? { viewport: { width: Number(size[1]), height: Number(size[2]) } }
      : {}),
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      // CI has no GPU: WebGL (3D code scenes) through the software renderer.
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    },
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
});
