import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";

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
