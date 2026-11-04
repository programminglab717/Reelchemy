import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";

// Native Node 24 script: no host dependency installation or real credentials.
const args = process.argv.slice(2);
let image = "reelchemy:local",
  benchmark: "square-minute" | "static-minute" | undefined,
  selectedImage = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--image" && args[i + 1] && !selectedImage) {
    image = args[++i];
    selectedImage = true;
  } else if (args[i] === "--benchmark-square-minute" && !benchmark)
    benchmark = "square-minute";
  else if (args[i] === "--benchmark-static-minute" && !benchmark)
    benchmark = "static-minute";
  else
    throw new Error(
      "Usage: node scripts/check-runtime.ts [--image reelchemy:local] [--benchmark-square-minute | --benchmark-static-minute]",
    );
}
if (!/^[a-z0-9][a-z0-9._:/-]{0,180}$/.test(image))
  throw new Error("Invalid test image.");
const directory = await mkdtemp(path.join(tmpdir(), "reelchemy-runtime-"));
const project = `reelchemy-check-${randomBytes(6).toString("hex")}`;
const listener = net.createServer();
await new Promise<void>((resolve, reject) => {
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", resolve);
});
const address = listener.address();
if (!address || typeof address === "string")
  throw new Error("No test port available.");
const port = address.port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const environment = {
  ...process.env,
  COMPOSE_PROFILES: "",
  BETTER_AUTH_URL: `https://127.0.0.1:${port}`,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  SMTP_HOST: "127.0.0.1",
  EMAIL_FROM: "runtime@example.test",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  AI_PROVIDER: "mock",
  AI_API_KEY: "",
  AI_BASE_URL: "",
  AI_MODEL: "",
  REELCHEMY_HTTP_PORT: String(port),
  RENDER_CONCURRENCY: "2",
  REELCHEMY_WRITES_PER_MINUTE: "120",
  REELCHEMY_MAIL_PENDING_COUNT: "1000",
  REELCHEMY_MAIL_PENDING_BYTES: "16777216",
  REELCHEMY_MEDIA_REQUESTS_PER_HOUR: "30",
  REELCHEMY_PLANS_PER_DAY: "60",
  REELCHEMY_EXPORT_REQUESTS_PER_DAY: "30",
  REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: "2",
  REELCHEMY_MEDIA_STORAGE_BYTES: "536870912",
  REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: "8589934592",
  REELCHEMY_PROJECT_DATA_BYTES: "33554432",
  REELCHEMY_STUDIO_DATA_BYTES: "268435456",
  REELCHEMY_SERVICE_DATA_BYTES: "4294967296",
  REELCHEMY_STUDIO_PROJECTS: "500",
  REELCHEMY_SERVICE_PROJECTS: "20000",
  REELCHEMY_PROJECT_VERSIONS: "10000",
  REELCHEMY_PROJECT_MESSAGES: "10000",
};
const override = path.join(directory, "compose.check.json");
await writeFile(
  override,
  JSON.stringify({
    services: Object.fromEntries(
      ["migrate", "web", "render", "ingest"].map((service) => [
        service,
        {
          image,
          environment: {
            NODE_ENV: "production",
            REELCHEMY_CONTAINER_TESTS: "0",
          },
          ...(service === "web" ? { command: ["npm", "run", "start"] } : {}),
        },
      ]),
    ),
  }),
  { mode: 0o600 },
);
const compose = [
  "compose",
  "-p",
  project,
  "-f",
  path.resolve("compose.yaml"),
  "-f",
  override,
];
let interrupted = false,
  active: ChildProcess | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    interrupted = true;
    active?.kill("SIGTERM");
  });
async function run(arguments_: string[], allowFailure = false) {
  if (interrupted && !allowFailure)
    throw new Error("Runtime check interrupted.");
  const child = spawn("docker", arguments_, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  active = child;
  const timeout = setTimeout(() => child.kill("SIGTERM"), 600000);
  timeout.unref();
  let output = "",
    errors = "";
  child.stdout.on("data", (data) => {
    output = (output + data.toString()).slice(-2_000_000);
  });
  child.stderr.on("data", (data) => {
    errors = (errors + data.toString()).slice(-2_000_000);
  });
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timeout);
    active = undefined;
  }
  if (code !== 0 && !allowFailure)
    throw new Error(errors || output || "Runtime check command failed.");
  return { code, output, errors };
}
const fixture = await readFile("scripts/runtime-fixture.mjs", "utf8");
let ingest = "",
  render = "",
  web = "";
async function execute(
  operation: string,
  extra: Record<string, string> = {},
  service = render,
) {
  const variables = Object.entries({
    RUNTIME_CHECK_OPERATION: operation,
    ...(benchmark ? { RUNTIME_CHECK_BENCHMARK: benchmark } : {}),
    ...extra,
  }).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
  // Eval imports are relative to /app; fixture file imports are relative to scripts/.
  const source = fixture.replaceAll('"../src/', '"./src/');
  return JSON.parse(
    (
      await run([
        "exec",
        ...variables,
        service,
        "node",
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        source,
      ])
    ).output,
  );
}
async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  milliseconds = 90000,
) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Runtime check interrupted.");
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(message);
}
async function completed(jobId: string) {
  await waitFor(
    async () => {
      const job = await execute("job", { RUNTIME_CHECK_JOB_ID: jobId });
      if (benchmark) await sampleRender();
      if (["failed", "cancelled"].includes(job.status))
        throw new Error(job.error || "Runtime export failed.");
      return job.status === "completed";
    },
    "Runtime export exceeded the acceptance deadline.",
    benchmark ? 630000 : 240000,
  );
  const verification = await execute("decode", { RUNTIME_CHECK_JOB_ID: jobId });
  assert.equal(verification.decoded, true);
  return verification;
}
const samples: {
  at: string;
  memoryBytes: number;
  pids: number;
  cpuPercent: number;
}[] = [];
let sampledAt = 0;
function memoryBytes(value: string) {
  const match = value.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)\b/);
  if (!match) throw new Error("Cannot read render memory usage.");
  return Math.round(
    Number(match[1]) *
      1024 ** ["B", "KiB", "MiB", "GiB", "TiB"].indexOf(match[2]),
  );
}
async function sampleRender() {
  if (Date.now() - sampledAt < 5000) return;
  const stats = JSON.parse(
    (await run(["stats", "--no-stream", "--format", "{{json .}}", render]))
      .output,
  );
  const memory = memoryBytes(stats.MemUsage),
    pids = Number(stats.PIDs),
    cpu = Number(stats.CPUPerc.replace("%", ""));
  if (![memory, pids, cpu].every(Number.isFinite))
    throw new Error("Invalid render resource sample.");
  samples.push({
    at: new Date().toISOString(),
    memoryBytes: memory,
    pids,
    cpuPercent: cpu,
  });
  sampledAt = Date.now();
}
const began = Date.now();
let probe: unknown = { status: "not-probed" };
try {
  console.log(
    "Starting disposable read-only production services; no mail worker or live AI.",
  );
  await run([
    ...compose,
    "run",
    "--rm",
    "--no-deps",
    "--pull",
    "never",
    "migrate",
  ]);
  // Finish/remove the one-shot before creating the application containers:
  // VFS stores a full filesystem copy even for an exited migration service.
  await run([
    ...compose,
    "up",
    "-d",
    "--no-build",
    "--no-deps",
    "--pull",
    "never",
    "web",
    "render",
    "ingest",
  ]);
  web = (await run([...compose, "ps", "-q", "web"])).output.trim();
  render = (await run([...compose, "ps", "-q", "render"])).output.trim();
  ingest = (await run([...compose, "ps", "-q", "ingest"])).output.trim();
  assert(web && render && ingest);
  const authMounts = JSON.parse(
    (await run(["inspect", "--format", "{{json .Mounts}}", web])).output,
  ) as { Destination: string; Name?: string }[];
  const privateMount = authMounts.find(
    (m) => m.Destination === "/app/private-auth",
  );
  assert(
    privateMount?.Name,
    "Web must have a distinct private authentication volume.",
  );
  for (const id of [web, render, ingest]) {
    const config = JSON.parse(
      (await run(["inspect", "--format", "{{json .HostConfig}}", id])).output,
    );
    assert.equal(config.ReadonlyRootfs, true);
    assert(config.CapDrop.includes("ALL"));
    assert.equal(
      (
        await run(["inspect", "--format", "{{.Config.User}}", id])
      ).output.trim(),
      "node",
    );
    if (id !== web) {
      assert.equal(config.NetworkMode, "none");
      if (benchmark) {
        assert.equal(config.NanoCpus, 2_000_000_000);
        assert.equal(config.Memory, (id === ingest ? 2 : 4) * 1024 ** 3);
        assert.equal(config.PidsLimit, 256);
      }
      const env: string[] = JSON.parse(
        (await run(["inspect", "--format", "{{json .Config.Env}}", id])).output,
      );
      assert(
        !env.some((value) =>
          /^(BETTER_AUTH_SECRET|AI_API_KEY|SMTP_PASSWORD)=/.test(value),
        ),
      );
      const mounts = JSON.parse(
        (await run(["inspect", "--format", "{{json .Mounts}}", id])).output,
      ) as { Destination: string; Name?: string }[];
      assert(
        !mounts.some(
          (m) =>
            m.Destination === "/app/private-auth" ||
            m.Name === privateMount.Name,
        ),
      );
      if (id === ingest) {
        assert.equal(config.NanoCpus, 2_000_000_000);
        assert.equal(config.Memory, 2 * 1024 ** 3);
        assert.equal(config.PidsLimit, 256);
        assert(!mounts.some((mount) => mount.Destination === "/app/artifacts"));
        assert(
          !env.some((value) =>
            /^(REELCHEMY_AUTH_DIR|REELCHEMY_ARTIFACT_DIR|SMTP_HOST|SMTP_USER|EMAIL_FROM)=/.test(
              value,
            ),
          ),
        );
      }
    }
  }
  await waitFor(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      probe = { httpStatus: response.status, ...(await response.json()) };
      return response.status === 200;
    } catch (error) {
      probe = {
        status: "unreachable",
        code:
          (error as { cause?: { code?: string } }).cause?.code ||
          "REQUEST_FAILED",
      };
      return false;
    }
  }, "Read-only production services did not reach readiness.");
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/api/projects`)).status,
    401,
  );
  assert.equal((await execute("readonly", {}, web)).readonly, true);
  assert.equal((await execute("readonly")).readonly, true);
  assert.equal((await execute("readonly", {}, ingest)).readonly, true);
  assert.equal(
    (await execute("auth-owner", {}, web)).privateAccountStorage,
    true,
  );
  assert.equal(
    (await execute("auth-isolation")).authenticationFilesystemIsolated,
    true,
  );
  assert.equal(
    (await execute("auth-isolation", {}, ingest))
      .authenticationFilesystemIsolated,
    true,
  );
  assert.equal(
    (await execute("artifact-isolation", {}, ingest))
      .artifactFilesystemIsolated,
    true,
  );
  if (!benchmark) {
    const duplicate = await run(
      ["exec", web, "npm", "run", "ingest:worker"],
      true,
    );
    assert.notEqual(duplicate.code, 0);
    assert.match(duplicate.output + duplicate.errors, /Another media worker/);
  }
  console.log(
    "Migrations, private routes, health, render/ingestion credential/filesystem isolation and read-only restrictions passed.",
  );
  const seed = await execute("seed");
  const firstExport = await completed(seed.jobId);
  const coldJobWallSeconds = (Date.now() - Date.parse(seed.createdAt)) / 1000;
  console.log(
    `Network-isolated worker encoded and fully decoded ${benchmark === "static-minute" ? "static title cards" : "real footage"}, captions and AAC audio.`,
  );
  if (!benchmark) {
    const before = await execute("heartbeat");
    const restartsBefore = Number(
      (
        await run(["inspect", "--format", "{{.RestartCount}}", render])
      ).output.trim(),
    );
    // A different existing container provides another PID namespace without a
    // third image filesystem copy or a transient full disk on VFS hosts.
    const duplicate = await run(["exec", web, "npm", "run", "worker"], true);
    assert.notEqual(duplicate.code, 0);
    assert.match(duplicate.output + duplicate.errors, /Another render worker/);
    const retry = await execute("retry", {
      RUNTIME_CHECK_PROJECT_ID: seed.projectId,
    });
    await waitFor(async () => {
      const job = await execute("job", { RUNTIME_CHECK_JOB_ID: retry.jobId });
      if (["completed", "failed", "cancelled"].includes(job.status))
        throw new Error(
          job.error || "The recovery fixture ended before the forced crash.",
        );
      return job.status === "rendering";
    }, "The recovery fixture did not enter rendering.");
    // Docker's kill API marks an operator stop and suppresses restart policies.
    // Kill the managed worker inside its PID namespace to simulate an unexpected
    // crash; the entrypoint/container exits and Docker must restart it itself.
    await run(
      [
        "exec",
        render,
        "node",
        "-e",
        "const fs=require('fs'),path=require('path');const lock=JSON.parse(fs.readFileSync(path.join(process.env.REELCHEMY_DATA_DIR,'worker.lock'),'utf8'));if(lock.kind!=='reelchemy-worker-lock-v2'||!Number.isInteger(lock.pid)||lock.pid<2)process.exit(2);process.kill(lock.pid,'SIGKILL');",
      ],
      true,
    );
    await waitFor(async () => {
      try {
        const after = await execute("heartbeat");
        return (
          after.instanceId !== before.instanceId &&
          Date.now() - Date.parse(after.at) < 30000
        );
      } catch {
        return false;
      }
    }, "Worker did not recover a forced container crash.");
    const restartsAfter = Number(
      (
        await run(["inspect", "--format", "{{.RestartCount}}", render])
      ).output.trim(),
    );
    assert.equal(restartsAfter, restartsBefore + 1);
    await completed(seed.jobId); // Original completed export remains decodable.
    await completed(retry.jobId);
    assert.equal(
      (await execute("job", { RUNTIME_CHECK_JOB_ID: retry.jobId })).retryCount,
      1,
    );
    console.log(
      "Duplicate worker rejected; forced in-flight container-crash recovery and another export passed.",
    );
    const cleanup = await execute(
      "delete-request",
      { RUNTIME_CHECK_PROJECT_ID: seed.projectId },
      web,
    );
    await waitFor(async () => {
      const status = await execute("delete-status", {
        RUNTIME_CHECK_PROJECT_ID: seed.projectId,
      });
      if (status.state === "failed")
        throw new Error(status.error || "Runtime project cleanup failed.");
      return status.state === "completed";
    }, "Network-isolated worker did not finish permanent project cleanup.");
    const removal = await execute("delete-verify", {
      RUNTIME_CHECK_PROJECT_ID: seed.projectId,
      RUNTIME_CHECK_KEEP_PROJECT_ID: cleanup.keepProjectId,
      RUNTIME_CHECK_SHARED_ASSET_ID: cleanup.sharedAssetId,
      RUNTIME_CHECK_SHARED_HASH: cleanup.sharedHash,
      RUNTIME_CHECK_EXCLUSIVE_ASSET_ID: cleanup.exclusiveAssetId,
      RUNTIME_CHECK_REMOVED_JOBS: JSON.stringify(cleanup.removedJobs),
    });
    assert.equal(removal.projectCleanup, true);
    assert.equal(removal.sharedMediaPreserved, true);
    assert.equal(removal.quotaReclaimed, true);
    await completed(cleanup.keepJobId);
    assert.equal(
      (await execute("auth-isolation")).authenticationFilesystemIsolated,
      true,
    );
    console.log(
      "Permanent cleanup removed private media/exports, reclaimed quota, preserved shared footage and completed a later export with account storage still isolated.",
    );
  } else {
    await run([
      "cp",
      `${render}:/app/artifacts/${seed.jobId}`,
      path.join(directory, "export"),
    ]);
    assert.equal(
      (
        await run(["inspect", "--format", "{{.State.OOMKilled}}", render])
      ).output.trim(),
      "false",
    );
    assert.equal(
      Number(
        (
          await run(["inspect", "--format", "{{.RestartCount}}", render])
        ).output.trim(),
      ),
      0,
      "A capacity benchmark must not hide a worker restart.",
    );
    assert.equal(
      Number(
        (await execute("job", { RUNTIME_CHECK_JOB_ID: seed.jobId }))
          .retryCount || 0,
      ),
      0,
      "The cold benchmark must complete without an export retry.",
    );
    console.log(
      `Cold-cache ${benchmark === "static-minute" ? "static title-card" : "mixed-media"} square minute completed under the standard 2 CPU / 4 GiB / 256 PID render budget.`,
    );
  }
  const imageId = (
    await run(["image", "inspect", "--format", "{{.Id}}", image])
  ).output.trim();
  await writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(
      {
        passed: true,
        image,
        imageId,
        at: new Date().toISOString(),
        wallSeconds: (Date.now() - began) / 1000,
        ...(benchmark
          ? {
              benchmark: {
                case:
                  benchmark === "static-minute"
                    ? "cold-square-static-minute"
                    : "cold-square-mixed-media-minute",
                coldJobWallSeconds,
                timingIncludes:
                  "queueing, export, polling and full-decode verification; excludes fixture ingestion and service startup",
                renderBudget: {
                  cpus: 2,
                  memoryBytes: 4 * 1024 ** 3,
                  pids: 256,
                },
                samplingIntervalMs: 5000,
                samplingScope:
                  "Queue/export polling before job completion; subsequent full-decode verification is outside these samples.",
                memoryMetric:
                  "Docker stats MemUsage, which may exclude inactive file cache. Sampled peaks can miss spikes; the container memory/PID/CPU budgets remain enforced independently.",
                sampledPeakMemoryBytes: Math.max(
                  0,
                  ...samples.map((s) => s.memoryBytes),
                ),
                sampledPeakPids: Math.max(0, ...samples.map((s) => s.pids)),
                samples,
                export: firstExport,
                scope: `one synthetic cold-cache 60-second 1080x1080 ${benchmark === "static-minute" ? "static title-card" : "moving-footage mixed-media"} export, not 1080p landscape/portrait, five-minute capacity, concurrent throughput or artistic acceptance`,
              },
            }
          : {}),
        checks: [
          "fresh-auth-migration",
          "readiness",
          "anonymous-401",
          "non-root-readonly",
          "render-network-none",
          "render-environment-credential-separation",
          "render-authentication-filesystem-isolation",
          "ingestion-network-none",
          "ingestion-environment-credential-separation",
          "ingestion-authentication-and-artifact-filesystem-isolation",
          "standard-ingestion-resource-budget",
          "real-footage-and-waveform-through-ingestion-worker",
          benchmark === "static-minute"
            ? "static-cards-captions-aac"
            : "real-footage-captions-aac",
          "full-decode",
          ...(benchmark
            ? [
                benchmark === "static-minute"
                  ? "cold-static-square-minute"
                  : "cold-mixed-square-minute",
                "standard-render-resource-budget",
              ]
            : [
                "duplicate-worker-rejected",
                "duplicate-ingestion-worker-rejected",
                "forced-container-crash-recovery",
                "retained-export",
                "second-export",
                "permanent-project-cleanup",
                "shared-media-preserved",
                "exclusive-media-quota-reclaimed",
                "post-cleanup-export",
              ]),
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Runtime check evidence: ${directory}`);
} catch (error) {
  if (benchmark)
    await writeFile(
      path.join(directory, "benchmark-failure.json"),
      JSON.stringify(
        {
          passed: false,
          case:
            benchmark === "static-minute"
              ? "cold-square-static-minute"
              : "cold-square-mixed-media-minute",
          samples,
          error:
            error instanceof Error
              ? error.message.slice(0, 2000)
              : "Benchmark failed",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  await writeFile(
    path.join(directory, "readiness.json"),
    JSON.stringify(probe, null, 2),
    { mode: 0o600 },
  );
  if (web) {
    const internal = await run(
      [
        "exec",
        web,
        "node",
        "-e",
        "fetch('http://127.0.0.1:3000/api/health').then(async r=>console.log(JSON.stringify({httpStatus:r.status,...await r.json()}))).catch(()=>process.exit(1))",
      ],
      true,
    );
    await writeFile(
      path.join(directory, "internal-readiness.json"),
      internal.output,
      { mode: 0o600 },
    );
  }
  const logs = await run(
    [...compose, "logs", "--no-color", "--tail", "50"],
    true,
  );
  await writeFile(
    path.join(directory, "services.log"),
    logs.output + logs.errors,
    { mode: 0o600 },
  );
  console.error(`Isolated runtime failure evidence: ${directory}`);
  throw error;
} finally {
  const cleanup = await run(
    [...compose, "down", "--volumes", "--remove-orphans"],
    true,
  );
  await rm(override, { force: true });
  if (cleanup.code !== 0)
    throw new Error(`Could not remove disposable services for ${project}.`);
}
