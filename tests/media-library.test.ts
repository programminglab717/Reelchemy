import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  readdir,
  writeFile,
  symlink,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import type { Asset } from "../src/lib/schema";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-media-library-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(root, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const app = await import("../src/lib/db");
const { storeImage, assetDir } = await import("../src/lib/assets");
const { GET } = await import("../src/app/api/workspace/assets/route");
const { POST } = await import("../src/app/api/projects/[id]/assets/link/route");
const { GET: mediaGET } =
  await import("../src/app/api/projects/[id]/assets/[assetId]/route");
const { getAuth } = await import("../src/lib/auth");
after(() => rm(root, { recursive: true, force: true }));
const brief = {
  prompt: "Media reuse fixture",
  duration: 5,
  format: "landscape" as const,
};
function project(owner: string, name: string) {
  const p = app.createProject({ ...brief, prompt: name }, owner);
  return app.reviseProject(p, blankTimeline(p.brief), "Private fixture");
}
async function image(name = "Studio badge.png") {
  return storeImage(
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#f4c44a" },
    })
      .png()
      .toBuffer(),
    name,
    "Generated private library fixture",
  );
}
async function account(label: string) {
  const auth = await getAuth();
  const email = `${label}@example.test`,
    password = "Private-library-test-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: label, email, password },
  });
  const admin = new Database(
    path.join(process.env.REELCHEMY_AUTH_DIR!, "auth.sqlite"),
  );
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  return {
    id: signup.user.id,
    workspace: app.ensureWorkspace(signup.user.id, label).id,
    cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
function request(
  cookie: string,
  url = "/api/workspace/assets",
  data?: unknown,
  expected?: string,
) {
  return new Request(`http://127.0.0.1:3001${url}`, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie,
      "Content-Type": "application/json",
      ...(expected !== undefined ? { [ACCOUNT_HEADER]: expected } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}
const noParams = { params: Promise.resolve({}) };

test("owned studio media can be searched/reused without copying files, histories or storage charges", async (t) => {
  const owner = await account("library-owner"),
    other = await account("library-other");
  const source = project(owner.workspace, "Brand sources"),
    target = project(owner.workspace, "New campaign"),
    foreign = project(other.workspace, "Other private studio");
  const asset = await image();
  app.appendOwnedAsset(source.id, owner.workspace, asset);
  const foreignAsset = await image("Private other upload.png");
  app.appendOwnedAsset(foreign.id, other.workspace, foreignAsset);
  const selection = { sourceProjectId: source.id, assetId: asset.id };
  const targetURL = `/api/projects/${target.id}/assets/link`;
  await t.test(
    "verified ownership, account binding and private metadata/preview isolation",
    async () => {
      assert.equal((await GET(request(""), noParams)).status, 401);
      assert.equal(
        (await POST(request("", targetURL, selection), context(target.id)))
          .status,
        401,
      );
      assert.equal(
        (
          await POST(
            request(other.cookie, targetURL, selection),
            context(target.id),
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await POST(
            request(owner.cookie, targetURL, {
              sourceProjectId: foreign.id,
              assetId: foreignAsset.id,
            }),
            context(target.id),
          )
        ).status,
        404,
      );
      const response = await GET(
        request(owner.cookie, `/api/workspace/assets?projectId=${target.id}`),
        noParams,
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const listing = await response.json();
      assert.equal(listing.total, 1);
      assert.equal(listing.items[0].asset.id, asset.id);
      assert.equal(listing.items[0].asset.license, asset.license);
      const serialized = JSON.stringify(listing);
      for (const hidden of [
        foreign.id,
        foreignAsset.id,
        "revisions",
        "timeline",
        "messages",
        "auth",
        root,
      ])
        assert(!serialized.includes(hidden));
      const otherListing = await GET(
        request(
          other.cookie,
          `/api/workspace/assets?workspaceId=${owner.workspace}`,
        ),
        noParams,
      );
      assert.equal(
        (await otherListing.json()).items[0].asset.id,
        foreignAsset.id,
      );
      assert.equal(
        (
          await GET(
            request(
              other.cookie,
              `/api/workspace/assets?projectId=${target.id}`,
            ),
            noParams,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await GET(
            request(other.cookie, "/api/workspace/assets", undefined, owner.id),
            noParams,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await POST(
            request(owner.cookie, targetURL, selection, other.id),
            context(target.id),
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await mediaGET(request(other.cookie), {
            params: Promise.resolve({ id: source.id, assetId: asset.id }),
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "linking retains exact metadata and saved edits, is idempotent and adds no decoder allowance or file copy",
    async () => {
      const before = app.getProject(target.id)!;
      const saved = JSON.stringify({
        timeline: before.timeline,
        revisions: before.revisions,
        messages: before.messages,
      });
      const storage = app.mediaStorage(owner.workspace);
      const files = await readdir(assetDir);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await POST(
          request(owner.cookie, targetURL, {
            ...selection,
            asset: { mime: "video/mp4", license: "Forged metadata" },
          }),
          context(target.id),
        );
        assert.equal(response.status, 200);
        const p = await response.json();
        assert.equal(p.assets.length, 1);
        assert.deepEqual(p.assets[0], asset);
        assert.equal(
          JSON.stringify({
            timeline: p.timeline,
            revisions: p.revisions,
            messages: p.messages,
          }),
          saved,
        );
      }
      assert.deepEqual(app.mediaStorage(owner.workspace), storage);
      assert.deepEqual(await readdir(assetDir), files);
      const db = new Database(
        path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
      );
      assert.equal(
        (
          db
            .prepare(
              "SELECT count(*) n FROM request_limits WHERE workspace_id=? AND operation='media'",
            )
            .get(owner.workspace) as { n: number }
        ).n,
        0,
      );
      assert.equal(
        (
          db
            .prepare(
              "SELECT count(*) n FROM project_media_refs WHERE asset_id=?",
            )
            .get(asset.id) as { n: number }
        ).n,
        2,
      );
      db.close();
      const preview = await mediaGET(request(owner.cookie), {
        params: Promise.resolve({ id: target.id, assetId: asset.id }),
      });
      assert.equal(preview.status, 200);
      assert.deepEqual(
        Buffer.from(await preview.arrayBuffer()),
        await readFile(path.join(assetDir, asset.id)),
      );
      const all = await (await GET(request(owner.cookie), noParams)).json();
      assert.equal(all.total, 1);
    },
  );
  await t.test(
    "literal search/type filters, deduplication and pagination return compact retained metadata only",
    async () => {
      const workspace = app.ensureWorkspace("library-paging-only", "Paging").id;
      const first = project(workspace, "First media collection"),
        second = project(workspace, "Second collection");
      const bytes = await readFile(path.join(assetDir, asset.id));
      const entries: Asset[] = [];
      for (let index = 0; index < 24; index++) {
        const entry: Asset = {
          ...asset,
          id: randomUUID(),
          name:
            index === 0
              ? "Literal %_\\ badge.png"
              : `Library image ${index}.png`,
        };
        await writeFile(path.join(assetDir, entry.id), bytes, { flag: "wx" });
        app.appendOwnedAsset(first.id, workspace, entry);
        entries.push(entry);
      }
      app.appendOwnedAsset(second.id, workspace, entries[0]);
      const options = { query: "", kind: "all" as const, limit: 20, offset: 0 };
      const a = app.mediaLibrary(workspace, options);
      assert.equal(a.total, 24);
      assert.equal(a.items.length, 20);
      assert.equal(a.nextOffset, 20);
      const b = app.mediaLibrary(workspace, {
        ...options,
        offset: a.nextOffset!,
      });
      assert.equal(b.items.length, 4);
      assert.equal(b.nextOffset, null);
      assert.equal(
        new Set([...a.items, ...b.items].map((item) => item.asset.id)).size,
        24,
      );
      assert.equal(
        app.mediaLibrary(workspace, { ...options, kind: "video" }).total,
        0,
      );
      assert.equal(
        app.mediaLibrary(workspace, { ...options, kind: "image" }).total,
        24,
      );
      const exact = app.mediaLibrary(workspace, { ...options, query: "%_\\" });
      assert.equal(exact.total, 1);
      assert.equal(exact.items[0].asset.id, entries[0].id);
      assert.equal(exact.items[0].sourceProject.id, second.id);
      assert.equal(
        app.mediaLibrary(workspace, { ...options, query: "' OR 1=1 --" }).total,
        0,
      );
      // Histories and conversations can grow without entering the returned page.
      const large = app.getProject(first.id)!;
      large.messages.push({
        role: "user",
        content: "Private history sentinel".repeat(2000),
      });
      large.revisions = Array.from({ length: 400 }, () => large.revisions[0]);
      app.saveProject(large);
      const compact = JSON.stringify(
        app.mediaLibrary(workspace, { ...options, limit: 1 }),
      );
      assert(compact.length < 1400);
      assert(!compact.includes("Private history sentinel"));
      app.setProjectTrashed(second.id, true);
      assert.equal(
        app.mediaLibrary(workspace, { ...options, query: "%_\\" }).items[0]
          .sourceProject.id,
        first.id,
      );
      app.setProjectTrashed(first.id, true);
      assert.equal(app.mediaLibrary(workspace, options).total, 0);
    },
  );
  await t.test(
    "source/target activity is checked after streaming; a completed link replays after source removal",
    async () => {
      const changing = project(owner.workspace, "Changing source"),
        empty = project(owner.workspace, "Empty target");
      app.appendOwnedAsset(changing.id, owner.workspace, asset);
      let pulled = false;
      const streamed = (
        id: string,
        sourceProjectId: string,
        change: () => void,
      ) =>
        new Request(`http://127.0.0.1:3001/api/projects/${id}/assets/link`, {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            host: "127.0.0.1:3001",
            origin: "http://127.0.0.1:3001",
            "Content-Type": "application/json",
          },
          body: new ReadableStream(
            {
              pull(controller) {
                pulled = true;
                change();
                controller.enqueue(
                  new TextEncoder().encode(
                    JSON.stringify({ sourceProjectId, assetId: asset.id }),
                  ),
                );
                controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
          duplex: "half",
        } as RequestInit & { duplex: "half" });
      const late = await POST(
        streamed(empty.id, changing.id, () =>
          app.setProjectTrashed(changing.id, true),
        ),
        context(empty.id),
      );
      assert(pulled);
      assert.equal(late.status, 404);
      assert.equal(app.getProject(empty.id)!.assets?.length || 0, 0);
      app.setProjectTrashed(changing.id, false);
      assert.equal(
        (
          await POST(
            request(owner.cookie, `/api/projects/${empty.id}/assets/link`, {
              sourceProjectId: changing.id,
              assetId: asset.id,
            }),
            context(empty.id),
          )
        ).status,
        200,
      );
      app.setProjectTrashed(changing.id, true);
      app.requestOwnedProjectDeletion(changing.id, owner.workspace);
      const receipt = app.ownedProjectDeletion(changing.id, owner.workspace)!;
      assert.equal(receipt.state, "queued");
      const replay = await POST(
        request(owner.cookie, `/api/projects/${empty.id}/assets/link`, {
          sourceProjectId: changing.id,
          assetId: asset.id,
        }),
        context(empty.id),
      );
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).assets.length, 1);
      const another = project(owner.workspace, "Another empty target");
      assert.equal(
        (
          await POST(
            request(owner.cookie, `/api/projects/${another.id}/assets/link`, {
              sourceProjectId: changing.id,
              assetId: asset.id,
            }),
            context(another.id),
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await POST(
            streamed(another.id, source.id, () =>
              app.setProjectTrashed(another.id, true),
            ),
            context(another.id),
          )
        ).status,
        404,
      );
      assert.equal(app.getProject(another.id)!.assets?.length || 0, 0);
      const raw = new Database(
        path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
      );
      const { mediaReferencedOutsideProject } =
        await import("../src/lib/media-references");
      assert(mediaReferencedOutsideProject(raw, asset.id, changing.id));
      raw.close();
      assert((await readFile(path.join(assetDir, asset.id))).length > 0);
    },
  );
  await t.test(
    "existing storage overage permits zero-byte reuse while the project limit remains enforced",
    async () => {
      const noisy = await storeImage(
        await sharp(randomBytes(768 * 768 * 3), {
          raw: { width: 768, height: 768, channels: 3 },
        })
          .png()
          .toBuffer(),
        "Large owned fixture.png",
        "Generated test pixels",
      );
      app.appendOwnedAsset(source.id, owner.workspace, noisy);
      const next = project(owner.workspace, "Reuse while over allowance");
      const previous = process.env.REELCHEMY_MEDIA_STORAGE_BYTES;
      try {
        process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(1024 * 1024);
        const before = app.mediaStorage(owner.workspace);
        assert(before.usedBytes > before.limitBytes);
        const response = await POST(
          request(owner.cookie, `/api/projects/${next.id}/assets/link`, {
            sourceProjectId: source.id,
            assetId: noisy.id,
          }),
          context(next.id),
        );
        assert.equal(response.status, 200);
        assert.deepEqual(app.mediaStorage(owner.workspace), before);
      } finally {
        if (previous === undefined)
          delete process.env.REELCHEMY_MEDIA_STORAGE_BYTES;
        else process.env.REELCHEMY_MEDIA_STORAGE_BYTES = previous;
      }
      const full = project(owner.workspace, "Full project");
      const bytes = await readFile(path.join(assetDir, asset.id));
      const fullAssets: Asset[] = [];
      for (let index = 0; index < 30; index++) {
        const entry = { ...asset, id: randomUUID() };
        await writeFile(path.join(assetDir, entry.id), bytes, { flag: "wx" });
        app.appendOwnedAsset(full.id, owner.workspace, entry);
        fullAssets.push(entry);
      }
      const response = await POST(
        request(
          owner.cookie,
          `/api/projects/${full.id}/assets/link`,
          selection,
        ),
        context(full.id),
      );
      assert.equal(response.status, 409);
      assert.equal(app.getProject(full.id)!.assets!.length, 30);
      assert.equal(
        (
          await POST(
            request(owner.cookie, `/api/projects/${full.id}/assets/link`, {
              sourceProjectId: randomUUID(),
              assetId: fullAssets[0].id,
            }),
            context(full.id),
          )
        ).status,
        200,
      );
    },
  );
  await t.test(
    "missing files and symlinks fail safely without new references; repaired storage can retry",
    async () => {
      const next = project(owner.workspace, "Safe source files");
      const exclusive = await image("Checked private file.png");
      app.appendOwnedAsset(source.id, owner.workspace, exclusive);
      const file = path.join(assetDir, exclusive.id),
        original = await readFile(file);
      const targetURL = `/api/projects/${next.id}/assets/link`;
      const selected = { sourceProjectId: source.id, assetId: exclusive.id };
      const canary = path.join(root, "private-file-canary.txt");
      await writeFile(canary, "Unrelated synthetic private data", {
        flag: "wx",
      });
      const digest = (bytes: Buffer) =>
        createHash("sha256").update(bytes).digest("hex");
      const before = digest(await readFile(canary));
      await unlink(file);
      for (const mode of ["missing", "symlink"] as const) {
        if (mode === "symlink") await symlink(canary, file);
        const response = await POST(
          request(owner.cookie, targetURL, selected),
          context(next.id),
        );
        assert.equal(response.status, 503);
        const text = await response.text();
        assert(!text.includes(root));
        assert(!text.includes("ENOENT"));
        assert.equal(app.getProject(next.id)!.assets?.length || 0, 0);
        assert.equal(digest(await readFile(canary)), before);
      }
      await unlink(file);
      await writeFile(file, original, { flag: "wx" });
      assert.equal(
        (
          await POST(
            request(owner.cookie, targetURL, selected),
            context(next.id),
          )
        ).status,
        200,
      );
      assert.equal(app.getProject(next.id)!.assets![0].id, exclusive.id);
    },
  );
  await t.test(
    "invalid selections/queries are bounded and invalid legacy entries cannot leak arbitrary metadata",
    async () => {
      for (const query of [
        "limit=51",
        "offset=-1",
        "kind=document",
        "projectId=..%2Fauth",
        `q=${"a".repeat(101)}`,
      ])
        assert.equal(
          (
            await GET(
              request(owner.cookie, `/api/workspace/assets?${query}`),
              noParams,
            )
          ).status,
          400,
        );
      const invalid = await POST(
        request(owner.cookie, targetURL, {
          sourceProjectId: "../auth.sqlite",
          assetId: "invalid",
        }),
        context(target.id),
      );
      assert.equal(invalid.status, 400);
      for (const [body, expected] of [
        ["not JSON", 400],
        ["x".repeat(4097), 413],
      ] as const) {
        const req = new Request(`http://127.0.0.1:3001${targetURL}`, {
          method: "POST",
          headers: { host: "127.0.0.1:3001", cookie: owner.cookie },
          body,
        });
        assert.equal((await POST(req, context(target.id))).status, expected);
      }
      const legacy = project(owner.workspace, "Damaged legacy metadata");
      const privatePath = path.join(root, "auth", "auth.sqlite");
      legacy.assets = [
        "untrusted",
        42,
        {
          ...asset,
          id: randomUUID(),
          name: "Invalid legacy record",
          createdAt: "bad-date",
          path: privatePath,
        },
      ] as unknown as Asset[];
      app.saveProject(legacy);
      const response = await GET(
        request(
          owner.cookie,
          "/api/workspace/assets?q=Invalid%20legacy&limit=1",
        ),
        noParams,
      );
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.items.length, 0);
      assert.equal(result.nextOffset, null);
      assert(!JSON.stringify(result).includes(privatePath));
      const next = project(owner.workspace, "Refuse damaged legacy");
      assert.equal(
        (
          await POST(
            request(owner.cookie, `/api/projects/${next.id}/assets/link`, {
              sourceProjectId: legacy.id,
              assetId: legacy.assets![2].id,
            }),
            context(next.id),
          )
        ).status,
        404,
      );
    },
  );
  await t.test(
    "owned legacy project identifiers remain reusable without treating identifiers as file paths",
    async () => {
      const legacyId = "library-legacy-source";
      app.saveProject(
        { ...app.getProject(foreign.id)!, id: legacyId },
        other.workspace,
      );
      const target = project(other.workspace, "Legacy media reuse");
      const response = await GET(
        request(other.cookie, `/api/workspace/assets?projectId=${target.id}`),
        noParams,
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).items[0].sourceProject.id, legacyId);
      assert.equal(
        (
          await POST(
            request(other.cookie, `/api/projects/${target.id}/assets/link`, {
              sourceProjectId: legacyId,
              assetId: foreignAsset.id,
            }),
            context(target.id),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await GET(
            request(
              other.cookie,
              `/api/workspace/assets?projectId=${legacyId}`,
            ),
            noParams,
          )
        ).status,
        200,
      );
      assert.equal(app.getProject(target.id)!.assets![0].id, foreignAsset.id);
    },
  );
});
