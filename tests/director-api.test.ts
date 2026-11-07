import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-director-api-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(root, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const app = await import("../src/lib/db");
const { getAuth, authSigningSecret } = await import("../src/lib/auth");
const route = await import("../src/app/api/projects/[id]/direct/route");
after(() => rm(root, { recursive: true, force: true }));

const origin = "http://127.0.0.1:3001";
const auth = await getAuth();
const signup = await auth.api.signUpEmail({
  body: {
    name: "Director",
    email: "director@example.test",
    password: "Private-director-passphrase-4826",
  },
});
{
  const admin = new Database(path.join(root, "auth", "auth.sqlite"));
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
}
const login = await auth.api.signInEmail({
  body: {
    email: "director@example.test",
    password: "Private-director-passphrase-4826",
  },
  asResponse: true,
});
const cookie = login.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ");
const workspace = app.ensureWorkspace(signup.user.id, "Director").id;
const request = (url: string, init: RequestInit = {}) =>
  new Request(`${origin}${url}`, {
    ...init,
    headers: {
      host: "127.0.0.1:3001",
      origin,
      cookie,
      "content-type": "application/json",
    },
  });
const context = (id: string) => ({ params: Promise.resolve({ id }) });

// A stand-in for Anthropic's Messages API.
const plan = {
  title: "Queues",
  logline: "Why queues smooth bursts.",
  style: {
    background: "#0b1020",
    surface: "#111a2e",
    text: "#e2e8f0",
    muted: "#94a3b8",
    accents: ["#38bdf8"],
    motion: "Snappy.",
    motifs: "Packets.",
  },
  scenes: [
    {
      title: "The burst",
      seconds: 5,
      goal: "Requests arrive in bursts.",
      visual: "Dots arrive.",
    },
    {
      title: "The queue",
      seconds: 5,
      goal: "A queue absorbs them.",
      visual: "Dots line up.",
    },
  ],
};
const scene = (label: string) =>
  `<scene><html><div class="t">${label}</div></html><css>#stage{background:#0b1020}.t{position:absolute;left:200px;top:300px;font:700 90px "Space Grotesk";color:#fff}</css><js>gsap.timeline().from(".t",{x:-200,opacity:0,duration:1}).to(".t",{x:600,duration:3});</js></scene>`;
let hold: Promise<void> | undefined;
const calls: string[] = [];
const original = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (!String(url).startsWith("https://api.anthropic.com/"))
    return original(url, init);
  const body = JSON.parse(String(init!.body));
  const last = body.messages[body.messages.length - 1].content
    .map((part: { text?: string }) => part.text ?? "")
    .join("");
  calls.push(
    body.system.includes("creative director")
      ? "plan"
      : last.includes("Automatic checks")
        ? "review"
        : "write",
  );
  if (hold) await hold;
  init?.signal?.throwIfAborted();
  const text = body.system.includes("creative director")
    ? JSON.stringify(plan)
    : last.includes("Automatic checks")
      ? "<approved/>"
      : last.includes("Requested change")
        ? scene("Revised queue")
        : scene("Scene");
  return Response.json({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1200, output_tokens: 800 },
  });
}) as typeof fetch;
after(() => {
  globalThis.fetch = original;
});

async function finished(projectId: string) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const { job } = await (
      await route.GET(
        request(`/api/projects/${projectId}/direct`),
        context(projectId),
      )
    ).json();
    if (!["queued", "working"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Director did not finish");
}

test(
  "the director needs a key, animates a film in the background, revises one scene and can be cancelled",
  { timeout: 300000 },
  async () => {
    const project = app.createProject(
      { prompt: "Explain message queues", duration: 10, format: "landscape" },
      workspace,
    );
    const start = (body: unknown) =>
      route.POST(
        request(`/api/projects/${project.id}/direct`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
        context(project.id),
      );
    // Without a key the studio keeps the demo director.
    const demo = await start({});
    assert.equal(demo.status, 409);
    assert.equal((await demo.json()).code, "DIRECTOR_NEEDS_KEY");

    app.studioAiCredentials.save(
      workspace,
      {
        provider: "anthropic",
        model: "claude-test-model",
        apiKey: "sk-test-director-key-0123456789",
        inputUsdPerMillion: "3",
        outputUsdPerMillion: "15",
        dailyUsd: "20",
      },
      authSigningSecret(),
    );
    const accepted = await start({});
    assert.equal(accepted.status, 202);
    const busy = await start({});
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).code, "DIRECTOR_BUSY");
    const job = await finished(project.id);
    assert.equal(job.state, "completed", job.error);
    assert.match(
      job.summary,
      /^AI director animated 2 scenes: The burst · The queue\./,
    );
    const saved = app.getProject(project.id)!;
    assert.equal(saved.timeline!.scenes.length, 2);
    assert(saved.timeline!.scenes.every((s) => s.code));
    assert.equal(saved.revisions.at(-1)!.source, "AI director");
    assert.equal(saved.messages.at(-1)!.role, "assistant");
    assert.deepEqual(calls.slice(0, 1), ["plan"]);
    assert(calls.filter((c) => c === "review").length >= 2);
    // Usage is accounted against the studio's own key.
    const usage = new Database(path.join(root, "data", "studio.sqlite"))
      .prepare(
        "SELECT count(*) AS n, sum(output_tokens) AS out FROM provider_usage WHERE workspace_id=? AND access='own' AND state='settled'",
      )
      .get(workspace) as { n: number; out: number };
    assert.equal(usage.n, calls.length);
    assert.equal(usage.out, 800 * calls.length);

    // One scene, revised by instruction: same id and length, new code.
    const target = saved.timeline!.scenes[1];
    assert.equal(
      (await start({ sceneId: target.id, instruction: "Make the queue glow" }))
        .status,
      202,
    );
    assert.equal((await finished(project.id)).state, "completed");
    const revised = app.getProject(project.id)!;
    const changed = revised.timeline!.scenes[1];
    assert.equal(changed.id, target.id);
    assert.equal(changed.durationFrames, target.durationFrames);
    assert.match(changed.code!.html, /Revised queue/);
    assert.deepEqual(revised.timeline!.scenes[0], saved.timeline!.scenes[0]);
    assert.equal(revised.messages.at(-2)!.content, "Make the queue glow");

    // Cancelling stops the run and leaves the film unchanged.
    let release: () => void = () => {};
    hold = new Promise((resolve) => (release = resolve));
    assert.equal(
      (await start({ instruction: "Make it about Kafka instead" })).status,
      202,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const cancelled = await (
      await route.DELETE(
        request(`/api/projects/${project.id}/direct`, { method: "DELETE" }),
        context(project.id),
      )
    ).json();
    assert.equal(cancelled.job.state, "cancelled");
    hold = undefined;
    release();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(app.getProject(project.id)!.timeline, revised.timeline);
    assert.equal((await finished(project.id)).state, "cancelled");
  },
);
