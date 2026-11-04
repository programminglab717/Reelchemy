import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-mail-api-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  REELCHEMY_MAIL_PENDING_COUNT: "1",
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const { getAuth } = await import("../src/lib/auth"),
  { POST } = await import("../src/app/api/auth/[...all]/route");
after(() => rm(root, { recursive: true, force: true }));
const origin = "http://127.0.0.1:3001";
function resend(email: string, source = origin) {
  return POST(
    new Request(origin + "/api/auth/send-verification-email", {
      method: "POST",
      headers: { origin: source, "content-type": "application/json" },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
}
test("unavailable account mail returns a fixed private retryable response and recovers after actual expired queue cleanup", async () => {
  const email = "mail-api-maker@example.test",
    password = "Synthetic-mail-api-passphrase-4826",
    auth = await getAuth();
  const signup = await auth.api.signUpEmail({
      body: { email, password, name: "Mail API" },
    }),
    directory = path.join(root, "auth/mail"),
    files = (await readdir(directory)).filter((file) =>
      /^[a-f0-9-]{36}\.json$/.test(file),
    );
  assert.equal(files.length, 1);
  const file = path.join(directory, files[0]),
    bytes = await readFile(file),
    full = await resend(email);
  assert.equal(full.status, 503);
  assert.equal(full.headers.get("retry-after"), "30");
  assert.match(full.headers.get("cache-control") || "", /private.*no-store/);
  const body = await full.json();
  assert.deepEqual(body, {
    code: "ACCOUNT_MAIL_UNAVAILABLE",
    message: "Account mail is temporarily unavailable. Try again later.",
  });
  for (const secret of [email, password, signup.user.id, root])
    assert(!JSON.stringify(body).includes(secret));
  assert.deepEqual(await readFile(file), bytes);
  const rejected = await resend(email, "https://other.example.test");
  assert.equal(rejected.status, 403);
  assert.deepEqual(await readFile(file), bytes);
  const item = JSON.parse(bytes.toString());
  await writeFile(
    file,
    JSON.stringify({
      ...item,
      createdAt: new Date(Date.now() - 3600001).toISOString(),
    }),
  );
  const recovered = await resend(email);
  assert.equal(recovered.status, 200);
  const next = (await readdir(directory)).filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  );
  assert.equal(next.length, 1);
  assert.notEqual(next[0], files[0]);
  const queued = JSON.parse(
    await readFile(path.join(directory, next[0]), "utf8"),
  );
  assert.equal(queued.accountId, signup.user.id);
  assert.equal(queued.to, email);
  assert.equal(queued.attempts, 0);
});
