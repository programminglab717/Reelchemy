import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withRenderBrowser,
  type RenderBrowser,
} from "../src/lib/render-browser";

test(
  "a job's real Chromium connection is released after success, failure and cancellation",
  { timeout: 30000 },
  async () => {
    for (const outcome of ["success", "failure", "cancelled"] as const) {
      let owned: RenderBrowser | undefined;
      let closed!: Promise<void>;
      const error = new Error(
        outcome === "cancelled"
          ? "Render cancelled."
          : "Synthetic render failure",
      );
      const task = withRenderBrowser(
        process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        async (browser) => {
          owned = browser;
          // The vendor's reduced CDP types omit this standard command. Check
          // its actual response before inspecting the effective user agent.
          const getVersion = browser.connection.send.bind(
            browser.connection,
          ) as (method: "Browser.getVersion") => Promise<{ value: unknown }>;
          const version = await getVersion("Browser.getVersion");
          assert(
            version.value &&
              typeof version.value === "object" &&
              "userAgent" in version.value &&
              typeof version.value.userAgent === "string",
          );
          assert(!version.value.userAgent.includes("ReelchemyRenderAttempt"));
          closed = new Promise<void>((resolve) =>
            browser.connection.transport.websocket.addEventListener(
              "close",
              () => resolve(),
            ),
          );
          const target = await browser.connection.send("Target.createTarget", {
            url: "about:blank",
          });
          assert(target.value.targetId);
          if (outcome !== "success") throw error;
          return "completed";
        },
      );
      if (outcome === "success") assert.equal(await task, "completed");
      else await assert.rejects(task, (caught) => caught === error);
      assert(owned);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error("Render browser connection leaked after the job."),
                ),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        await owned.close({ silent: true });
      }
    }
  },
);
