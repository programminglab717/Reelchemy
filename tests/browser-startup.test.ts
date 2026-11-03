import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  lstat,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withRenderBrowser } from "../src/lib/render-browser";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function running(pid: number) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return !["Z", "X"].includes(
      stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0],
    );
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code || "")
    )
      return false;
    throw error;
  }
}
test(
  "a real browser-start timeout releases its unconnected native process and leaves unrelated children alive",
  { timeout: 40000 },
  async () => {
    const root = await mkdtemp(
        path.join(tmpdir(), "reelchemy-browser-startup-"),
      ),
      pidFile = path.join(root, "pid"),
      profileFile = path.join(root, "profile"),
      executable = path.join(root, "stall-browser"),
      token = randomUUID();
    await writeFile(
      executable,
      [
        "#!/bin/sh",
        `export REELCHEMY_STARTUP_TEST_MARKER=${quote(token)}`,
        `printf '%s' "$$" > ${quote(pidFile)}`,
        "for argument do",
        'case "$argument" in',
        "--user-data-dir=*)",
        "profile=${argument#--user-data-dir=}",
        `printf '%s' "$profile" > ${quote(profileFile)}`,
        `printf '%s' ${quote(token)} > "$profile/.reelchemy-startup-test"`,
        ";;",
        "esac",
        "done",
        "exec sleep 120",
        "",
      ].join("\n"),
      { mode: 0o700, flag: "wx" },
    );
    const unrelated = spawnTestProcess(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      { env: process.env, stdio: "ignore" },
    );
    try {
      await assert.rejects(
        withRenderBrowser(executable, async () => {
          throw new Error("A stalled browser cannot run a composition.");
        }),
        (error) =>
          error instanceof Error &&
          /^Timed out after 25000 ms while trying to connect to the browser!/.test(
            error.message,
          ),
      );
      const pid = Number(await readFile(pidFile, "utf8"));
      assert(Number.isSafeInteger(pid) && pid > 1);
      for (let i = 0; i < 20 && (await running(pid)); i++)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(
        await running(pid),
        false,
        "Unconnected native browser survived its failed startup.",
      );
      assert.equal(unrelated.exitCode, null);
      assert.equal(await running(unrelated.pid!), true);
    } finally {
      const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      if (pid > 1 && (await running(pid))) {
        const environment = await readFile(
          `/proc/${pid}/environ`,
          "utf8",
        ).catch(() => "");
        if (
          environment
            .split("\0")
            .includes(`REELCHEMY_STARTUP_TEST_MARKER=${token}`)
        ) {
          process.kill(pid, "SIGKILL");
          for (let i = 0; i < 40 && (await running(pid)); i++)
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      await shutdownTestProcesses([unrelated]);
      const profile = await readFile(profileFile, "utf8").catch(() => "");
      if (
        profile &&
        /^puppeteer_dev_chrome_profile-[a-zA-Z0-9]+$/.test(
          path.basename(profile),
        )
      ) {
        const info = await lstat(profile).catch(() => undefined);
        if (
          info?.isDirectory() &&
          !info.isSymbolicLink() &&
          path.dirname(await realpath(profile)) ===
            (await realpath(tmpdir())) &&
          (await readFile(
            path.join(profile, ".reelchemy-startup-test"),
            "utf8",
          )) === token
        )
          await rm(profile, { recursive: true });
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);
