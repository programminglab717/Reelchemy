// Developer tool: run the real director (plan, write, check, review) without
// a provider key. The director talks to a local stand-in for the Anthropic
// Messages API over its normal HTTPS client; every request is written to a
// folder, and whoever answers it (a person, or a model session that is shown
// only the request) writes the reply there. Use it to judge the prompts with a
// real model: read the finished contact sheets and what the model had to guess.
//   npx tsx scripts/director-standin.ts <out-dir> "<brief>" [seconds] [format]
// For each request the tool writes <out-dir>/req-NN/request.txt (it names the
// system prompt file; attached stills are saved beside it) and an empty file
// named ready. Answer by writing response.txt, then an empty file named done.
// At the end it writes plan.json, timeline.json, reports.json, a contact
// sheet per scene and a file named FINISHED.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { z } from "zod";
import { directFilm } from "../src/director/director";
import { providerLlm, type Llm } from "../src/director/llm";
import { providerConfiguration } from "../src/lib/provider-config";
import { contactSheet, previewMotionScene } from "../src/motion/preflight";

const [outArg, prompt, secondsArg = "20", formatArg = "landscape"] =
  process.argv.slice(2);
if (!outArg || !prompt) {
  console.error(
    'Usage: director-standin.ts <out-dir> "<brief>" [seconds] [format]',
  );
  process.exit(64);
}
const out = path.resolve(outArg);
const format = z.enum(["landscape", "portrait", "square"]).parse(formatArg);
const duration = z.coerce.number().min(3).max(600).parse(secondsArg);
mkdirSync(out, { recursive: true });
const key = path.join(out, "standin-key.pem");
const cert = path.join(out, "standin-cert.pem");

if (process.env.DIRECTOR_STANDIN_CHILD !== "1") {
  // The director's client only speaks HTTPS: make a throwaway certificate
  // and run again trusting it.
  execFileSync(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2"],
      ...["-keyout", key, "-out", cert, "-subj", "/CN=localhost"],
      ...["-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    ],
    { stdio: "ignore" },
  );
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: cert,
        DIRECTOR_STANDIN_CHILD: "1",
      },
    },
  );
  process.exit(child.status ?? 1);
}

type Part =
  { type: "text"; text: string } | { type: "image"; source: { data: string } };
let count = 0;
const server = https.createServer(
  { key: readFileSync(key), cert: readFileSync(cert) },
  (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        model: string;
        max_tokens: number;
        system: { text: string }[];
        messages: { role: string; content: Part[] }[];
      };
      const name = String(++count).padStart(2, "0");
      const dir = path.join(out, `req-${name}`);
      mkdirSync(dir, { recursive: true });
      const system = body.system.map((part) => part.text).join("\n");
      const hash = createHash("sha256")
        .update(system)
        .digest("hex")
        .slice(0, 8);
      const systemFile = path.join(out, `system-${hash}.txt`);
      if (!existsSync(systemFile)) writeFileSync(systemFile, system);
      let text = `SYSTEM PROMPT: ${systemFile}\nMAX OUTPUT TOKENS: ${body.max_tokens}\n`;
      let images = 0;
      for (const message of body.messages) {
        text += `\n\n======== ${message.role.toUpperCase()} ========\n`;
        for (const part of message.content)
          if (part.type === "text") text += `${part.text}\n`;
          else {
            const file = path.join(dir, `image-${++images}.png`);
            writeFileSync(file, Buffer.from(part.source.data, "base64"));
            text += `[IMAGE attached here: ${file}]\n`;
          }
      }
      writeFileSync(path.join(dir, "request.txt"), text);
      writeFileSync(path.join(dir, "ready"), "");
      console.log(
        `request ${name}: ${body.messages.length} messages, ${images} images`,
      );
      while (!existsSync(path.join(dir, "done")))
        await new Promise((resolve) => setTimeout(resolve, 500));
      const reply = readFileSync(path.join(dir, "response.txt"), "utf8");
      console.log(`response ${name}: ${reply.length} characters`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: `msg_${name}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: reply }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: Math.round(text.length / 4),
            output_tokens: Math.round(reply.length / 4),
          },
        }),
      );
    });
  },
);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No port.");
const config = providerConfiguration({
  AI_PROVIDER: "anthropic",
  AI_API_KEY: "local-stand-in",
  AI_MODEL: "stand-in",
  AI_BASE_URL: `https://127.0.0.1:${address.port}/v1`,
});
if (config.provider === "mock") throw new Error("No provider.");
const real = providerLlm(config);
// Answers are written by hand or by another session: allow an hour each.
const llm: Llm = (request) => real({ ...request, timeoutMs: 3600000 });
const started = Date.now();
let outcome = "ok";
try {
  const result = await directFilm({
    brief: { prompt, duration, format },
    llm,
    vision: true,
    maxRevisions: 2,
    concurrency: 1,
    progress: (stage, fraction) =>
      console.log(`[${Math.round(fraction * 100)}%] ${stage}`),
  });
  const save = (name: string, value: unknown) =>
    writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
  save("plan.json", result.plan);
  save("timeline.json", result.timeline);
  save("reports.json", result.scenes);
  for (const [index, scene] of result.timeline.scenes.entries()) {
    if (!scene.code) continue;
    const seconds = scene.durationFrames / 30;
    const preview = await previewMotionScene({
      code: scene.code,
      format,
      durationSeconds: seconds,
      times: Array.from({ length: 9 }, (_, i) => (seconds * (i + 0.5)) / 9),
      width: 640,
    });
    save(`scene-${index + 1}.json`, scene.code);
    if (preview.frames.length)
      writeFileSync(
        path.join(out, `scene-${index + 1}.png`),
        await contactSheet(preview.frames),
      );
  }
  console.log(
    `Finished in ${Math.round((Date.now() - started) / 1000)} s with ${count} model calls.`,
  );
} catch (error) {
  outcome = `failed: ${error instanceof Error ? error.message : String(error)}`;
  console.error(outcome);
}
writeFileSync(path.join(out, "FINISHED"), outcome);
server.close();
process.exit(outcome === "ok" ? 0 : 1);
