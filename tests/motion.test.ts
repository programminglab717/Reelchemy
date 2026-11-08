import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema, type Project, type Timeline } from "../src/lib/schema";
import { motionDocument } from "../src/motion/document";
import { staticScenePlan } from "../src/lib/static-scene";
import { readFileSync } from "node:fs";
import {
  buildThreeBundle,
  THREE_BUNDLE_PATH,
} from "../src/motion/three-bundle";
import { videoCompositePlan } from "../src/lib/video-composite-plan";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-motion-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
const { exportArchive, importArchive } = await import("../src/lib/archive");
const { serveRenderAssets } = await import("../src/lib/render-assets");
const { GET } = await import("../src/app/motion-lib/[...file]/route");
after(() => rm(root, { recursive: true, force: true }));

const code = {
  html: '<div id="title">Hello</div>',
  css: "#title{color:#fff}",
  js: 'gsap.from("#title",{opacity:0,duration:1});',
};
function codeTimeline(frames = 300): Timeline {
  const t = blankTimeline({
    prompt: "Code scene",
    duration: 10,
    format: "landscape",
  });
  t.scenes = [
    {
      ...t.scenes[0],
      id: "code",
      durationFrames: frames,
      layers: [],
      code: { ...code },
    },
  ];
  return t;
}

test("scene documents are sandboxed: no network, only allowlisted scripts, code cannot close its own tags", () => {
  const doc = motionDocument({
    code: {
      ...code,
      js: 'const s = "</script><script>alert(1)</script>";',
      css: "</style><script>alert(2)</script>",
      libraries: ["d3"],
    },
    baseUrl: "http://127.0.0.1:4000/token/motion/",
    format: "portrait",
    width: 720,
    height: 1280,
    fps: 30,
    durationSeconds: 4,
    seed: 3,
  });
  const policy = /Content-Security-Policy" content="([^"]+)"/.exec(doc)![1];
  for (const rule of [
    "default-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "img-src data: blob:",
    "script-src 'unsafe-inline' http://127.0.0.1:4000",
  ])
    assert(policy.includes(rule), rule);
  assert(!doc.includes("</script><script>alert(1)"));
  assert(!doc.includes("</style><script>alert(2)"));
  assert(doc.includes('src="http://127.0.0.1:4000/token/motion/gsap.js"'));
  assert(doc.includes('src="http://127.0.0.1:4000/token/motion/d3.js"'));
  // Portrait stage 1080×1920 scaled to 720 wide.
  assert(doc.includes("width:1080px;height:1920px;transform:scale(0.6666"));
});

test("code scenes may run 60 seconds and are bounded; layered scenes keep 20 seconds", () => {
  assert(timelineSchema.safeParse(codeTimeline(1800)).success);
  assert(!timelineSchema.safeParse(codeTimeline(1801)).success);
  const layered = codeTimeline(900);
  delete layered.scenes[0].code;
  assert(!timelineSchema.safeParse(layered).success);
  const huge = codeTimeline(300);
  huge.scenes[0].code = { ...code, js: "x".repeat(80001) };
  assert(!timelineSchema.safeParse(huge).success);
  const unknown = codeTimeline(300);
  (unknown.scenes[0].code as Record<string, unknown>).libraries = ["jquery"];
  assert(!timelineSchema.safeParse(unknown).success);
});

test("code scenes are always rendered frame by frame and never composited around footage", () => {
  const t = timelineSchema.parse(codeTimeline(120));
  t.scenes[0].transition = "cut";
  assert.equal(staticScenePlan(t), null);
  assert.equal(videoCompositePlan(t), null);
});

test("archives carry code scenes under their own required feature", async () => {
  const project: Project = {
    id: randomUUID(),
    name: "Code archive",
    brief: { prompt: "Code", duration: 10, format: "landscape" },
    timeline: timelineSchema.parse(codeTimeline(300)),
    assets: [],
    messages: [],
    createdAt: new Date().toISOString(),
    revisions: [],
  };
  const archive = await exportArchive(project);
  const envelope = JSON.parse(strFromU8(unzipSync(archive)["project.json"]));
  assert.equal(envelope.version, 5);
  assert.deepEqual(envelope.requiredFeatures, ["code-scene-v1"]);
  assert.deepEqual(
    (await importArchive(archive)).timeline!.scenes[0].code,
    code,
  );
  envelope.requiredFeatures = ["layer-mask-v1"];
  await assert.rejects(
    importArchive(
      zipSync({ "project.json": strToU8(JSON.stringify(envelope)) }),
    ),
  );
  // A fitted scene also requires the fit feature, so older readers refuse it.
  const fitted = structuredClone(project);
  fitted.timeline!.scenes[0].code = {
    ...code,
    fit: { scale: 0.8, x: 40, y: 20 },
  };
  const fittedArchive = await exportArchive(fitted);
  const fittedEnvelope = JSON.parse(
    strFromU8(unzipSync(fittedArchive)["project.json"]),
  );
  assert.deepEqual(fittedEnvelope.requiredFeatures, [
    "code-scene-v1",
    "code-fit-v1",
  ]);
  assert.deepEqual(
    (await importArchive(fittedArchive)).timeline!.scenes[0].code!.fit,
    { scale: 0.8, x: 40, y: 20 },
  );
  fittedEnvelope.requiredFeatures = ["code-scene-v1"];
  await assert.rejects(
    importArchive(
      zipSync({ "project.json": strToU8(JSON.stringify(fittedEnvelope)) }),
    ),
  );
});

test("exports serve allowlisted motion files only for films with code scenes", async () => {
  const plain = blankTimeline({
    prompt: "Plain",
    duration: 5,
    format: "landscape",
  });
  const none = await serveRenderAssets(timelineSchema.parse(plain));
  assert.equal(none.motionBaseUrl, "");
  await none.close();
  const served = await serveRenderAssets(timelineSchema.parse(codeTimeline()));
  try {
    const gsap = await fetch(`${served.motionBaseUrl}/gsap.js`);
    assert.equal(gsap.status, 200);
    assert.match(gsap.headers.get("content-type")!, /javascript/);
    assert.equal(gsap.headers.get("access-control-allow-origin"), "*");
    assert.match(await gsap.text(), /GreenSock|gsap/i);
    const icons = await fetch(`${served.motionBaseUrl}/icons.js`);
    assert.match(
      await icons.text(),
      /^window\.__reelchemyIcons=\{"a-arrow-down"/,
    );
    const font = await fetch(`${served.motionBaseUrl}/fonts/inter.woff2`);
    assert.equal(font.headers.get("content-type"), "font/woff2");
    // three.js: one generated script with the core and the chosen add-ons.
    const three = await fetch(`${served.motionBaseUrl}/three.js`);
    assert.equal(three.status, 200);
    assert.match(three.headers.get("content-type")!, /javascript/);
    const bundle = await three.text();
    assert.match(bundle, /window\.THREE=/);
    assert(!/^\s*(import|export)\s/m.test(bundle), "a classic script");
    for (const name of [
      "package.json",
      "../package.json",
      "gsap/dist/gsap.js",
      "three/package.json",
      "three/build/three.module.js",
      "three/examples/jsm/loaders/GLTFLoader.js",
    ])
      assert.equal(
        (await fetch(`${served.motionBaseUrl}/${name}`)).status,
        404,
        name,
      );
    const wrongToken = served.motionBaseUrl.replace(
      /\/[a-f0-9]{64}\//,
      `/${"0".repeat(64)}/`,
    );
    assert.equal((await fetch(`${wrongToken}/gsap.js`)).status, 404);
  } finally {
    await served.close();
  }
});

test("the studio serves the same files for previews and refuses anything else", async () => {
  const ok = await GET(
    new Request("http://studio.test/motion-lib/fonts/jetbrains-mono.woff2"),
    {
      params: Promise.resolve({ file: ["fonts", "jetbrains-mono.woff2"] }),
    },
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "font/woff2");
  const refused = await GET(new Request("http://studio.test/motion-lib/x"), {
    params: Promise.resolve({ file: ["..", "package.json"] }),
  });
  assert.equal(refused.status, 404);
});

test("3D scenes load three.js as a plain script, only when asked", () => {
  const options = {
    baseUrl: "http://127.0.0.1:4000/token/motion",
    format: "landscape" as const,
    width: 1280,
    height: 720,
    fps: 30,
    durationSeconds: 4,
    seed: 1,
  };
  const flat = motionDocument({ ...options, code });
  assert(!flat.includes("/three.js"));
  const deep = motionDocument({
    ...options,
    code: { ...code, libraries: ["three"] },
  });
  assert(
    deep.includes(
      '<script src="http://127.0.0.1:4000/token/motion/three.js" onerror=',
    ),
  );
  // A library that fails to load is reported by name instead of surfacing
  // later as a missing global.
  assert(deep.includes("message:'three.js could not be loaded.'"));
  assert(!deep.includes("importmap") && !deep.includes('type="module"'));
  assert(deep.includes("script-src 'unsafe-inline' http://127.0.0.1:4000"));
});

test("the committed three.js bundle matches the installed three.js and add-ons", () => {
  // Served without compiling anything at run time. Regenerate with
  // npm run vendor:three after changing three.js or the add-on list.
  const committed = readFileSync(THREE_BUNDLE_PATH);
  assert(
    committed.equals(buildThreeBundle()),
    `${THREE_BUNDLE_PATH} is out of date: run npm run vendor:three`,
  );
});
