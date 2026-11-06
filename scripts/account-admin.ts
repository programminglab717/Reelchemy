// Operator account tools for a private installation, run where the web
// service's environment is available (e.g. `docker compose exec -T web`):
//   npm run account:create -- --email you@example.com --name "Your name" --password-stdin
//   npm run account:password -- --email you@example.com --password-stdin
// The password is read from standard input, never from arguments or the
// environment, so it does not appear in shell history or process listings.
// Creation marks the address verified, works when public sign-up is closed
// and does not depend on mail delivery. Password changes revoke every session.
export {};
const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string | true>();
for (let i = 0; i < rest.length; i++) {
  const flag = rest[i];
  if (flag === "--password-stdin") flags.set(flag, true);
  else if ((flag === "--email" || flag === "--name") && rest[i + 1])
    flags.set(flag, rest[++i]);
  else flags.set("invalid", true);
}
const email = String(flags.get("--email") || "")
  .trim()
  .toLowerCase();
const name = String(flags.get("--name") || "").trim();
if (
  !["create", "password"].includes(command) ||
  flags.has("invalid") ||
  !flags.get("--password-stdin") ||
  !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) ||
  (command === "create" && (name.length < 1 || name.length > 100))
) {
  console.error(
    "Usage: account-admin create --email ADDRESS --name NAME --password-stdin\n       account-admin password --email ADDRESS --password-stdin",
  );
  process.exit(64);
}
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk as Buffer);
  if (Buffer.concat(chunks).length > 4096) {
    console.error("Password input is too long.");
    process.exit(64);
  }
}
const password = Buffer.concat(chunks)
  .toString("utf8")
  .replace(/\r?\n$/, "");
if (password.length < 12 || password.length > 128) {
  console.error("Use a password of 12–128 characters.");
  process.exit(64);
}
// This operator process may create accounts even when public sign-up is off.
process.env.REELCHEMY_PUBLIC_SIGNUP = "true";
const { getAuth } = await import("../src/lib/auth");
const auth = await getAuth();
const context = await auth.$context;
const existing = await context.internalAdapter.findUserByEmail(email);
try {
  if (command === "create") {
    if (existing) {
      console.error("An account with this email already exists.");
      process.exit(65);
    }
    const created = await auth.api.signUpEmail({
      body: { name, email, password },
    });
    await context.internalAdapter.updateUser(created.user.id, {
      emailVerified: true,
    });
    console.log(
      JSON.stringify({
        created: true,
        verified: true,
        userId: created.user.id,
      }),
    );
  } else {
    if (!existing) {
      console.error("No account uses this email.");
      process.exit(65);
    }
    const hash = await context.password.hash(password);
    await context.internalAdapter.updatePassword(existing.user.id, hash);
    await context.internalAdapter.deleteUserSessions(existing.user.id);
    console.log(
      JSON.stringify({ passwordChanged: true, sessionsRevoked: true }),
    );
  }
} catch (error) {
  console.error(
    error instanceof Error && /mail/i.test(error.message)
      ? "The account action could not queue its email. Check mail configuration."
      : "The account action failed.",
  );
  process.exit(1);
}
