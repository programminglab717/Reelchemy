import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import { startMediaWorker } from "./helpers/media-worker";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-mcp-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(root, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(root, "artifacts");
process.env.EMAIL_DELIVERY = "file";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
const { getAuth } = await import("../src/lib/auth");
const mcp = await import("../src/app/api/mcp/route");
const tokens = await import("../src/app/api/account/mcp-tokens/route");
const projects = await import("../src/app/api/projects/route");
const files = await import("../src/app/api/mcp/files/[token]/route");
after(() => rm(root, { recursive: true, force: true }));

const origin = "http://127.0.0.1:3001";
const auth = await getAuth();
// A verified account with a browser session (cookie).
async function account(name: string) {
  const email = `${name}@example.test`,
    password = "Private-assistant-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name, email, password },
  });
  const admin = new Database(path.join(root, "auth", "auth.sqlite"));
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
const session = (cookie: string, method: string, body?: unknown) =>
  new Request(`${origin}/api/account/mcp-tokens`, {
    method,
    headers: {
      host: "127.0.0.1:3001",
      origin,
      cookie,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const none = { params: Promise.resolve({}) };
async function newToken(cookie: string) {
  const response = await tokens.POST(
    session(cookie, "POST", { name: "Claude" }),
    none,
  );
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.match(created.token, /^rlc_[A-Za-z0-9_-]{43}$/);
  return created as { token: string; summary: { id: string } };
}
let id = 0;
async function rpc(
  token: string | null,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
) {
  const response = await mcp.POST(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    }),
  );
  return {
    response,
    body: response.status === 200 ? await response.json() : null,
  };
}
const call = async (token: string, name: string, args: unknown) => {
  const { body } = await rpc(token, "tools/call", { name, arguments: args });
  assert(body?.result, JSON.stringify(body));
  return body.result as {
    isError?: boolean;
    content: { type: string; text?: string; data?: string }[];
    structuredContent?: Record<string, unknown>;
  };
};

const owner = await account("owner");
const stranger = await account("stranger");
const { token, summary } = await newToken(owner);
const { token: strangerToken } = await newToken(stranger);

test("the endpoint needs a valid assistant token and refuses other sites", async () => {
  const missing = await rpc(null, "initialize", {});
  assert.equal(missing.response.status, 401);
  assert.match(
    missing.response.headers.get("www-authenticate")!,
    /^Bearer realm="reelchemy"/,
  );
  assert.equal(
    (await rpc("rlc_" + "x".repeat(43), "ping")).response.status,
    401,
  );
  const crossSite = await rpc(token, "ping", undefined, {
    origin: "https://evil.example",
  });
  assert.equal(crossSite.response.status, 403);
  // Tokens open the MCP endpoint only, never the studio's other APIs.
  const api = await projects.GET(
    new Request(`${origin}/api/projects?query=&offset=0&limit=5&view=summary`, {
      headers: { host: "127.0.0.1:3001", authorization: `Bearer ${token}` },
    }),
    none,
  );
  assert.equal(api.status, 401);
  assert.equal((await mcp.GET()).status, 405);
});

test("tokens are listed without their secret and can be revoked", async () => {
  const listed = await (await tokens.GET(session(owner, "GET"), none)).json();
  assert.equal(listed.tokens.length, 1);
  assert.equal(listed.tokens[0].hint, token.slice(-4));
  assert(!JSON.stringify(listed).includes(token));
  const spare = await newToken(owner);
  assert.equal((await rpc(spare.token, "ping")).response.status, 200);
  const revoked = await tokens.DELETE(
    session(owner, "DELETE", { id: spare.summary.id }),
    none,
  );
  assert.equal(revoked.status, 200);
  assert.equal((await rpc(spare.token, "ping")).response.status, 401);
  // One studio cannot revoke another's token.
  const foreign = await tokens.DELETE(
    session(stranger, "DELETE", { id: summary.id }),
    none,
  );
  assert.equal(foreign.status, 404);
});

test("initialize, tools, resources and prompts follow MCP", async () => {
  const init = await rpc(token, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.body.result.serverInfo.name, "reelchemy");
  assert(init.body.result.capabilities.tools);
  // Notifications are accepted without a reply.
  const note = await mcp.POST(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    }),
  );
  assert.equal(note.status, 202);
  const list = (await rpc(token, "tools/list")).body.result.tools;
  const names = list.map((t: { name: string }) => t.name);
  for (const name of [
    "get_motion_guide",
    "create_project",
    "write_scene",
    "preview_scene",
    "export_video",
  ])
    assert(names.includes(name), name);
  const write = list.find((t: { name: string }) => t.name === "write_scene");
  assert.equal(write.inputSchema.type, "object");
  assert.deepEqual([...write.inputSchema.required].sort(), [
    "css",
    "html",
    "js",
    "project_id",
    "scene_index",
  ]);
  const guide = await call(token, "get_motion_guide", {});
  assert.match(guide.content[0].text!, /R\.shots/);
  const resources = (await rpc(token, "resources/list")).body.result.resources;
  assert(
    resources.some(
      (r: { uri: string }) => r.uri === "reelchemy://examples/cdn-globe",
    ),
  );
  const read = await rpc(token, "resources/read", {
    uri: "reelchemy://examples/deploy-walkthrough",
  });
  assert.match(read.body.result.contents[0].text, /R\.cursor/);
  const prompt = await rpc(token, "prompts/get", {
    name: "make_explainer",
    arguments: { topic: "How DNS works" },
  });
  assert.match(prompt.body.result.messages[0].content.text, /How DNS works/);
  const unknown = await rpc(token, "nope/nope");
  assert.equal(unknown.body.error.code, -32601);
});

test(
  "an assistant creates a film, writes and previews code scenes, and exports",
  { timeout: 180000 },
  async () => {
    const created = await call(token, "create_project", {
      title: "How a cache works",
      format: "landscape",
      seconds: 12,
    });
    assert(!created.isError, JSON.stringify(created));
    const projectId = created.structuredContent!.projectId as string;
    assert.equal((created.structuredContent!.scenes as unknown[]).length, 1);
    // The studio link is absolute, so an assistant can hand it to its user.
    assert.equal(
      created.structuredContent!.studioUrl,
      `${origin}/?project=${projectId}`,
    );
    const added = await call(token, "add_scene", {
      project_id: projectId,
      seconds: 4,
    });
    assert.equal((added.structuredContent!.scenes as unknown[]).length, 2);
    const code = {
      html: '<div class="panel"></div><h1 class="t">Cache hit</h1>',
      css: ".panel{position:absolute;left:120px;top:120px;width:1680px;height:840px;border:2px solid #334155;border-radius:24px}.t{position:absolute;left:200px;top:200px;margin:0;font:700 96px Inter;color:#fff}",
      js: 'gsap.timeline().from(".t", { opacity: 0, y: 40, duration: 0.6 }).to(".t", { x: 900, duration: 3.5, ease: "none" }, 0.6);',
    };
    const written = await call(token, "write_scene", {
      project_id: projectId,
      scene_index: 1,
      title: "The hit",
      ...code,
    });
    assert(!written.isError, JSON.stringify(written.content));
    assert.match(written.content[0].text!, /^Saved scene 1/);
    // The preview came back as stills plus the automatic checks.
    assert(
      written.content.some((c) => c.type === "image" && c.data!.length > 1000),
    );
    assert.equal(typeof written.structuredContent!.passed, "boolean");
    const scene = await call(token, "get_scene", {
      project_id: projectId,
      scene_index: 1,
    });
    assert.equal((scene.structuredContent!.code as { js: string }).js, code.js);
    // Broken code is reported, with the scene's own error.
    const broken = await call(token, "preview_scene", {
      project_id: projectId,
      html: "",
      css: "",
      js: "missingFunction();",
      seconds: 3,
    });
    assert.equal(broken.structuredContent!.passed, false);
    assert.match(
      broken.content[0].text!,
      /JavaScript error: ReferenceError: missingFunction/,
    );
    // Another studio's token cannot read or change this project.
    const foreign = await call(strangerToken, "get_project", {
      project_id: projectId,
    });
    assert.equal(foreign.isError, true);
    assert.match(foreign.content[0].text!, /not found/i);
    const foreignWrite = await call(strangerToken, "write_scene", {
      project_id: projectId,
      scene_index: 0,
      preview: false,
      ...code,
    });
    assert.equal(foreignWrite.isError, true);
    // Invalid arguments come back as a tool error the model can fix.
    const invalid = await call(token, "write_scene", { project_id: projectId });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text!, /^Invalid arguments: .*js/);
    const exported = await call(token, "export_video", {
      project_id: projectId,
    });
    assert(!exported.isError, JSON.stringify(exported.content));
    const status = await call(token, "export_status", {
      job_id: exported.structuredContent!.jobId,
    });
    assert.equal(status.structuredContent!.status, "queued");
    const removed = await call(token, "remove_scene", {
      project_id: projectId,
      scene_index: 0,
    });
    assert.equal((removed.structuredContent!.scenes as unknown[]).length, 1);
  },
);

test(
  "an assistant adds images, captions and a name, and fetches a finished export by link",
  { timeout: 180000 },
  async () => {
    const created = await call(token, "create_project", {
      title: "Brand film",
      format: "landscape",
      seconds: 8,
    });
    const projectId = created.structuredContent!.projectId as string;
    const png = await sharp({
      create: { width: 96, height: 64, channels: 4, background: "#22d3ee" },
    })
      .png()
      .toBuffer();
    const worker = await startMediaWorker();
    try {
      // A small image inline.
      const inline = await call(token, "upload_image", {
        project_id: projectId,
        name: "logo",
        source: "Our own logo",
        data_base64: png.toString("base64"),
      });
      assert(!inline.isError, JSON.stringify(inline.content));
      assert.equal(inline.structuredContent!.status, "added");
      const first = inline.structuredContent!.image as {
        id: string;
        name: string;
        width: number;
      };
      assert.equal(first.name, "logo.png");
      assert.equal(first.width, 96);
      // Something that is not a picture is refused, as a tool error.
      const text = await call(token, "upload_image", {
        project_id: projectId,
        name: "notes.png",
        source: "Our own notes",
        data_base64: Buffer.from("just some text, not an image").toString(
          "base64",
        ),
      });
      assert.equal(text.isError, true);
      assert.match(text.content[0].text!, /PNG, JPEG or WebP/);
      // A file from disk, through a one-time link.
      const linked = await call(token, "create_upload_link", {
        project_id: projectId,
        name: "product shot.jpg",
        source: "Photo of our own product",
      });
      assert(!linked.isError, JSON.stringify(linked.content));
      const uploadUrl = linked.structuredContent!.uploadUrl as string;
      assert.match(
        uploadUrl,
        /^http:\/\/127\.0\.0\.1:3001\/api\/mcp\/files\/rll_/,
      );
      const linkToken = uploadUrl.split("/").pop()!;
      const jpeg = await sharp({
        create: { width: 200, height: 100, channels: 3, background: "#f472b6" },
      })
        .jpeg()
        .toBuffer();
      const put = (body: Uint8Array) =>
        files.PUT(
          new Request(uploadUrl, {
            method: "PUT",
            body: new Blob([new Uint8Array(body)]),
          }),
          {
            params: Promise.resolve({ token: linkToken }),
          },
        );
      // A wrong file does not use the link up.
      assert.equal((await put(Buffer.from("not an image"))).status, 415);
      const sent = await put(jpeg);
      assert.equal(sent.status, 201);
      assert.equal(sent.headers.get("cache-control"), "no-store");
      const second = (await sent.json()) as {
        status: string;
        image: { id: string; name: string; width: number };
      };
      assert.equal(second.image.name, "product shot.jpg");
      assert.equal(second.image.width, 200);
      // The link worked once; a download link is not an upload link.
      assert.equal((await put(jpeg)).status, 404);
      const project = await call(token, "get_project", {
        project_id: projectId,
      });
      assert.deepEqual(
        (project.structuredContent!.images as { id: string }[]).map(
          (i) => i.id,
        ),
        [first.id, second.image.id],
      );
      // Another studio cannot make a link into this project.
      const foreign = await call(strangerToken, "create_upload_link", {
        project_id: projectId,
        name: "x.png",
        source: "Not mine",
      });
      assert.equal(foreign.isError, true);
    } finally {
      await worker.stop();
    }
    // Captions: sorted, placed in frames, refused when they overlap.
    const captions = await call(token, "set_captions", {
      project_id: projectId,
      captions: [
        { start: 4, end: 7.5, text: "Then it  locks." },
        { start: 0.5, end: 3, text: "First, the handshake." },
      ],
    });
    assert(!captions.isError, JSON.stringify(captions.content));
    assert.equal(captions.structuredContent!.captions, 2);
    const overlap = await call(token, "set_captions", {
      project_id: projectId,
      captions: [
        { start: 0, end: 3, text: "One" },
        { start: 2, end: 4, text: "Two" },
      ],
    });
    assert.equal(overlap.isError, true);
    assert.match(overlap.content[0].text!, /starts before/);
    const renamed = await call(token, "rename_project", {
      project_id: projectId,
      name: "Launch film",
    });
    assert.equal(renamed.structuredContent!.name, "Launch film");
    // An export that has finished comes with a link that needs no sign-in.
    const exported = await call(token, "export_video", {
      project_id: projectId,
    });
    const jobId = exported.structuredContent!.jobId as string;
    const early = await call(token, "get_download_link", { job_id: jobId });
    assert.equal(early.isError, true);
    assert.match(early.content[0].text!, /queued/);
    const studio = new Database(path.join(root, "data", "studio.sqlite"));
    studio
      .prepare(
        "UPDATE jobs SET status='completed', data=json_set(data,'$.status','completed','$.progress',1) WHERE id=?",
      )
      .run(jobId);
    studio.close();
    const video = Buffer.from("not really a video, but exactly these bytes");
    await mkdir(path.join(root, "artifacts", jobId), { recursive: true });
    await writeFile(path.join(root, "artifacts", jobId, "video.mp4"), video);
    const status = await call(token, "export_status", { job_id: jobId });
    assert.equal(status.structuredContent!.status, "completed");
    const downloadUrl = status.structuredContent!.downloadUrl as string;
    assert.equal(status.structuredContent!.downloadExpiresInSeconds, 3600);
    const downloadToken = downloadUrl.split("/").pop()!;
    const get = (token: string, headers?: Record<string, string>) =>
      files.GET(new Request(downloadUrl, { headers }), {
        params: Promise.resolve({ token }),
      });
    const file = await get(downloadToken);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "video/mp4");
    assert.equal(file.headers.get("cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), video);
    // It can be fetched again and in ranges while it lasts.
    const part = await get(downloadToken, { range: "bytes=0-2" });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), "not");
    // A wrong or altered token, or an upload link, downloads nothing.
    assert.equal((await get(`${downloadToken.slice(0, -1)}x`)).status, 404);
    assert.equal((await get("rll_short")).status, 404);
    const listed = await call(token, "list_exports", { project_id: projectId });
    assert.deepEqual(listed.structuredContent!.exports, [
      {
        jobId,
        status: "completed",
        createdAt: (
          listed.structuredContent!.exports as { createdAt: string }[]
        )[0].createdAt,
        downloadable: true,
      },
    ]);
    // Another studio cannot get a link for this export.
    const foreign = await call(strangerToken, "get_download_link", {
      job_id: jobId,
    });
    assert.equal(foreign.isError, true);
    // Links stop working when their time is up.
    const store = new Database(path.join(root, "data", "studio.sqlite"));
    store.prepare("UPDATE mcp_links SET expires_at=?").run(Date.now() - 1000);
    store.close();
    assert.equal((await get(downloadToken)).status, 404);
  },
);
test("apps connect by OAuth: discovery, registration, PKCE consent, tokens and refresh", async () => {
  const metadata =
    await import("../src/app/.well-known/oauth-protected-resource/route");
  const server =
    await import("../src/app/.well-known/oauth-authorization-server/route");
  const register = await import("../src/app/api/oauth/register/route");
  const approve = await import("../src/app/api/oauth/authorize/route");
  const exchange = await import("../src/app/api/oauth/token/route");
  // The endpoint's challenge points to the metadata, which names the server.
  const missing = await rpc(null, "ping");
  assert.match(
    missing.response.headers.get("www-authenticate")!,
    /resource_metadata="http:\/\/127\.0\.0\.1:3001\/\.well-known\/oauth-protected-resource"/,
  );
  const resource = await (
    await metadata.GET(
      new Request(`${origin}/.well-known/oauth-protected-resource`),
    )
  ).json();
  assert.equal(resource.resource, `${origin}/api/mcp`);
  const as = await server
    .GET(new Request(`${origin}/.well-known/oauth-authorization-server`))
    .json();
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  // Registration accepts HTTPS or loopback redirects only.
  const bad = await register.POST(
    new Request(`${origin}/api/oauth/register`, {
      method: "POST",
      body: JSON.stringify({
        client_name: "Evil",
        redirect_uris: ["http://evil.example/cb"],
      }),
    }),
  );
  assert.equal(bad.status, 400);
  const registered = await (
    await register.POST(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        body: JSON.stringify({
          client_name: "Claude",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        }),
      }),
    )
  ).json();
  const clientId = registered.client_id as string;
  // Registration needs no sign-in, so it is bounded: 30 an hour, and
  // registrations that never connected are forgotten after a day.
  const registerAgain = () =>
    register.POST(
      new Request(`${origin}/api/oauth/register`, {
        method: "POST",
        body: JSON.stringify({
          client_name: "Flood",
          redirect_uris: ["https://flood.example/cb"],
        }),
      }),
    );
  for (let i = 0; i < 29; i++)
    assert.equal((await registerAgain()).status, 201);
  const refused = await registerAgain();
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "3600");
  {
    const studio = new Database(path.join(root, "data", "studio.sqlite"));
    studio
      .prepare("UPDATE oauth_clients SET created_at=? WHERE name='Flood'")
      .run(new Date(Date.now() - 2 * 86400000).toISOString());
    assert.equal((await registerAgain()).status, 201);
    assert.equal(
      (
        studio.prepare("SELECT count(*) AS n FROM oauth_clients").get() as {
          n: number;
        }
      ).n,
      2,
    );
    studio.close();
  }
  const verifier = randomBytes(32).toString("base64url");
  const challenge = (await import("node:crypto"))
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const decide = (
    decision: string,
    redirect = "https://claude.ai/api/mcp/auth_callback",
  ) =>
    approve.POST(
      new Request(`${origin}/api/oauth/authorize`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:3001",
          origin,
          cookie: owner,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirect,
          code_challenge: challenge,
          state: "s1",
          decision,
        }),
      }),
      none,
    );
  // An unregistered redirect is refused; a denial is reported to the app.
  assert.equal((await decide("allow", "https://evil.example/cb")).status, 400);
  const denied = new URL((await decide("deny")).headers.get("location")!);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  // Only a signed-in owner can approve.
  const anonymous = await approve.POST(
    new Request(`${origin}/api/oauth/authorize`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3001",
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: challenge,
        decision: "allow",
      }),
    }),
    none,
  );
  assert.equal(anonymous.status, 401);
  const allowed = new URL((await decide("allow")).headers.get("location")!);
  assert.equal(allowed.searchParams.get("state"), "s1");
  const code = allowed.searchParams.get("code")!;
  const token = (body: Record<string, string>) =>
    exchange.POST(
      new Request(`${origin}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
    );
  // A wrong verifier fails and burns the code.
  const wrong = await token({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_verifier: randomBytes(32).toString("base64url"),
  });
  assert.equal(wrong.status, 400);
  const again = await token({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: "https://claude.ai/api/mcp/auth_callback",
    code_verifier: verifier,
  });
  assert.equal(again.status, 400);
  // A fresh approval with the right verifier yields tokens that work.
  const code2 = new URL(
    (await decide("allow")).headers.get("location")!,
  ).searchParams.get("code")!;
  const issued = await (
    await token({
      grant_type: "authorization_code",
      code: code2,
      client_id: clientId,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_verifier: verifier,
    })
  ).json();
  assert.equal(issued.token_type, "Bearer");
  assert.equal(issued.expires_in, 3600);
  assert.equal((await rpc(issued.access_token, "ping")).response.status, 200);
  const listed = await (await tokens.GET(session(owner, "GET"), none)).json();
  assert(
    listed.tokens.some(
      (t: { kind: string; name: string }) =>
        t.kind === "app" && t.name === "Claude",
    ),
  );
  // Refresh rotates both tokens; the old ones stop working.
  const renewed = await (
    await token({
      grant_type: "refresh_token",
      refresh_token: issued.refresh_token,
      client_id: clientId,
    })
  ).json();
  assert.equal((await rpc(renewed.access_token, "ping")).response.status, 200);
  assert.equal((await rpc(issued.access_token, "ping")).response.status, 401);
  assert.equal(
    (
      await token({
        grant_type: "refresh_token",
        refresh_token: issued.refresh_token,
        client_id: clientId,
      })
    ).status,
    400,
  );
  // Disconnecting in settings ends the connection.
  const app = listed.tokens.find((t: { kind: string }) => t.kind === "app");
  await tokens.DELETE(session(owner, "DELETE", { id: app.id }), none);
  assert.equal((await rpc(renewed.access_token, "ping")).response.status, 401);
});
