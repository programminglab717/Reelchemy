import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  readFile,
  writeFile,
  rename,
  symlink,
  lstat,
  readdir,
  rm,
  unlink,
  rmdir,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  prepareRenderBrowser,
  RenderBrowserCleanupError,
} from "../src/lib/render-browser-process";
function anchor(userAgent: string | undefined) {
  assert(
    typeof userAgent === "string" &&
      userAgent.startsWith("ReelchemyRenderAttempt/"),
  );
  return userAgent.slice("ReelchemyRenderAttempt/".length);
}
test("launch configuration is private data and unused attempts close their pinned descriptor without executing temporary code", async () => {
  const launch = await prepareRenderBrowser("/usr/bin/chromium"),
    directory = anchor(launch.userAgent),
    root = await realpath(directory);
  assert.equal((await lstat(root)).mode & 0o777, 0o700);
  assert.equal(
    (await lstat(path.join(directory, "config"))).mode & 0o777,
    0o600,
  );
  assert(launch.executable.endsWith("/scripts/render-browser-launcher.sh"));
  assert(
    !launch.executable.startsWith(`${tmpdir()}/reelchemy-render-browser-`),
  );
  await launch.close();
  await launch.close();
  assert.equal(
    await lstat(root).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(
    await realpath(directory).then(
      () => true,
      () => false,
    ),
    false,
  );
  await assert.rejects(
    prepareRenderBrowser("/invalid\nexecutable"),
    RenderBrowserCleanupError,
  );
});
test("registered native profiles reclaim only the captured inode and never follow an external link or replaced root", async () => {
  const fixture = await mkdtemp(
      path.join(tmpdir(), "reelchemy-browser-profile-canary-"),
    ),
    outside = path.join(fixture, "preserve");
  await writeFile(outside, "PRESERVE_NATIVE_PROFILE_EXTERNAL");
  try {
    for (const replace of [false, true]) {
      const launch = await prepareRenderBrowser("/usr/bin/chromium"),
        directory = anchor(launch.userAgent),
        root = await realpath(directory);
      const profile = await mkdtemp(
          path.join(tmpdir(), "puppeteer_dev_chrome_profile-"),
        ),
        held = `${profile}-held`,
        metadata = await stat(profile, { bigint: true });
      try {
        await writeFile(
          path.join(profile, "owned-cache"),
          "Owned temporary browser cache",
        );
        await symlink(outside, path.join(profile, "outside-pointer"));
        await writeFile(
          path.join(directory, "profile"),
          `${profile}\n${metadata.dev}:${metadata.ino}\n`,
        );
        if (replace) {
          await rename(profile, held);
          await mkdir(profile);
          await writeFile(
            path.join(profile, "keep"),
            "Preserve replacement data",
          );
          await assert.rejects(launch.close(), RenderBrowserCleanupError);
          assert.equal(
            await readFile(path.join(profile, "keep"), "utf8"),
            "Preserve replacement data",
          );
          assert.equal(
            await readFile(path.join(held, "owned-cache"), "utf8"),
            "Owned temporary browser cache",
          );
        } else {
          await launch.close();
          assert.equal(
            await lstat(profile).then(
              () => true,
              () => false,
            ),
            false,
          );
        }
        assert.equal(
          await readFile(outside, "utf8"),
          "PRESERVE_NATIVE_PROFILE_EXTERNAL",
        );
      } finally {
        await rm(profile, { recursive: true, force: true });
        await rm(held, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
test("unknown configuration entries or substituted links refuse cleanup without changing an external canary", async () => {
  const fixture = await mkdtemp(
      path.join(tmpdir(), "reelchemy-browser-canary-"),
    ),
    canary = path.join(fixture, "preserve");
  await writeFile(canary, "PRESERVE_EXTERNAL_BROWSER_CANARY");
  try {
    for (const mode of ["unknown", "link"] as const) {
      const launch = await prepareRenderBrowser("/usr/bin/chromium"),
        directory = anchor(launch.userAgent),
        root = await realpath(directory);
      try {
        if (mode === "unknown")
          await writeFile(
            path.join(directory, "unknown"),
            "Keep this unexpected file",
          );
        else {
          await unlink(path.join(directory, "config"));
          await symlink(canary, path.join(directory, "config"));
        }
        const before = (await readdir(directory)).sort();
        await assert.rejects(launch.close(), RenderBrowserCleanupError);
        assert.deepEqual((await readdir(root)).sort(), before);
        assert.equal(
          await readFile(canary, "utf8"),
          "PRESERVE_EXTERNAL_BROWSER_CANARY",
        );
        assert.equal(
          await realpath(directory).then(
            () => true,
            () => false,
          ),
          false,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
test("a replaced configuration directory cannot redirect reads or remove another tree", async () => {
  const fixture = await mkdtemp(
      path.join(tmpdir(), "reelchemy-browser-parent-"),
    ),
    canary = path.join(fixture, "config");
  await writeFile(canary, "PRESERVE_REPLACEMENT_DIRECTORY");
  const launch = await prepareRenderBrowser("/usr/bin/chromium"),
    directory = anchor(launch.userAgent),
    root = await realpath(directory),
    held = `${root}-held`;
  try {
    await rename(root, held);
    await symlink(fixture, root);
    await launch.close();
    assert.equal(
      await readFile(canary, "utf8"),
      "PRESERVE_REPLACEMENT_DIRECTORY",
    );
    assert((await lstat(root)).isSymbolicLink());
    assert.deepEqual(await readdir(held), []);
  } finally {
    await unlink(root);
    await rmdir(held);
    await rm(fixture, { recursive: true });
  }
});
test("the immutable launcher caps renderer processes and strips its private control argument before executing the browser", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "reelchemy-launcher-args-")),
    record = path.join(work, "argv"),
    fake = path.join(work, "fake-browser.sh");
  await writeFile(
    fake,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > ${JSON.stringify(record)}\n`,
    { mode: 0o700 },
  );
  const launch = await prepareRenderBrowser(fake);
  const profile = await mkdtemp(
    path.join(tmpdir(), "puppeteer_dev_chrome_profile-"),
  );
  try {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      launch.executable,
      [
        `--user-agent="${launch.userAgent}"`,
        `--user-data-dir=${profile}`,
        "--disable-features=Translate,site-per-process",
        "--headless",
        "about:blank",
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    const argv = (await readFile(record, "utf8")).trim().split("\n");
    assert.equal(argv[0], "--renderer-process-limit=4");
    assert.equal(
      argv[1],
      `--crash-dumps-dir=${path.join(await realpath(tmpdir()), "reelchemy-chromium-crashes")}`,
    );
    // The renderer's feature list is kept and extended, not replaced.
    assert.equal(
      argv[2],
      "--disable-features=Translate,site-per-process,IsolateSandboxedIframes",
    );
    assert.deepEqual(argv.slice(3), [
      `--user-data-dir=${profile}`,
      "--headless",
      "about:blank",
    ]);
    assert(!argv.some((value) => value.includes("ReelchemyRenderAttempt")));
  } finally {
    await launch.close();
    await rm(profile, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  }
});
