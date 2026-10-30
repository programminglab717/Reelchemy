import Database from "better-sqlite3";
import path from "node:path";
import { ensureWorkspace, claimLegacyProjects } from "../src/lib/db";
import { authStorageDirectory } from "../src/lib/auth-storage";
const email = process.argv.find((a) => a.startsWith("--email="))?.slice(8);
if (!email)
  throw new Error(
    "Provide --email=<verified account>. Default is a dry run; add --apply to assign unowned legacy projects.",
  );
const auth = new Database(path.join(authStorageDirectory(), "auth.sqlite"), {
  readonly: true,
});
const user = auth
  .prepare("SELECT id,name,emailVerified FROM user WHERE email=?")
  .get(email) as
  { id: string; name: string; emailVerified: number } | undefined;
if (!user?.emailVerified)
  throw new Error("A verified account with that address is required.");
const workspace = ensureWorkspace(user.id, user.name),
  apply = process.argv.includes("--apply");
console.log(
  JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    legacyProjects: claimLegacyProjects(workspace.id, apply),
  }),
);
