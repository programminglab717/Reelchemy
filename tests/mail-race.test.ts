import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { mailOutboxStatus } from "../src/lib/mail-outbox";
for (const variant of [
  { name: "count", count: 3, text: 100, accepted: 3 },
  { name: "UTF-8 envelope bytes", count: 1000, text: 32000, accepted: 2 },
])
  test(
    `independent mail writers cannot overbook shared ${variant.name}`,
    { timeout: 20000 },
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "reelchemy-mail-race-")),
        children: ChildProcess[] = [],
        saved = process.env.REELCHEMY_AUTH_DIR;
      try {
        const workers = Array.from({ length: 6 }, (_, index) => {
          const child = spawn(
            process.execPath,
            ["--import", "tsx", "tests/helpers/mail-race-writer.ts"],
            {
              env: {
                ...process.env,
                REELCHEMY_AUTH_DIR: root,
                REELCHEMY_MAIL_PENDING_COUNT: String(variant.count),
                REELCHEMY_MAIL_PENDING_BYTES: "65536",
                MAIL_TEST_WRITER: `maker-${index}`,
                MAIL_TEST_TEXT_BYTES: String(variant.text),
              },
              stdio: ["pipe", "pipe", "pipe"],
            },
          );
          children.push(child);
          let output = "",
            errors = "",
            release!: () => void;
          const ready = new Promise<void>((resolve, reject) => {
            release = resolve;
            child.once("error", reject);
            child.once("close", () => {
              if (!output.includes("ready"))
                reject(new Error("Synthetic mail writer exited before ready."));
            });
          });
          child.stdout.on("data", (data) => {
            output += data.toString();
            if (output.includes("ready\n")) release();
          });
          child.stderr.on("data", (data) => {
            errors += data.toString().slice(0, 500);
          });
          const completed = new Promise<string>((resolve, reject) => {
            child.once("close", (code) =>
              code === 0
                ? resolve(
                    output
                      .split("\n")
                      .filter((line) => line !== "ready" && line)
                      .join(""),
                  )
                : reject(new Error(errors || "Synthetic mail writer failed.")),
            );
          });
          return { child, ready, completed };
        });
        await Promise.all(workers.map((worker) => worker.ready));
        for (const worker of workers) worker.child.stdin!.end("start\n");
        const outcomes = await Promise.all(
          workers.map((worker) => worker.completed),
        );
        assert.equal(
          outcomes.filter((value) => value === "admitted").length,
          variant.accepted,
        );
        assert.equal(
          outcomes.filter((value) => value === "capacity").length,
          6 - variant.accepted,
        );
        process.env.REELCHEMY_AUTH_DIR = root;
        const status = mailOutboxStatus();
        assert.equal(status.pending, variant.accepted);
        assert(status.bytes <= 65536);
      } finally {
        for (const child of children)
          if (child.exitCode === null && !child.signalCode)
            child.kill("SIGKILL");
        if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
        else process.env.REELCHEMY_AUTH_DIR = saved;
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
