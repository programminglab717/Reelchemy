import { enableSecureDeletion } from "./sqlite-private";
import Database from "better-sqlite3";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  lstatSync,
  renameSync,
  unlinkSync,
  opendirSync,
  chmodSync,
} from "node:fs";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import type { recordErasureApproval } from "./privacy-vault";
import path from "node:path";
import { z } from "zod";
import { withPrivateDirectory } from "./private-directory";
import { authStorageDirectory } from "./auth-storage";
import {
  MAIL_RECORD_BYTES,
  MAIL_LIFETIME_MS,
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  mailPolicy,
  MailCapacity,
  MailUnavailable,
} from "./mail-policy";

const uuidFile =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const temporaryFile = /^\.mail-[a-f0-9-]{36}\.tmp$/;
const messageSchema = z
  .object({
    to: z
      .email()
      .max(320)
      .refine((value) => !/[\r\n\0]/.test(value)),
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n\0]/.test(value)),
    text: z
      .string()
      .min(1)
      .refine(
        (value) =>
          Buffer.byteLength(value) <= 32 * 1024 && !value.includes("\0"),
      ),
    accountId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type Mail = z.infer<typeof messageSchema>;
const recordSchema = messageSchema
  .extend({
    createdAt: z.iso.datetime(),
    attempts: z.number().int().min(0).max(MAIL_MAX_ATTEMPTS),
    nextAttemptAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    leaseToken: z.uuid().optional(),
    leaseUntil: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    (value) =>
      (value.leaseToken === undefined) === (value.leaseUntil === undefined),
  );
type Record = z.infer<typeof recordSchema>;
type Entry = { name: string; bytes: number; directory?: true };
export type MailClaim = { name: string; token: string; mail: Mail };

function regular(file: string) {
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1) throw new MailUnavailable();
  return info;
}
export function readPrivateMailJson(
  anchor: string,
  name: string,
  maximum = MAIL_RECORD_BYTES,
): unknown {
  if (name.startsWith("failed/")) {
    const child = name.slice(7);
    if (!uuidFile.test(child)) throw new MailUnavailable();
    return withPrivateDirectory(anchor, "failed", (directory) =>
      readPrivateMailJson(directory, child, maximum),
    );
  }
  if (
    !uuidFile.test(name) &&
    !["worker.lock", "heartbeat.json", "suppression-key.json"].includes(name)
  )
    throw new MailUnavailable();
  const target = path.join(anchor, name),
    info = regular(target);
  if (info.size < 1 || info.size > maximum) throw new MailUnavailable();
  const fd = openSync(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.ino !== info.ino ||
      opened.dev !== info.dev ||
      opened.size !== info.size
    )
      throw new MailUnavailable();
    const buffer = Buffer.alloc(info.size + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length !== info.size) throw new MailUnavailable();
    const value: unknown = JSON.parse(
      buffer.subarray(0, length).toString("utf8"),
    );
    const after = regular(target),
      final = fstatSync(fd);
    if (
      after.ino !== opened.ino ||
      after.dev !== opened.dev ||
      final.size !== opened.size ||
      final.mtimeMs !== opened.mtimeMs ||
      final.ctimeMs !== opened.ctimeMs
    )
      throw new MailUnavailable();
    return value;
  } finally {
    closeSync(fd);
  }
}
function readRecord(anchor: string, name: string): Record {
  return recordSchema.parse(readPrivateMailJson(anchor, name));
}
export function publishPrivateMailJson(
  anchor: string,
  name: string,
  value: unknown,
) {
  if (
    !uuidFile.test(name) &&
    !["worker.lock", "heartbeat.json", "suppression-key.json"].includes(name)
  )
    throw new MailUnavailable();
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAIL_RECORD_BYTES) throw new MailUnavailable();
  const temporary = path.join(anchor, `.mail-${randomUUID()}.tmp`);
  try {
    const fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, body);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path.join(anchor, name));
    const directory = openSync(
      anchor,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function publish(anchor: string, name: string, value: Record) {
  publishPrivateMailJson(anchor, name, value);
}

// A SQLite writer transaction serializes cooperating producers and consumers.
// Message files are atomically published; SQLite contains no addresses or links.
// No filesystem operation relies on rolling back a SQL change after a crash.
export function mailDirectoryTransaction<T>(
  operation: (anchor: string, db: Database.Database) => T,
  existing = false,
): T {
  try {
    mailPolicy();
    // Concurrent first use can see SQLITE_BUSY from connection setup (journal
    // mode/schema statements) outside the busy-timeout write transaction.
    // Retry only failures before the operation began; work inside the
    // immediate transaction is never repeated.
    for (let attempt = 0; ; attempt++) {
      let started = false;
      try {
        return mailDirectoryAttempt(operation, existing, () => {
          started = true;
        });
      } catch (error) {
        if (
          started ||
          attempt >= 5 ||
          (error as { code?: string }).code !== "SQLITE_BUSY"
        )
          throw error;
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          20 + Math.floor(Math.random() * 40) * (attempt + 1),
        );
      }
    }
  } catch (error) {
    if (error instanceof MailCapacity) throw error;
    throw new MailUnavailable();
  }
}
function mailDirectoryAttempt<T>(
  operation: (anchor: string, db: Database.Database) => T,
  existing: boolean,
  begin: () => void,
): T {
  return withPrivateDirectory(
    authStorageDirectory(),
    "mail",
    (anchor) => {
      for (const name of [
        "outbox.sqlite",
        "outbox.sqlite-wal",
        "outbox.sqlite-shm",
      ]) {
        try {
          regular(path.join(anchor, name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      const database = new Database(path.join(anchor, "outbox.sqlite"), {
        fileMustExist: existing,
      });
      try {
        if (!existing) chmodSync(path.join(anchor, "outbox.sqlite"), 0o600);
        database.pragma("busy_timeout=5000");
        enableSecureDeletion(database);
        if (!existing) database.pragma("journal_mode=WAL");
        if (!existing) database.pragma("synchronous=FULL");
        if (!existing)
          database.exec(
            "CREATE TABLE IF NOT EXISTS mail_counters(id INTEGER PRIMARY KEY CHECK(id=1),discarded INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO mail_counters(id) VALUES(1)",
          );
        if (!existing) migrateMailSuppressions(database);
        return database
          .transaction(() => {
            begin();
            return operation(anchor, database);
          })
          .immediate();
      } finally {
        database.close();
      }
    },
    !existing,
  );
}
const locked = mailDirectoryTransaction;
function entries(anchor: string, cleanTemporary = true): Entry[] {
  const result: Entry[] = [],
    directory = opendirSync(anchor);
  let seen = 0;
  try {
    for (let item = directory.readSync(); item; item = directory.readSync()) {
      if (++seen > 4100) throw new MailUnavailable();
      const target = path.join(anchor, item.name);
      if (uuidFile.test(item.name)) {
        const info = regular(target);
        if (info.size > MAIL_RECORD_BYTES) throw new MailUnavailable();
        result.push({ name: item.name, bytes: info.size });
      } else if (temporaryFile.test(item.name)) {
        regular(target);
        if (cleanTemporary) unlinkSync(target); // No other cooperating writer holds this mutex.
      } else if (item.name === "failed") {
        if (!lstatSync(target).isDirectory()) throw new MailUnavailable();
        const failures = opendirSync(target);
        try {
          for (
            let failure = failures.readSync();
            failure;
            failure = failures.readSync()
          ) {
            if (++seen > 4100 || !uuidFile.test(failure.name))
              throw new MailUnavailable();
            const name = `failed/${failure.name}`,
              info = regular(path.join(anchor, name));
            if (info.size > MAIL_RECORD_BYTES) throw new MailUnavailable();
            result.push({ name, bytes: info.size, directory: true });
          }
        } finally {
          failures.closeSync();
        }
      } else if (
        [
          "outbox.sqlite",
          "outbox.sqlite-wal",
          "outbox.sqlite-shm",
          "worker.lock",
          "worker.lifecycle.lock",
          "heartbeat.json",
          "suppression-key.json",
        ].includes(item.name)
      ) {
        regular(target);
      } else throw new MailUnavailable();
    }
  } finally {
    directory.closeSync();
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
function expired(item: Record, now: number) {
  const created = Date.parse(item.createdAt);
  if (
    created > now + 60000 ||
    item.nextAttemptAt > created + MAIL_LIFETIME_MS + 300000 ||
    (item.leaseUntil !== undefined &&
      (item.leaseUntil > now + MAIL_LEASE_MS + 60000 ||
        item.leaseUntil > created + MAIL_LIFETIME_MS + MAIL_LEASE_MS + 60000 ||
        item.attempts < 1))
  )
    throw new MailUnavailable();
  return (
    now - created >= MAIL_LIFETIME_MS || item.attempts >= MAIL_MAX_ATTEMPTS
  );
}
function chargedBytes(item: Record) {
  const body: Mail = {
    to: item.to,
    subject: item.subject,
    text: item.text,
    ...(item.accountId ? { accountId: item.accountId } : {}),
  };
  // Reserve lease/enqueue-attempt growth up front, so a full queue can drain.
  return Buffer.byteLength(JSON.stringify(body)) + 256;
}
function removeMail(anchor: string, name: string): void {
  if (name.startsWith("failed/")) {
    const child = name.slice(7);
    if (!uuidFile.test(child)) throw new MailUnavailable();
    return withPrivateDirectory(anchor, "failed", (directory) =>
      removeMail(directory, child),
    );
  }
  if (!uuidFile.test(name)) throw new MailUnavailable();
  unlinkSync(path.join(anchor, name));
  const directory = openSync(
    anchor,
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function prune(
  anchor: string,
  db: Database.Database,
  rows: Entry[],
  now: number,
) {
  const retained: Entry[] = [];
  let discarded = 0;
  for (const row of rows) {
    const item = readRecord(anchor, row.name);
    if (
      (expired(item, now) ||
        suppressionState(anchor, db, item) === "approved") &&
      (!item.leaseUntil || item.leaseUntil <= now)
    ) {
      removeMail(anchor, row.name);
      discarded++;
    } else retained.push(row);
  }
  if (discarded)
    db.prepare("UPDATE mail_counters SET discarded=discarded+? WHERE id=1").run(
      discarded,
    );
  return retained;
}
export function enqueueMail(mail: Mail) {
  const parsed = messageSchema.safeParse(mail);
  if (!parsed.success) throw new MailUnavailable();
  return locked((anchor, db) => {
    const now = Date.now(),
      rows = prune(anchor, db, entries(anchor), now),
      policy = mailPolicy();
    const item: Record = {
      ...parsed.data,
      createdAt: new Date(now).toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
    };
    if (suppressionState(anchor, db, item) === "approved")
      throw new MailUnavailable();
    const bytes = chargedBytes(item);
    if (
      rows.length >= policy.count ||
      rows.reduce(
        (sum, row) => sum + chargedBytes(readRecord(anchor, row.name)),
        0,
      ) +
        bytes >
        policy.bytes
    )
      throw new MailCapacity();
    let recipient = 0;
    for (const row of rows)
      if (
        readRecord(anchor, row.name).to.toLowerCase() === item.to.toLowerCase()
      )
        recipient++;
    if (recipient >= 5) throw new MailCapacity();
    publish(anchor, `${randomUUID()}.json`, item);
  });
}
export function claimMail(now = Date.now()): MailClaim | undefined {
  return locked((anchor, db) => {
    for (const row of prune(anchor, db, entries(anchor), now)) {
      if (row.directory) continue; // Legacy failures await bounded expiry; never silently resend.
      const item = readRecord(anchor, row.name);
      if (
        item.nextAttemptAt > now ||
        (item.leaseUntil ?? 0) > now ||
        suppressionState(anchor, db, item) !== "none"
      )
        continue;
      const token = randomUUID();
      publish(anchor, row.name, {
        ...item,
        attempts: item.attempts + 1,
        leaseToken: token,
        leaseUntil: now + MAIL_LEASE_MS,
      });
      return {
        name: row.name,
        token,
        mail: {
          to: item.to,
          subject: item.subject,
          text: item.text,
          ...(item.accountId ? { accountId: item.accountId } : {}),
        },
      };
    }
  });
}
export function settleMail(claim: MailClaim, sent: boolean, now = Date.now()) {
  return locked((anchor, db) => {
    if (!uuidFile.test(claim.name)) throw new MailUnavailable();
    let item: Record;
    try {
      item = readRecord(anchor, claim.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (item.leaseToken !== claim.token) return false;
    if (sent) removeMail(anchor, claim.name);
    else {
      const attempts = item.attempts;
      if (
        suppressionState(anchor, db, item) === "approved" ||
        attempts >= MAIL_MAX_ATTEMPTS ||
        now - Date.parse(item.createdAt) >= MAIL_LIFETIME_MS
      ) {
        removeMail(anchor, claim.name);
        db.prepare(
          "UPDATE mail_counters SET discarded=discarded+1 WHERE id=1",
        ).run();
      } else {
        const { leaseToken: _token, leaseUntil: _until, ...rest } = item;
        void _token;
        void _until;
        publish(anchor, claim.name, {
          ...rest,
          attempts,
          nextAttemptAt: now + Math.min(300000, 30000 * 2 ** (attempts - 1)),
        });
      }
    }
    return true;
  });
}
export function mailOutboxStatus(now = Date.now()) {
  return locked((anchor, db) => {
    const rows = entries(anchor, false),
      policy = mailPolicy();
    let leased = 0,
      due = 0,
      oldestAgeMs = 0,
      paused = 0,
      suppressed = 0;
    for (const row of rows) {
      const item = readRecord(anchor, row.name);
      expired(item, now); // Validate timing even when this record is leased.
      const suppression = suppressionState(anchor, db, item);
      if (suppression === "preparing") paused++;
      if (suppression === "approved") suppressed++;
      oldestAgeMs = Math.max(
        oldestAgeMs,
        Math.max(0, now - Date.parse(item.createdAt)),
      );
      if ((item.leaseUntil ?? 0) > now) leased++;
      else if (
        !row.directory &&
        suppression === "none" &&
        !expired(item, now) &&
        item.nextAttemptAt <= now
      )
        due++;
    }
    return {
      pending: rows.length,
      bytes: rows.reduce(
        (sum, row) => sum + chargedBytes(readRecord(anchor, row.name)),
        0,
      ),
      leased,
      due,
      paused,
      suppressed,
      oldestAgeMs,
      limitCount: policy.count,
      limitBytes: policy.bytes,
      discarded: (
        db.prepare("SELECT discarded FROM mail_counters WHERE id=1").get() as {
          discarded: number;
        }
      ).discarded,
    };
  }, true);
}

export type PreparedAccountMail = {
  accountId: string;
  workspaceId: string;
  requestId: string;
};
type SuppressionRow = {
  account_id: string;
  workspace_id: string;
  request_id: string;
  email_hash: string;
  state: "preparing" | "approved";
  created_at: number;
};
const suppressionSupport = new WeakMap<Database.Database, boolean>();
function hasSuppressionTable(db: Database.Database) {
  let value = suppressionSupport.get(db);
  if (value === undefined) {
    value = !!db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_mail_suppressions'",
      )
      .get();
    suppressionSupport.set(db, value);
  }
  return value;
}
function migrateMailSuppressions(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_mail_suppressions(account_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,request_id TEXT NOT NULL UNIQUE,email_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('preparing','approved')),created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS account_mail_suppressions_email_idx ON account_mail_suppressions(email_hash,state);
 CREATE INDEX IF NOT EXISTS account_mail_suppressions_pending_idx ON account_mail_suppressions(state,created_at);
 CREATE TRIGGER IF NOT EXISTS mail_suppression_immutable BEFORE UPDATE OF account_id,workspace_id,request_id,email_hash,created_at ON account_mail_suppressions BEGIN SELECT RAISE(ABORT,'Account mail hold context is immutable.'); END;
 CREATE TRIGGER IF NOT EXISTS mail_suppression_retained BEFORE DELETE ON account_mail_suppressions WHEN OLD.state='approved' BEGIN SELECT RAISE(ABORT,'Approved account mail suppression must be retained.'); END;
 CREATE TRIGGER IF NOT EXISTS mail_suppression_final BEFORE UPDATE OF state ON account_mail_suppressions WHEN OLD.state='approved' AND NEW.state<>'approved' BEGIN SELECT RAISE(ABORT,'Approved account mail suppression cannot be withdrawn.'); END;`);
  suppressionSupport.set(db, true);
}
function mailEmailHash(
  anchor: string,
  db: Database.Database,
  email: string,
  create = false,
) {
  let encoded: unknown;
  try {
    encoded = readPrivateMailJson(anchor, "suppression-key.json", 128);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      !create ||
      db.prepare("SELECT 1 FROM account_mail_suppressions LIMIT 1").get()
    )
      throw new MailUnavailable();
    encoded = randomBytes(32).toString("base64url");
    publishPrivateMailJson(anchor, "suppression-key.json", encoded);
  }
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(encoded))
    throw new MailUnavailable();
  const key = Buffer.from(encoded, "base64url");
  try {
    if (key.length !== 32 || key.toString("base64url") !== encoded)
      throw new MailUnavailable();
    return createHmac("sha256", key)
      .update("reelchemy-mail-email-v1\0")
      .update(email.toLowerCase())
      .digest("hex");
  } finally {
    key.fill(0);
  }
}
function suppressionState(
  anchor: string,
  db: Database.Database,
  mail: Mail,
): "none" | "preparing" | "approved" {
  if (!hasSuppressionTable(db)) return "none";
  if (mail.accountId) {
    const row = db
      .prepare("SELECT state FROM account_mail_suppressions WHERE account_id=?")
      .get(mail.accountId) as { state: "preparing" | "approved" } | undefined;
    return row?.state || "none";
  }
  if (!db.prepare("SELECT 1 FROM account_mail_suppressions LIMIT 1").get())
    return "none";
  const emailHash = mailEmailHash(anchor, db, mail.to);
  if (
    db
      .prepare(
        "SELECT 1 FROM account_mail_suppressions WHERE email_hash=? AND state='approved' LIMIT 1",
      )
      .get(emailHash)
  )
    return "approved";
  return db
    .prepare(
      "SELECT 1 FROM account_mail_suppressions WHERE email_hash=? AND state='preparing' LIMIT 1",
    )
    .get(emailHash)
    ? "preparing"
    : "none";
}
function preparation(input: PreparedAccountMail) {
  const parsed = z
    .object({
      accountId: z
        .string()
        .min(1)
        .max(128)
        .refine((value) => !value.includes("\0")),
      workspaceId: z.uuid(),
      requestId: z.uuid(),
    })
    .strict()
    .safeParse(input);
  if (!parsed.success) throw new MailUnavailable();
  return parsed.data;
}
function held(db: Database.Database, input: PreparedAccountMail) {
  const row = db
    .prepare("SELECT * FROM account_mail_suppressions WHERE account_id=?")
    .get(input.accountId) as SuppressionRow | undefined;
  if (
    !row ||
    row.request_id !== input.requestId ||
    row.workspace_id !== input.workspaceId
  )
    throw new MailUnavailable();
  return row;
}
// Reversible dispatch hold only: no payload is removed before journal approval.
// Call after verified-password/actor validation; email comes from that session.
export function prepareAccountMail(input: PreparedAccountMail, email: string) {
  const context = preparation(input);
  if (!z.email().max(320).safeParse(email).success) throw new MailUnavailable();
  return locked((anchor, db) => {
    try {
      const old = readPrivateMailJson(anchor, "worker.lock", 512);
      if (typeof old === "number") throw new MailUnavailable();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const emailHash = mailEmailHash(anchor, db, email, true),
      existing = db
        .prepare("SELECT * FROM account_mail_suppressions WHERE account_id=?")
        .get(context.accountId) as SuppressionRow | undefined;
    if (existing) {
      held(db, context);
      if (existing.email_hash !== emailHash) throw new MailUnavailable();
      return context;
    }
    if (
      (
        db
          .prepare("SELECT count(*) AS n FROM account_mail_suppressions")
          .get() as { n: number }
      ).n >= 2000000
    )
      throw new MailUnavailable();
    db.prepare(
      "INSERT INTO account_mail_suppressions VALUES(?,?,?,?,'preparing',?)",
    ).run(
      context.accountId,
      context.workspaceId,
      context.requestId,
      emailHash,
      Date.now(),
    );
    return context;
  });
}
// The callback is synchronous and writes the independent signed journal.
// Both commit and recovery acquire mail -> vault, fencing a withdrawn hold.
// A crash after journal commit rolls back only this activation: the separately
// committed preparation still pauses dispatch until the private worker resumes.
export function commitPreparedAccountMail(
  input: PreparedAccountMail,
  persist: () => ReturnType<typeof recordErasureApproval>,
) {
  const context = preparation(input);
  return locked((anchor, db) => {
    held(db, context);
    const result = persist();
    if (
      result.approval.requestId !== context.requestId ||
      result.approval.workspaceId !== context.workspaceId
    )
      throw new MailUnavailable();
    db.prepare(
      "UPDATE account_mail_suppressions SET state='approved' WHERE account_id=?",
    ).run(context.accountId);
    prune(anchor, db, entries(anchor), Date.now());
    return result;
  });
}
export function resolvePreparedAccountMail(
  input: PreparedAccountMail,
  authority: () => "approved" | "absent",
  options: { now?: number; withdrawImmediately?: boolean } = {},
) {
  const context = preparation(input);
  return locked((anchor, db) => {
    const row = held(db, context);
    if (row.state === "approved") return "approved" as const;
    const proof = authority();
    if (proof === "approved") {
      db.prepare(
        "UPDATE account_mail_suppressions SET state='approved' WHERE account_id=?",
      ).run(context.accountId);
      prune(anchor, db, entries(anchor), options.now ?? Date.now());
      return "approved" as const;
    }
    if (proof !== "absent") throw new MailUnavailable();
    if (
      options.withdrawImmediately ||
      (options.now ?? Date.now()) - row.created_at >= 30000
    ) {
      db.prepare(
        "DELETE FROM account_mail_suppressions WHERE account_id=? AND state='preparing'",
      ).run(context.accountId);
      return "withdrawn" as const;
    }
    return "preparing" as const;
  });
}
export function pendingAccountMailPreparations(limit = 20) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new MailUnavailable();
  return locked(
    (_anchor, db) =>
      (
        db
          .prepare(
            "SELECT account_id,workspace_id,request_id,created_at FROM account_mail_suppressions WHERE state='preparing' ORDER BY created_at,account_id LIMIT ?",
          )
          .all(limit) as SuppressionRow[]
      ).map((row) => ({
        accountId: row.account_id,
        workspaceId: row.workspace_id,
        requestId: row.request_id,
        createdAt: row.created_at,
      })),
    true,
  );
}
export function accountMailCleanupPending(
  input: PreparedAccountMail,
  now = Date.now(),
) {
  const context = preparation(input);
  return locked((anchor, db) => {
    const row = held(db, context);
    if (row.state !== "approved") throw new MailUnavailable();
    const retained = prune(anchor, db, entries(anchor), now);
    let pending = 0;
    for (const entry of retained) {
      const item = readRecord(anchor, entry.name);
      if (
        item.accountId === context.accountId ||
        (!item.accountId &&
          mailEmailHash(anchor, db, item.to) === row.email_hash)
      )
        pending++;
    }
    return { pending };
  });
}
