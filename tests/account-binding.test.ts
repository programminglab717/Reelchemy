import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-account-binding-"));
process.env.REELCHEMY_DATA_DIR = path.join(dir, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(dir, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.EMAIL_DELIVERY = "file";
const { getAuth } = await import("../src/lib/auth");
const { GET, POST } = await import("../src/app/api/projects/route");
const { POST: authPOST, GET: authGET } =
  await import("../src/app/api/auth/[...all]/route");
const app = await import("../src/lib/db");
const auth = await getAuth();
after(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function account(label: string) {
  const email = `${label}@example.test`,
    password = "Private-synthetic-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: label, email, password },
  });
  const db = new Database(
    path.join(process.env.REELCHEMY_AUTH_DIR!, "auth.sqlite"),
  );
  db.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').run(
    signup.user.id,
  );
  db.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  return {
    id: signup.user.id,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
const ctx = { params: Promise.resolve({}) };
function request(
  cookie: string,
  expected?: string,
  method = "GET",
  url = "/api/projects",
) {
  return new Request(`http://127.0.0.1:3001${url}`, {
    method,
    headers: {
      cookie,
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      "content-type": "application/json",
      ...(expected !== undefined ? { [ACCOUNT_HEADER]: expected } : {}),
    },
    ...(method === "POST"
      ? {
          body: JSON.stringify({
            prompt: "Private studio",
            blank: true,
            duration: 5,
            format: "landscape",
          }),
        }
      : {}),
  });
}
test("stale account headers fail before workspace creation, quota consumption and handler execution", async () => {
  const a = await account("binding-a"),
    b = await account("binding-b");
  const db = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
  );
  try {
    for (const expected of [a.id, "", "unknown"]) {
      for (const [method, handler] of [
        ["GET", GET],
        ["POST", POST],
      ] as const) {
        const response = await handler(
          request(b.cookie, expected, method),
          ctx,
        );
        assert.equal(response.status, 409);
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        assert.deepEqual(await response.json(), {
          error:
            "The account in this browser changed. Download any unsaved work, then reload to continue.",
          code: "ACCOUNT_CHANGED",
        });
      }
    }
    assert.equal(
      (db.prepare("SELECT count(*) n FROM workspaces").get() as { n: number })
        .n,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) n FROM request_limits").get() as {
          n: number;
        }
      ).n,
      0,
    );
    assert.equal((await GET(request("", a.id), ctx)).status, 401);
    const created = await POST(request(b.cookie, b.id, "POST"), ctx);
    assert.equal(created.status, 201);
    assert.equal(
      (await (await GET(request(b.cookie, b.id), ctx)).json()).length,
      1,
    );
    // Compatibility headers cannot change authority or expose the other owner.
    assert.equal((await (await GET(request(a.cookie), ctx)).json()).length, 0);
    assert.equal((await GET(request(a.cookie, b.id), ctx)).status, 409);
    assert.equal(app.listProjects(app.ensureWorkspace(b.id, "b").id).length, 1);
  } finally {
    db.close();
  }
});
test("a stale sign-out cannot revoke or clear the newly signed-in account's session", async () => {
  const a = await account("signout-a"),
    b = await account("signout-b");
  const stale = await authPOST(
    request(b.cookie, a.id, "POST", "/api/auth/sign-out"),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.getSetCookie().length, 0);
  assert.equal(
    (await auth.api.getSession({ headers: { cookie: b.cookie } }))?.user.id,
    b.id,
  );
  const own = await authPOST(
    request(b.cookie, b.id, "POST", "/api/auth/sign-out"),
  );
  assert.equal(own.status, 200);
  assert.equal(
    await auth.api.getSession({ headers: { cookie: b.cookie } }),
    null,
  );
  assert.equal(
    (await auth.api.getSession({ headers: { cookie: a.cookie } }))?.user.id,
    a.id,
  );
});

test("bound auth session reads never return the newly signed-in account to a stale tab", async () => {
  const a = await account("auth-read-a"),
    b = await account("auth-read-b");
  const stale = await authGET(
    request(b.cookie, a.id, "GET", "/api/auth/get-session"),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("Cache-Control"), "private, no-store");
  assert.equal(stale.headers.getSetCookie().length, 0);
  const text = await stale.text();
  assert.ok(!text.includes(b.id));
  assert.ok(!text.includes("auth-read-b@example.test"));
  assert.equal(JSON.parse(text).code, "ACCOUNT_CHANGED");
  const own = await authGET(
    request(b.cookie, b.id, "GET", "/api/auth/get-session"),
  );
  assert.equal(own.status, 200);
  assert.equal((await own.json()).user.id, b.id);
  const unbound = await authGET(
    request(b.cookie, undefined, "GET", "/api/auth/get-session"),
  );
  assert.equal(unbound.status, 200);
  assert.equal((await unbound.json()).user.id, b.id);
});

test("all bound auth mutations reject a changed account before body reads or session/profile changes", async () => {
  const a = await account("auth-write-a"),
    b = await account("auth-write-b");
  for (const endpoint of [
    "update-user",
    "change-password",
    "revoke-other-sessions",
    "revoke-sessions",
  ]) {
    let read = false;
    const req = new Request(`http://127.0.0.1:3001/api/auth/${endpoint}`, {
      method: "POST",
      headers: request(b.cookie, a.id).headers,
      body: new ReadableStream(
        {
          pull() {
            read = true;
            throw new Error("A stale auth body must not be read");
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit);
    const response = await authPOST(req);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "ACCOUNT_CHANGED");
    assert.equal(read, false);
    assert.equal(response.headers.getSetCookie().length, 0);
    const session = await auth.api.getSession({
      headers: { cookie: b.cookie },
    });
    assert.equal(session?.user.id, b.id);
    assert.equal(session?.user.name, "auth-write-b");
  }
  const headers = request(b.cookie, b.id).headers;
  const own = await authPOST(
    new Request("http://127.0.0.1:3001/api/auth/update-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Updated owned profile" }),
    }),
  );
  assert.equal(own.status, 200);
  assert.equal(
    (await auth.api.getSession({ headers: { cookie: b.cookie } }))?.user.name,
    "Updated owned profile",
  );
});

test("expired bound auth reads and writes fail privately without reading a body", async () => {
  for (const [method, handler] of [
    ["GET", authGET],
    ["POST", authPOST],
  ] as const) {
    const response = await handler(
      request(
        "",
        "expired-account",
        method,
        method === "GET" ? "/api/auth/get-session" : "/api/auth/sign-out",
      ),
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "ACCOUNT_EXPIRED");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("an interrupted auth JSON body closes its reader and never invokes the requested account change", async () => {
  const a = await account("auth-interrupted");
  const controller = new AbortController();
  controller.abort();
  let stopped = false;
  const req = new Request("http://127.0.0.1:3001/api/auth/update-user", {
    method: "POST",
    headers: request(a.cookie, a.id).headers,
    signal: controller.signal,
    body: new ReadableStream(
      {
        cancel() {
          stopped = true;
        },
      },
      { highWaterMark: 0 },
    ),
    duplex: "half",
  } as RequestInit);
  const response = await authPOST(req);
  assert.equal(response.status, 408);
  assert.equal(stopped, true);
  assert.deepEqual(await response.json(), {
    error: "Authentication request did not finish. Try again.",
  });
  assert.equal(
    (await auth.api.getSession({ headers: { cookie: a.cookie } }))?.user.name,
    "auth-interrupted",
  );
});
