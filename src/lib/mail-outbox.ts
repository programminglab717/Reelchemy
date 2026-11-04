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
import { randomUUID } from "node:crypto";
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
function readRecord(anchor: string, name: string): Record {
  const target = path.join(anchor, name),
    info = regular(target);
  if (info.size < 2 || info.size > MAIL_RECORD_BYTES)
    throw new MailUnavailable();
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
    const value = recordSchema.parse(
      JSON.parse(buffer.subarray(0, length).toString("utf8")),
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
function publish(anchor: string, name: string, value: Record) {
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

// A SQLite writer transaction serializes cooperating producers and consumers.
// Message files are atomically published; SQLite contains no addresses or links.
// No filesystem operation relies on rolling back a SQL change after a crash.
function locked<T>(operation: (anchor: string, db: Database.Database) => T): T {
  try {
    mailPolicy();
    return withPrivateDirectory(authStorageDirectory(), "mail", (anchor) => {
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
      const database = new Database(path.join(anchor, "outbox.sqlite"));
      try {
        chmodSync(path.join(anchor, "outbox.sqlite"), 0o600);
        database.pragma("busy_timeout=5000");
        database.pragma("journal_mode=WAL");
        database.pragma("synchronous=FULL");
        database.exec(
          "CREATE TABLE IF NOT EXISTS mail_counters(id INTEGER PRIMARY KEY CHECK(id=1),discarded INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO mail_counters(id) VALUES(1)",
        );
        return database
          .transaction(() => operation(anchor, database))
          .immediate();
      } finally {
        database.close();
      }
    });
  } catch (error) {
    if (error instanceof MailCapacity) throw error;
    throw new MailUnavailable();
  }
}
function entries(anchor: string): Entry[] {
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
        unlinkSync(target); // No other cooperating writer holds this mutex.
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
  if (created > now + 60000) throw new MailUnavailable();
  return (
    now - created >= MAIL_LIFETIME_MS || item.attempts >= MAIL_MAX_ATTEMPTS
  );
}
function chargedBytes(item: Record) {
  const { leaseToken: _token, leaseUntil: _until, ...body } = item;
  void _token;
  void _until;
  // Reserve lease/enqueue-attempt growth up front, so a full queue can drain.
  return Buffer.byteLength(JSON.stringify(body)) + 128;
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
    if (expired(item, now) && (!item.leaseUntil || item.leaseUntil <= now)) {
      unlinkSync(path.join(anchor, row.name));
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
      if (item.nextAttemptAt > now || (item.leaseUntil ?? 0) > now) continue;
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
    if (sent) unlinkSync(path.join(anchor, claim.name));
    else {
      const attempts = item.attempts;
      if (
        attempts >= MAIL_MAX_ATTEMPTS ||
        now - Date.parse(item.createdAt) >= MAIL_LIFETIME_MS
      ) {
        unlinkSync(path.join(anchor, claim.name));
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
    const rows = entries(anchor),
      policy = mailPolicy();
    let leased = 0,
      due = 0,
      oldestAgeMs = 0;
    for (const row of rows) {
      const item = readRecord(anchor, row.name);
      oldestAgeMs = Math.max(
        oldestAgeMs,
        Math.max(0, now - Date.parse(item.createdAt)),
      );
      if ((item.leaseUntil ?? 0) > now) leased++;
      else if (
        !row.directory &&
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
      oldestAgeMs,
      limitCount: policy.count,
      limitBytes: policy.bytes,
      discarded: (
        db.prepare("SELECT discarded FROM mail_counters WHERE id=1").get() as {
          discarded: number;
        }
      ).discarded,
    };
  });
}
