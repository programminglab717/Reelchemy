import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { deliverMail, mailConfig } from "./mail";
import { authStorageDirectory } from "./auth-storage";
function signingSecret(dir: string) {
  if (process.env.BETTER_AUTH_SECRET) {
    if (process.env.BETTER_AUTH_SECRET.length < 32)
      throw new Error(
        "Authentication signing secret must be at least 32 characters.",
      );
    return process.env.BETTER_AUTH_SECRET;
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("Production authentication requires BETTER_AUTH_SECRET.");
  const file = path.join(dir, "auth-secret");
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    try {
      writeFileSync(file, randomBytes(48).toString("base64url"), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return readFileSync(file, "utf8");
  }
}
function createAuth() {
  mailConfig();
  const baseURL = process.env.BETTER_AUTH_URL || "http://127.0.0.1:3001";
  if (process.env.NODE_ENV === "production" && !baseURL.startsWith("https://"))
    throw new Error(
      "Production authentication requires an HTTPS BETTER_AUTH_URL.",
    );
  const dir = authStorageDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const authFile = path.join(dir, "auth.sqlite");
  const database = new Database(authFile);
  for (const file of [authFile, authFile + "-wal", authFile + "-shm"]) {
    try {
      chmodSync(file, 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return betterAuth({
    database,
    baseURL,
    secret: signingSecret(dir),
    trustedOrigins: [new URL(baseURL).origin],
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      sendResetPassword: async ({ user, url }) => {
        await deliverMail({
          to: user.email,
          subject: "Reset your Reelchemy password",
          text: `Reset your password using this private link: ${url}`,
        });
      },
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverMail({
          to: user.email,
          subject: "Verify your Reelchemy email",
          text: `Verify your account using this private link: ${url}`,
        });
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
      },
    },
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    },
  });
}
let instance: ReturnType<typeof createAuth> | undefined,
  ready: Promise<ReturnType<typeof createAuth>> | undefined;
export async function getAuth() {
  return (ready ??= Promise.resolve()
    .then(async () => {
      instance ??= createAuth();
      if (process.env.NODE_ENV !== "production") {
        const migrations = await getMigrations(instance.options);
        await migrations.runMigrations();
      }
      return instance;
    })
    .catch((e) => {
      ready = undefined;
      throw e;
    }));
}
export async function migrateAuth() {
  instance ??= createAuth();
  const migrations = await getMigrations(instance.options);
  await migrations.runMigrations();
}
