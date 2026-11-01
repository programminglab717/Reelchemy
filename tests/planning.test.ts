import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline, revisionId } from "../src/lib/editor";
import type { Asset, Timeline, Project } from "../src/lib/schema";

const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-planning-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.EMAIL_DELIVERY = "file";
process.env.AI_PROVIDER = "compatible";
process.env.AI_BASE_URL = "https://provider.example.test/v1";
process.env.AI_MODEL = "offline-contract";
process.env.AI_API_KEY = "synthetic-test-only";
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
});
const db = await import("../src/lib/db");
const { POST } = await import("../src/app/api/projects/[id]/plan/route");
const { PATCH } = await import("../src/app/api/projects/[id]/route");
const brief = {
  prompt: "Owned footage story",
  duration: 5,
  format: "landscape" as const,
};
const image: Asset = {
  id: randomUUID(),
  name: "Owned image",
  source: "/private/source-not-for-provider",
  license: "Owned",
  mime: "image/png",
  createdAt: new Date().toISOString(),
};
const video: Asset = {
  ...image,
  id: randomUUID(),
  name: "Owned video",
  mime: "video/mp4",
  durationFrames: 300,
  hasAudio: true,
  width: 320,
  height: 180,
};
const audio: Asset = {
  ...image,
  id: randomUUID(),
  name: "Owned narration",
  mime: "audio/wav",
  durationFrames: 300,
};
let owner: string, cookie: string;
function project() {
  const p = db.createProject(brief, owner);
  p.assets = structuredClone([image, video, audio]);
  db.saveProject(p);
  return db.reviseProject(p, blankTimeline(brief), "Initial manual work");
}
function response(timeline: Timeline) {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(timeline) } }],
  });
}
function plan(p: Project, data: Record<string, unknown> = {}) {
  return POST(
    new Request(`http://127.0.0.1:3001/api/projects/${p.id}/plan`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        origin: "http://127.0.0.1:3001",
        cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    }),
    { params: Promise.resolve({ id: p.id }) },
  );
}
function visual(timeline: Timeline, asset: Asset) {
  const result = structuredClone(timeline);
  result.scenes[0].layers[0] = {
    ...result.scenes[0].layers[0],
    kind: asset.mime === "video/mp4" ? "video" : "image",
    assetId: asset.id,
    ...(asset.mime === "video/mp4"
      ? {
          video: {
            startFrame: 0,
            offsetFrames: 0,
            durationFrames: 150,
            volume: 1,
            audio: true,
            fit: "contain" as const,
          },
        }
      : {}),
  };
  return result;
}
test("planning validates owned media and protects saves across asynchronous provider work", async (t) => {
  const { getAuth } = await import("../src/lib/auth");
  const auth = await getAuth();
  const email = "offline-planner@example.test",
    password = "Test-only-planner-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: "Planner", email, password },
  });
  const admin = new Database(path.join(dir, "auth.sqlite"));
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert(cookie);
  owner = db.ensureWorkspace(signup.user.id, "Planner").id;

  await t.test(
    "provider gets only this project's media metadata and valid owned references save",
    async () => {
      const p = project();
      const other = db.createProject(
        brief,
        db.ensureWorkspace("unrelated-owner", "Other").id,
      );
      const privateAsset = {
        ...image,
        id: randomUUID(),
        name: "Other customer secret",
      };
      other.assets = [privateAsset];
      db.saveProject(other);
      const timeline = visual(p.timeline!, video);
      timeline.audioTracks = [
        {
          id: "voice",
          assetId: audio.id,
          startFrame: 0,
          offsetFrames: 0,
          durationFrames: 150,
          volume: 0.8,
          fadeFrames: 6,
        },
      ];
      globalThis.fetch = async (url, init) => {
        assert.equal(
          String(url),
          "https://provider.example.test/v1/chat/completions",
        );
        const payload = JSON.parse(String(init?.body));
        const content = JSON.parse(payload.messages[1].content);
        assert.deepEqual(
          content.assets.map((a: Asset) => a.id),
          [image.id, video.id, audio.id],
        );
        assert.equal(content.assets[1].durationFrames, 300);
        assert.equal(content.assets[1].hasAudio, true);
        assert(!String(init?.body).includes(privateAsset.id));
        assert(!String(init?.body).includes(image.source));
        assert(
          payload.messages[0].content.includes("untrusted descriptive data"),
        );
        return response(timeline);
      };
      const result = await plan(p);
      assert.equal(result.status, 200);
      assert.deepEqual(db.getProject(p.id)!.timeline, timeline);
    },
  );

  for (const defect of [
    "foreign image",
    "video overrun",
    "missing source audio",
    "audio overrun",
    "wrong format",
  ] as const) {
    await t.test(
      `${defect} is rejected without a partial revision or message`,
      async () => {
        const p = project();
        let timeline = visual(
          p.timeline!,
          defect === "foreign image" ? { ...image, id: randomUUID() } : video,
        );
        if (defect === "video overrun")
          timeline.scenes[0].layers[0].video!.offsetFrames = 151;
        if (defect === "missing source audio") {
          p.assets!.find((a) => a.id === video.id)!.hasAudio = false;
          db.saveProject(p);
        }
        if (defect === "audio overrun") {
          timeline = structuredClone(p.timeline!);
          timeline.audioTracks = [
            {
              id: "voice",
              assetId: audio.id,
              startFrame: 0,
              offsetFrames: 151,
              durationFrames: 150,
              volume: 0.8,
              fadeFrames: 6,
            },
          ];
        }
        if (defect === "wrong format") timeline.format = "portrait";
        const before = db.getProject(p.id);
        globalThis.fetch = async () => response(timeline);
        assert.equal((await plan(p)).status, 502);
        assert.deepEqual(db.getProject(p.id), before);
      },
    );
  }

  await t.test(
    "provider failures return safe codes without saving partial plans and manual work remains usable",
    async () => {
      const p = project();
      const before = db.getProject(p.id);
      const key = process.env.AI_API_KEY;
      const secret = "synthetic-private-provider-detail-DO-NOT-RETURN";
      try {
        for (const defect of [
          "configuration",
          "transport",
          "response",
        ] as const) {
          process.env.AI_API_KEY =
            defect === "configuration" ? `${secret}\n` : key;
          globalThis.fetch = async () => {
            if (defect === "configuration")
              throw new Error("must not reach transport");
            if (defect === "transport") throw new Error(secret);
            return new Response(`invalid response ${secret}`);
          };
          const result = await plan(p, {
            revision: "Improve this scene without losing my manual work",
          });
          assert.equal(result.status, defect === "configuration" ? 503 : 502);
          assert.equal(
            result.headers.get("cache-control"),
            "private, no-store",
          );
          const body = await result.json();
          assert.equal(
            body.code,
            defect === "configuration"
              ? "AI_CONFIGURATION"
              : defect === "transport"
                ? "AI_UNAVAILABLE"
                : "AI_INVALID_RESPONSE",
          );
          assert(!JSON.stringify(body).includes(secret));
          assert.deepEqual(db.getProject(p.id), before);
        }
        process.env.AI_API_KEY = key;
        globalThis.fetch = async () => response(p.timeline!);
        assert.equal((await plan(p)).status, 200);
      } finally {
        process.env.AI_API_KEY = key;
      }
    },
  );

  await t.test(
    "manual duration/format changes define a whole-plan revision's brief",
    async () => {
      let p = project();
      const timeline = structuredClone(p.timeline!);
      timeline.format = "portrait";
      timeline.scenes[0].durationFrames = 181;
      p = db.reviseProject(p, timeline, "Manual timing and format");
      globalThis.fetch = async (_url, init) => {
        const content = JSON.parse(
          JSON.parse(String(init?.body)).messages[1].content,
        );
        assert.equal(content.brief.duration, 181 / 30);
        assert.equal(content.brief.format, "portrait");
        assert.equal(content.current.scenes[0].durationFrames, 181);
        return response(timeline);
      };
      assert.equal(
        (
          await plan(p, {
            revision: "Keep this manual timing and improve the scene",
          })
        ).status,
        200,
      );
      assert.deepEqual(db.getProject(p.id)!.brief, brief);
    },
  );

  await t.test(
    "a scene request sends only that scene while preserving unrelated narration and captions",
    async () => {
      let p = project();
      const timeline = structuredClone(p.timeline!);
      timeline.scenes[0].durationFrames = 60;
      timeline.scenes.push({
        ...structuredClone(timeline.scenes[0]),
        id: "unrelated-scene",
        durationFrames: 90,
        title: "Unrelated work",
      });
      timeline.audioTracks = [
        {
          id: "voice",
          assetId: audio.id,
          startFrame: 60,
          offsetFrames: 0,
          durationFrames: 90,
          volume: 0.8,
          fadeFrames: 6,
        },
      ];
      timeline.captions = [
        {
          id: "later",
          text: "Preserve later caption",
          startFrame: 65,
          endFrame: 145,
        },
      ];
      p = db.reviseProject(p, timeline, "Narrated manual scenes");
      globalThis.fetch = async (_url, init) => {
        const content = JSON.parse(
          JSON.parse(String(init?.body)).messages[1].content,
        );
        assert.equal(content.current.scenes.length, 1);
        assert.equal(content.current.audioTracks, undefined);
        assert.equal(content.current.captions, undefined);
        const revised = structuredClone(content.current);
        revised.scenes[0].title = "Revised selected scene";
        return response(revised);
      };
      assert.equal(
        (
          await plan(p, {
            revision: "Improve only this scene",
            sceneId: timeline.scenes[0].id,
          })
        ).status,
        200,
      );
      const saved = db.getProject(p.id)!.timeline!;
      assert.equal(saved.scenes[0].title, "Revised selected scene");
      assert.deepEqual(saved.scenes[1], timeline.scenes[1]);
      assert.deepEqual(saved.audioTracks, timeline.audioTracks);
      assert.deepEqual(saved.captions, timeline.captions);
    },
  );

  await t.test(
    "a save while the provider is working wins over the stale response",
    async () => {
      const p = project();
      let newer: Project;
      globalThis.fetch = async () => {
        const timeline = structuredClone(p.timeline!);
        timeline.scenes[0].title = "Saved in another tab";
        newer = structuredClone(
          db.reviseProject(db.getProject(p.id)!, timeline, "Concurrent edit"),
        );
        return response(p.timeline!);
      };
      const result = await plan(p);
      assert.equal(result.status, 409);
      assert.equal((await result.json()).code, "REVISION_CONFLICT");
      assert.deepEqual(db.getProject(p.id), newer!);
    },
  );

  await t.test(
    "latest media metadata is validated again after the provider returns",
    async () => {
      const p = project();
      globalThis.fetch = async () => {
        const latest = db.getProject(p.id)!;
        latest.assets = latest.assets!.filter((a) => a.id !== image.id);
        db.saveProject(latest);
        return response(visual(p.timeline!, image));
      };
      assert.equal((await plan(p)).status, 400);
      assert.equal(revisionId(db.getProject(p.id)!), revisionId(p));
      assert.equal(
        db.getProject(p.id)!.assets!.some((a) => a.id === image.id),
        false,
      );
    },
  );

  await t.test(
    "moving to Trash during a provider call prevents the late plan from saving",
    async () => {
      const p = project(),
        before = db.getProject(p.id);
      globalThis.fetch = async () => {
        db.setProjectTrashed(p.id, true);
        return response(p.timeline!);
      };
      assert.equal((await plan(p)).status, 404);
      assert.deepEqual(db.getProject(p.id), before);
      assert.equal(db.projectInWorkspace(p.id, owner), false);
    },
  );
  await t.test(
    "moving to Trash while an editor body streams prevents its late save",
    async () => {
      const p = project(),
        before = db.getProject(p.id);
      let pulled = false;
      const stream = new ReadableStream(
        {
          pull(controller) {
            pulled = true;
            db.setProjectTrashed(p.id, true);
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  timeline: p.timeline,
                  baseRevisionId: revisionId(p),
                }),
              ),
            );
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const request = new Request(
        `http://127.0.0.1:3001/api/projects/${p.id}`,
        {
          method: "PATCH",
          headers: {
            host: "127.0.0.1:3001",
            origin: "http://127.0.0.1:3001",
            cookie,
            "content-type": "application/json",
          },
          body: stream,
          duplex: "half",
        } as RequestInit & { duplex: string },
      );
      const result = await PATCH(request, {
        params: Promise.resolve({ id: p.id }),
      });
      assert(pulled);
      assert.equal(result.status, 404);
      assert.deepEqual(db.getProject(p.id), before);
    },
  );
});
