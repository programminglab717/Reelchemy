import Database from "better-sqlite3";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readSync,
  writeFileSync,
  fsyncSync,
  fchmodSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  approveErasure,
  verifyErasureApproval,
  erasureOwnerHash,
  erasureReceiptHash,
  erasureHashEqual,
  type ErasureApproval,
} from "./account-erasure-approval";
import {
  accountErasurePolicy,
  AccountErasureUnavailable,
  AccountErasureConflict,
  AccountErasureCapacity,
} from "./account-erasure-policy";
const protocol = "reelchemy-erasure-vault-v1" as const;
const applicationId = 0x52434531;
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z
  .object({
    format: z.literal(protocol),
    id: z.uuid(),
    keyFingerprint: hex,
    createdAt: z.iso.datetime(),
  })
  .strict();
const descriptorSchema = z
  .object({ directory: z.string().min(1), id: z.uuid(), keyFingerprint: hex })
  .strict();
export type PrivacyVault = z.infer<typeof descriptorSchema>;
export type ErasureState = "requested" | "cleaning" | "blocked" | "completed";
export type ErasureStatus = {
  requestId: string;
  state: ErasureState;
  requestedAt: string;
  updatedAt: string;
};
type Row = {
  id: string;
  owner_hash: string;
  workspace_id: string;
  receipt_hash: string;
  sequence: number;
  approval: string;
  state: ErasureState;
  updated_at: string;
};
const states = ["requested", "cleaning", "blocked", "completed"] as const;
function fingerprint(key: Buffer) {
  return createHash("sha256")
    .update("reelchemy-erasure-key-v1\0")
    .update(key)
    .digest("hex");
}
function root<T>(directory: string, operation: (anchor: string) => T): T {
  if (process.platform !== "linux" || !path.isAbsolute(directory))
    throw new AccountErasureUnavailable();
  const fd = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    return operation(`/proc/self/fd/${fd}`);
  } finally {
    closeSync(fd);
  }
}
function regular(file: string) {
  const info = lstatSync(file);
  if (!info.isFile() || info.nlink !== 1) throw new AccountErasureUnavailable();
  return info;
}
function read(anchor: string, name: string, maximum: number) {
  const file = path.join(anchor, name),
    before = regular(file);
  if (before.size < 1 || before.size > maximum)
    throw new AccountErasureUnavailable();
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = fstatSync(fd);
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size !== before.size ||
      !opened.isFile()
    )
      throw new AccountErasureUnavailable();
    const buffer = Buffer.alloc(before.size + 1),
      length = readSync(fd, buffer, 0, buffer.length, 0),
      after = fstatSync(fd),
      named = regular(file);
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      named.ino !== before.ino ||
      named.dev !== before.dev
    )
      throw new AccountErasureUnavailable();
    return buffer.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
function exclusiveFile(anchor: string, name: string, body: string | Buffer) {
  const fd = openSync(
    path.join(anchor, name),
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
}
function fixed<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (
      error instanceof AccountErasureConflict ||
      error instanceof AccountErasureCapacity
    )
      throw error;
    throw new AccountErasureUnavailable();
  }
}
// Explicit new-installation operation only. Read/serve/restore never calls it.
// A partial initialization is left for operator review, never silently replaced.
export function initializePrivacyVault(directory: string): PrivacyVault {
  return fixed(() => {
    if (!path.isAbsolute(directory)) throw new AccountErasureUnavailable();
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    return root(directory, (anchor) => {
      if (readdirSync(anchor).length) throw new AccountErasureConflict();
      const directoryFd = openSync(
        anchor,
        constants.O_RDONLY | constants.O_DIRECTORY,
      );
      try {
        fchmodSync(directoryFd, 0o700);
      } finally {
        closeSync(directoryFd);
      }
      const key = randomBytes(32),
        identity = {
          format: protocol,
          id: randomUUID(),
          keyFingerprint: fingerprint(key),
          createdAt: new Date().toISOString(),
        };
      try {
        exclusiveFile(anchor, "approval.key", key);
        exclusiveFile(anchor, "journal.sqlite", Buffer.alloc(0));
        const db = new Database(path.join(anchor, "journal.sqlite"), {
          fileMustExist: true,
        });
        try {
          db.pragma("journal_mode=WAL");
          db.pragma("synchronous=FULL");
          db.transaction(() => {
            db.exec(`PRAGMA application_id=${applicationId}; PRAGMA user_version=1;
       CREATE TABLE vault_identity(id TEXT PRIMARY KEY,key_fingerprint TEXT NOT NULL,format TEXT NOT NULL);
       CREATE TABLE erasure_approvals(id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL UNIQUE,receipt_hash TEXT NOT NULL,sequence INTEGER NOT NULL UNIQUE CHECK(sequence>0),approval TEXT NOT NULL CHECK(length(CAST(approval AS BLOB))<=2048),state TEXT NOT NULL CHECK(state IN ('requested','cleaning','blocked','completed')),updated_at TEXT NOT NULL);
       CREATE INDEX erasure_approvals_pending_idx ON erasure_approvals(state,sequence);
       CREATE TRIGGER erasure_approval_immutable BEFORE UPDATE OF id,owner_hash,workspace_id,receipt_hash,sequence,approval ON erasure_approvals BEGIN SELECT RAISE(ABORT,'Erasure approvals are immutable.'); END;
       CREATE TRIGGER erasure_approval_retained BEFORE DELETE ON erasure_approvals BEGIN SELECT RAISE(ABORT,'Erasure approvals must be retained.'); END;
       CREATE TRIGGER vault_identity_immutable BEFORE UPDATE ON vault_identity BEGIN SELECT RAISE(ABORT,'Privacy vault identity is immutable.'); END;
       CREATE TRIGGER vault_identity_retained BEFORE DELETE ON vault_identity BEGIN SELECT RAISE(ABORT,'Privacy vault identity must be retained.'); END;
       CREATE TRIGGER vault_identity_single BEFORE INSERT ON vault_identity WHEN EXISTS(SELECT 1 FROM vault_identity) BEGIN SELECT RAISE(ABORT,'Privacy vault identity already exists.'); END;`);
            db.prepare("INSERT INTO vault_identity VALUES(?,?,?)").run(
              identity.id,
              identity.keyFingerprint,
              protocol,
            );
          }).immediate();
        } finally {
          db.close();
        }
        exclusiveFile(anchor, "vault.json", JSON.stringify(identity));
        const sync = openSync(
          anchor,
          constants.O_RDONLY | constants.O_DIRECTORY,
        );
        try {
          fsyncSync(sync);
        } finally {
          closeSync(sync);
        }
        return {
          directory,
          id: identity.id,
          keyFingerprint: identity.keyFingerprint,
        };
      } finally {
        key.fill(0);
      }
    });
  });
}
function withVault<T>(
  vault: PrivacyVault,
  write: boolean,
  operation: (db: Database.Database, key: Buffer) => T,
): T {
  return fixed(() => {
    descriptorSchema.parse(vault);
    return root(vault.directory, (anchor) => {
      const identity = identitySchema.parse(
        JSON.parse(read(anchor, "vault.json", 4096).toString("utf8")),
      );
      if (
        identity.id !== vault.id ||
        !erasureHashEqual(identity.keyFingerprint, vault.keyFingerprint)
      )
        throw new AccountErasureUnavailable();
      const key = read(anchor, "approval.key", 32);
      try {
        if (
          key.length !== 32 ||
          !erasureHashEqual(fingerprint(key), vault.keyFingerprint)
        )
          throw new AccountErasureUnavailable();
        regular(path.join(anchor, "journal.sqlite"));
        for (const suffix of ["-wal", "-shm"]) {
          try {
            regular(path.join(anchor, "journal.sqlite" + suffix));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        const db = new Database(path.join(anchor, "journal.sqlite"), {
          readonly: !write,
          fileMustExist: true,
          timeout: 5000,
        });
        try {
          if (
            db.pragma("application_id", { simple: true }) !== applicationId ||
            db.pragma("user_version", { simple: true }) !== 1
          )
            throw new AccountErasureUnavailable();
          const identities = db
            .prepare(
              "SELECT id,key_fingerprint,format FROM vault_identity LIMIT 2",
            )
            .all() as { id: string; key_fingerprint: string; format: string }[];
          if (
            identities.length !== 1 ||
            identities[0].id !== vault.id ||
            !erasureHashEqual(
              identities[0].key_fingerprint,
              vault.keyFingerprint,
            ) ||
            identities[0].format !== protocol
          )
            throw new AccountErasureUnavailable();
          const transaction = db.transaction(() => operation(db, key));
          return write ? transaction.immediate() : transaction();
        } finally {
          db.close();
        }
      } finally {
        key.fill(0);
      }
    });
  });
}
function approval(row: Row, key: Buffer): ErasureApproval {
  const value = verifyErasureApproval(key, JSON.parse(row.approval));
  if (
    value.requestId !== row.id ||
    value.ownerHash !== row.owner_hash ||
    value.workspaceId !== row.workspace_id ||
    value.receiptHash !== row.receipt_hash ||
    value.sequence !== row.sequence ||
    !states.includes(row.state) ||
    !z.iso.datetime().safeParse(row.updated_at).success
  )
    throw new AccountErasureUnavailable();
  return value;
}
function status(row: Row, approved: ErasureApproval): ErasureStatus {
  return {
    requestId: row.id,
    state: row.state,
    requestedAt: approved.requestedAt,
    updatedAt: row.updated_at,
  };
}
function find(db: Database.Database, id: string) {
  return db.prepare("SELECT * FROM erasure_approvals WHERE id=?").get(id) as
    Row | undefined;
}
export function recordErasureApproval(
  vault: PrivacyVault,
  input: {
    ownerId: string;
    workspaceId: string;
    requestId: string;
    receipt: string;
  },
) {
  return withVault(vault, true, (db, key) => {
    z.uuid().parse(input.workspaceId);
    z.uuid().parse(input.requestId);
    const ownerHash = erasureOwnerHash(key, input.ownerId),
      receiptHash = erasureReceiptHash(input.receipt),
      existing = find(db, input.requestId);
    if (existing) {
      const value = approval(existing, key);
      if (
        !erasureHashEqual(value.ownerHash, ownerHash) ||
        value.workspaceId !== input.workspaceId ||
        !erasureHashEqual(value.receiptHash, receiptHash)
      )
        throw new AccountErasureConflict();
      return { approval: value, status: status(existing, value) };
    }
    if (
      db
        .prepare(
          "SELECT 1 FROM erasure_approvals WHERE owner_hash=? OR workspace_id=? LIMIT 1",
        )
        .get(ownerHash, input.workspaceId)
    )
      throw new AccountErasureConflict();
    const policy = accountErasurePolicy(),
      counts = db
        .prepare(
          "SELECT (SELECT count(*) FROM erasure_approvals) AS total,(SELECT count(*) FROM erasure_approvals WHERE state IN ('requested','cleaning','blocked')) AS pending,(SELECT coalesce(max(sequence),0) FROM erasure_approvals) AS latest",
        )
        .get() as { total: number; pending: number; latest: number };
    if (counts.total >= policy.journal || counts.pending >= policy.pending)
      throw new AccountErasureCapacity();
    if (
      !Number.isSafeInteger(counts.latest) ||
      counts.latest >= Number.MAX_SAFE_INTEGER
    )
      throw new AccountErasureUnavailable();
    const requestedAt = new Date().toISOString(),
      value = approveErasure(key, {
        format: "reelchemy-account-erasure-v1",
        requestId: input.requestId,
        workspaceId: input.workspaceId,
        ownerHash,
        receiptHash,
        sequence: counts.latest + 1,
        requestedAt,
      });
    db.prepare("INSERT INTO erasure_approvals VALUES(?,?,?,?,?,?,?,?)").run(
      value.requestId,
      ownerHash,
      input.workspaceId,
      receiptHash,
      value.sequence,
      JSON.stringify(value),
      "requested",
      requestedAt,
    );
    return {
      approval: value,
      status: status(find(db, input.requestId)!, value),
    };
  });
}
export function erasureStatusByReceipt(
  vault: PrivacyVault,
  requestId: string,
  receipt: string,
) {
  if (!z.uuid().safeParse(requestId).success) return undefined;
  let receiptHash: string;
  try {
    receiptHash = erasureReceiptHash(receipt);
  } catch {
    return undefined;
  }
  return withVault(vault, false, (db, key) => {
    const row = find(db, requestId);
    if (!row || !erasureHashEqual(row.receipt_hash, receiptHash))
      return undefined;
    return status(row, approval(row, key));
  });
}
export function ownerHasErasureApproval(vault: PrivacyVault, ownerId: string) {
  return withVault(vault, false, (db, key) => {
    const row = db
      .prepare("SELECT * FROM erasure_approvals WHERE owner_hash=?")
      .get(erasureOwnerHash(key, ownerId)) as Row | undefined;
    if (!row) return false;
    approval(row, key);
    return true;
  });
}
// Private coordinator/worker lookup. Public progress uses receipt verification.
export function erasureApprovalForRequest(
  vault: PrivacyVault,
  requestId: string,
) {
  if (!z.uuid().safeParse(requestId).success)
    throw new AccountErasureUnavailable();
  return withVault(vault, false, (db, key) => {
    const row = find(db, requestId);
    if (!row) return undefined;
    const value = approval(row, key);
    return { approval: value, status: status(row, value) };
  });
}
// Studio mutations must obtain their authority from the independent vault,
// never from an untrusted copied packet in the render-writable database.
export function approvedErasureContext(
  vault: PrivacyVault,
  requestId: string,
  ownerId: string,
  workspaceId: string,
) {
  return withVault(vault, false, (db, key) => {
    const row = find(db, requestId);
    if (!row) throw new AccountErasureConflict();
    const value = approval(row, key);
    if (
      value.workspaceId !== workspaceId ||
      !erasureHashEqual(value.ownerHash, erasureOwnerHash(key, ownerId))
    )
      throw new AccountErasureConflict();
    return value;
  });
}
export function pendingErasureApprovals(
  vault: PrivacyVault,
  afterSequence = 0,
  limit = 10,
) {
  if (
    !Number.isSafeInteger(afterSequence) ||
    afterSequence < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10
  )
    throw new AccountErasureUnavailable();
  return withVault(vault, false, (db, key) =>
    (
      db
        .prepare(
          "SELECT * FROM erasure_approvals INDEXED BY erasure_approvals_pending_idx WHERE state IN ('requested','cleaning','blocked') AND sequence>? ORDER BY sequence LIMIT ?",
        )
        .all(afterSequence, limit) as Row[]
    ).map((row) => ({
      approval: approval(row, key),
      state: row.state,
      updatedAt: row.updated_at,
    })),
  );
}
// Worker-only progress; the caller must establish actual cleanup prerequisites.
// An immutable intent always blocks the old identity, even after completion.
export function advanceErasureState(
  vault: PrivacyVault,
  requestId: string,
  expected: ErasureState,
  next: ErasureState,
) {
  const edges: Record<ErasureState, readonly ErasureState[]> = {
    requested: ["cleaning", "blocked"],
    cleaning: ["blocked", "completed"],
    blocked: ["cleaning"],
    completed: [],
  };
  if (!states.includes(expected) || !edges[expected].includes(next))
    throw new AccountErasureConflict();
  return withVault(vault, true, (db, key) => {
    const row = find(db, requestId);
    if (!row) return false;
    const value = approval(row, key);
    if (row.state !== expected) return false;
    const updatedAt = new Date().toISOString();
    db.prepare(
      "UPDATE erasure_approvals SET state=?,updated_at=? WHERE id=? AND state=?",
    ).run(next, updatedAt, requestId, expected);
    return status({ ...row, state: next, updated_at: updatedAt }, value);
  });
}
export function privacyVaultWatermark(
  vault: PrivacyVault,
  minimumSequence = 0,
) {
  if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0)
    throw new AccountErasureUnavailable();
  return withVault(vault, false, (db, key) => {
    const row = db
      .prepare("SELECT * FROM erasure_approvals ORDER BY sequence DESC LIMIT 1")
      .get() as Row | undefined;
    const sequence = row ? approval(row, key).sequence : 0;
    if (sequence < minimumSequence) throw new AccountErasureUnavailable();
    return { id: vault.id, keyFingerprint: vault.keyFingerprint, sequence };
  });
}
