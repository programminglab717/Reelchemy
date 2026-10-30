import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import assert from "node:assert/strict";

// Native Node 24 script: no host dependency installation or real credentials.
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--image"))
  throw new Error(
    "Usage: node scripts/check-runtime.ts [--image reelchemy:local]",
  );
const image = args[1] || "reelchemy:local";
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
  REELCHEMY_MEDIA_REQUESTS_PER_HOUR: "30",
  REELCHEMY_PLANS_PER_DAY: "60",
  REELCHEMY_EXPORT_REQUESTS_PER_DAY: "30",
  REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: "2",
  REELCHEMY_MEDIA_STORAGE_BYTES: "536870912",
};
const override = path.join(directory, "compose.check.json");
await writeFile(
  override,
  JSON.stringify({
    services: Object.fromEntries(
      ["migrate", "web", "render"].map((service) => [
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
let render = "",
  web = "";
async function execute(
  operation: string,
  extra: Record<string, string> = {},
  service = render,
) {
  const variables = Object.entries({
    RUNTIME_CHECK_OPERATION: operation,
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
      if (["failed", "cancelled"].includes(job.status))
        throw new Error(job.error || "Runtime export failed.");
      return job.status === "completed";
    },
    "Runtime export exceeded the acceptance deadline.",
    240000,
  );
  assert.equal(
    (await execute("decode", { RUNTIME_CHECK_JOB_ID: jobId })).decoded,
    true,
  );
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
  // Finish/remove the one-shot before creating the two application containers:
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
  ]);
  web = (await run([...compose, "ps", "-q", "web"])).output.trim();
  render = (await run([...compose, "ps", "-q", "render"])).output.trim();
  assert(web && render);
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
  for (const id of [web, render]) {
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
    if (id === render) {
      assert.equal(config.NetworkMode, "none");
      const env: string[] = JSON.parse(
        (await run(["inspect", "--format", "{{json .Config.Env}}", id])).output,
      );
      assert(
        !env.some((value) =>
          /^(BETTER_AUTH_SECRET|AI_API_KEY|SMTP_PASSWORD)=/.test(value),
        ),
      );
      const mounts = JSON.parse(
        (await run(["inspect", "--format", "{{json .Mounts}}", render])).output,
      ) as { Destination: string; Name?: string }[];
      assert(
        !mounts.some(
          (m) =>
            m.Destination === "/app/private-auth" ||
            m.Name === privateMount.Name,
        ),
      );
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
  assert.equal(
    (await execute("auth-owner", {}, web)).privateAccountStorage,
    true,
  );
  assert.equal(
    (await execute("auth-isolation")).authenticationFilesystemIsolated,
    true,
  );
  console.log(
    "Migrations, private routes, health, render credential/filesystem isolation and read-only restrictions passed.",
  );
  const seed = await execute("seed");
  await completed(seed.jobId);
  console.log(
    "Network-isolated worker encoded and fully decoded real footage, captions and AAC audio.",
  );
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
        checks: [
          "fresh-auth-migration",
          "readiness",
          "anonymous-401",
          "non-root-readonly",
          "render-network-none",
          "render-environment-credential-separation",
          "render-authentication-filesystem-isolation",
          "real-footage-captions-aac",
          "full-decode",
          "duplicate-worker-rejected",
          "forced-container-crash-recovery",
          "retained-export",
          "second-export",
        ],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Runtime check evidence: ${directory}`);
} catch (error) {
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
