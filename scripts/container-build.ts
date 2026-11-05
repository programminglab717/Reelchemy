import { spawn } from "node:child_process";
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const flags = process.argv.slice(2);
let target = "test",
  tag = "reelchemy:verification";
for (let i = 0; i < flags.length; i++) {
  if (flags[i] === "--target" && flags[i + 1]) target = flags[++i];
  else if (flags[i] === "--tag" && flags[i + 1]) tag = flags[++i];
  else
    throw new Error(
      "Usage: npm run container:build -- [--target app|test|backup] [--tag image-name]",
    );
}
if (
  !["app", "test", "backup"].includes(target) ||
  !/^[a-z0-9][a-z0-9._:/-]{0,180}$/.test(tag)
)
  throw new Error("Invalid container build target/tag.");
await access("Dockerfile");
const builder =
  process.env.BUILDX_CONFIG || path.join(tmpdir(), "reelchemy-buildx");
await mkdir(builder, { recursive: true, mode: 0o700 });
const args = ["build", "--target", target, "--tag", tag];
if (process.env.NODE_EXTRA_CA_CERTS) {
  const certificate = await readFile(process.env.NODE_EXTRA_CA_CERTS, "utf8");
  if (
    certificate.length > 1024 * 1024 ||
    !certificate.includes("-----BEGIN CERTIFICATE-----") ||
    /-----BEGIN [^-]*PRIVATE KEY-----/.test(certificate)
  )
    throw new Error(
      "The optional build CA must contain public certificates only.",
    );
  args.push(
    "--secret",
    `id=build_ca,src=${path.resolve(process.env.NODE_EXTRA_CA_CERTS)}`,
  );
}
args.push(".");
const child = spawn("docker", args, {
  stdio: "inherit",
  env: { ...process.env, BUILDX_CONFIG: builder },
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
