import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../../scripts/test-process";
export async function startMediaWorker(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const env: NodeJS.ProcessEnv = {
    ...environment,
    REELCHEMY_ARTIFACT_DIR: "/reelchemy-test-no-artifact-access",
    REELCHEMY_AUTH_DIR: "/reelchemy-test-no-auth-access",
  };
  for (const key of Object.keys(env))
    if (
      key.startsWith("SMTP_") ||
      key.startsWith("AI_") ||
      ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM"].includes(key)
    )
      delete env[key];
  const child = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/ingest-entrypoint.ts"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (data) => {
      output = (output + data).slice(-8000);
    });
  const stop = () => shutdownTestProcesses([child]);
  try {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(`Private media worker exited: ${output}`);
      if (output.includes("Reelchemy media worker ready"))
        return { child, stop };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Private media worker did not become ready.");
  } catch (error) {
    await stop();
    throw error;
  }
}
