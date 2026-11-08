import { defineConfig } from "@playwright/test";
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
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      // CI has no GPU: WebGL (3D code scenes) through the software renderer.
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
});
