import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
test("build trace guard refuses media, separate auth and environment files without reading their contents", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-private-trace-"));
  const output = path.join(dir, "build"),
    auth = path.join(dir, "account-store");
  await mkdir(output);
  await mkdir(auth);
  const canary = "synthetic-canary-never-output";
  await writeFile(path.join(auth, "auth.sqlite"), canary);
  const run = (authPath = auth) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/check-private-traces.ts"],
      {
        env: {
          ...process.env,
          REELCHEMY_NEXT_DIST_DIR: output,
          REELCHEMY_AUTH_DIR: authPath,
        },
        encoding: "utf8",
      },
    );
  const trace = (file: string) =>
    writeFile(
      path.join(output, "server.nft.json"),
      JSON.stringify({ version: 1, files: [path.relative(output, file)] }),
    );
  try {
    await trace(path.resolve("package.json"));
    assert.equal(run().status, 0);
    for (const file of [
      path.resolve(".data/assets/example"),
      path.join(auth, "auth.sqlite"),
      path.resolve(".env.private-canary"),
    ]) {
      await trace(file);
      const result = run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Runtime data or environment files/);
      assert(!result.stderr.includes(canary));
      assert(!result.stdout.includes(canary));
    }
    const alias = path.join(dir, "linked-accounts");
    await symlink(auth, alias);
    await trace(path.join(auth, "auth.sqlite"));
    assert.notEqual(
      run(alias).status,
      0,
      "canonical auth storage cannot escape through an alias",
    );
    await trace(path.join(alias, "auth.sqlite"));
    assert.notEqual(
      run().status,
      0,
      "a traced symlink alias into private storage is also refused",
    );
    const fileAlias = path.join(dir, "innocent-looking.json");
    await symlink(path.join(auth, "auth.sqlite"), fileAlias);
    await trace(fileAlias);
    assert.notEqual(
      run().status,
      0,
      "a file alias cannot import private account contents",
    );
    await trace(path.resolve("package.json"));
    await writeFile(
      path.join(output, "required-server-files.json"),
      JSON.stringify({ files: [path.join(auth, "auth.sqlite")] }),
    );
    assert.notEqual(
      run().status,
      0,
      "the required-files manifest is checked as well as NFT traces",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
