import type Database from "better-sqlite3";
import {
  approvedErasureContext,
  ownerHasErasureApproval,
  privacyVaultWatermark,
  type PrivacyVault,
} from "./privacy-vault";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";
const protocol = "reelchemy-auth-erasure-v1";
export type AuthErasureContext = {
  requestId: string;
  ownerId: string;
  workspaceId: string;
};
function fixed<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof AccountErasureConflict) throw error;
    throw new AccountErasureUnavailable();
  }
}
// Current auth connections register the independent reader before any session
// insert. An older producer lacking it cannot create a bypassing session.
export function registerAuthErasureReader(
  db: Database.Database,
  vault: PrivacyVault,
) {
  db.function(
    "reelchemy_erasure_denied",
    { deterministic: false },
    (id: unknown) => {
      if (typeof id !== "string") throw new AccountErasureUnavailable();
      return ownerHasErasureApproval(vault, id) ? 1 : 0;
    },
  );
}
export function assertAuthErasureSchema(
  db: Database.Database,
  vault: PrivacyVault,
) {
  fixed(() => {
    const row = db
      .prepare(
        "SELECT vault_id,key_fingerprint,last_sequence FROM auth_erasure_protocol WHERE id=?",
      )
      .get(protocol) as
      | { vault_id: string; key_fingerprint: string; last_sequence: number }
      | undefined;
    if (
      !row ||
      row.vault_id !== vault.id ||
      row.key_fingerprint !== vault.keyFingerprint ||
      !Number.isSafeInteger(row.last_sequence) ||
      row.last_sequence < 0
    )
      throw new AccountErasureUnavailable();
    privacyVaultWatermark(vault, row.last_sequence);
    for (const name of [
      "auth_erasure_session_insert",
      "auth_erasure_user_insert",
      "auth_erasure_user_update",
      "auth_erasure_session_update",
      "auth_erasure_account_insert",
      "auth_erasure_account_update",
      "auth_erasure_context",
      "auth_erasure_immutable",
      "auth_erasure_retained",
      "auth_erasure_protocol_immutable",
      "auth_erasure_protocol_retained",
      "auth_erasure_protocol_monotonic",
    ])
      if (
        !db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?",
          )
          .get(name)
      )
        throw new AccountErasureUnavailable();
  });
}
export function migrateAuthErasures(
  db: Database.Database,
  vault: PrivacyVault,
) {
  fixed(() => {
    privacyVaultWatermark(vault);
    registerAuthErasureReader(db, vault);
    db.transaction(() => {
      for (const table of ["user", "session", "account", "verification"])
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          throw new AccountErasureUnavailable();
      db.exec(`CREATE TABLE IF NOT EXISTS auth_erasure_protocol(id TEXT PRIMARY KEY CHECK(id='${protocol}'),vault_id TEXT NOT NULL,key_fingerprint TEXT NOT NULL,last_sequence INTEGER NOT NULL DEFAULT 0 CHECK(last_sequence>=0));
    CREATE TABLE IF NOT EXISTS auth_erasure_approvals(user_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,approval TEXT NOT NULL CHECK(json_valid(approval) AND length(CAST(approval AS BLOB))<=2048));
    CREATE TRIGGER IF NOT EXISTS auth_erasure_protocol_immutable BEFORE UPDATE OF id,vault_id,key_fingerprint ON auth_erasure_protocol BEGIN SELECT RAISE(ABORT,'Authentication privacy identity is immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_protocol_retained BEFORE DELETE ON auth_erasure_protocol BEGIN SELECT RAISE(ABORT,'Authentication privacy identity must be retained.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_protocol_monotonic BEFORE UPDATE OF last_sequence ON auth_erasure_protocol WHEN NEW.last_sequence<OLD.last_sequence BEGIN SELECT RAISE(ABORT,'Authentication privacy sequence cannot decrease.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_context BEFORE INSERT ON auth_erasure_approvals WHEN json_extract(NEW.approval,'$.format') IS NOT 'reelchemy-account-erasure-v1' OR json_extract(NEW.approval,'$.requestId') IS NOT NEW.request_id OR json_extract(NEW.approval,'$.workspaceId') IS NOT NEW.workspace_id BEGIN SELECT RAISE(ABORT,'Authentication deletion approval does not match.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_immutable BEFORE UPDATE ON auth_erasure_approvals BEGIN SELECT RAISE(ABORT,'Authentication deletion approval is immutable.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_retained BEFORE DELETE ON auth_erasure_approvals BEGIN SELECT RAISE(ABORT,'Authentication deletion approval must be retained.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_session_insert BEFORE INSERT ON session WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id=NEW.userId) OR reelchemy_erasure_denied(NEW.userId)=1 BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_session_update BEFORE UPDATE ON session WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id IN(OLD.userId,NEW.userId)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_user_insert BEFORE INSERT ON user WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id=NEW.id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_user_update BEFORE UPDATE ON user WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id IN(OLD.id,NEW.id)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_account_insert BEFORE INSERT ON account WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id=NEW.userId) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
    CREATE TRIGGER IF NOT EXISTS auth_erasure_account_update BEFORE UPDATE ON account WHEN EXISTS(SELECT 1 FROM auth_erasure_approvals WHERE user_id IN(OLD.userId,NEW.userId)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;`);
      db.prepare(
        "INSERT OR IGNORE INTO auth_erasure_protocol(id,vault_id,key_fingerprint,last_sequence) VALUES(?,?,?,0)",
      ).run(protocol, vault.id, vault.keyFingerprint);
      assertAuthErasureSchema(db, vault);
    }).immediate();
  });
}
function recordContext(
  db: Database.Database,
  vault: PrivacyVault,
  context: AuthErasureContext,
) {
  const approved = approvedErasureContext(
    vault,
    context.requestId,
    context.ownerId,
    context.workspaceId,
  );
  const existing = db
    .prepare(
      "SELECT request_id,workspace_id,approval FROM auth_erasure_approvals WHERE user_id=?",
    )
    .get(context.ownerId) as
    { request_id: string; workspace_id: string; approval: string } | undefined;
  if (existing) {
    if (
      existing.request_id !== context.requestId ||
      existing.workspace_id !== context.workspaceId ||
      existing.approval !== JSON.stringify(approved)
    )
      throw new AccountErasureConflict();
  } else
    db.prepare("INSERT INTO auth_erasure_approvals VALUES(?,?,?,?)").run(
      context.ownerId,
      context.requestId,
      context.workspaceId,
      JSON.stringify(approved),
    );
  db.prepare(
    "UPDATE auth_erasure_protocol SET last_sequence=max(last_sequence,?) WHERE id=?",
  ).run(approved.sequence, protocol);
  return approved;
}
// No Set-Cookie is issued: an old request must never clear a different account
// selected in another browser tab while this irreversible request was pending.
export function revokeApprovedAuthSessions(
  db: Database.Database,
  vault: PrivacyVault,
  context: AuthErasureContext,
) {
  approvedErasureContext(
    vault,
    context.requestId,
    context.ownerId,
    context.workspaceId,
  );
  return fixed(() =>
    db
      .transaction(() => {
        recordContext(db, vault, context);
        const sessions = db
          .prepare("DELETE FROM session WHERE userId=?")
          .run(context.ownerId).changes;
        db.prepare("DELETE FROM verification WHERE value=?").run(
          context.ownerId,
        );
        return { sessions };
      })
      .immediate(),
  );
}
// Private cleanup worker only, after studio/native/provider/mail prerequisites.
export function finishApprovedAuthErasure(
  db: Database.Database,
  vault: PrivacyVault,
  context: AuthErasureContext,
) {
  approvedErasureContext(
    vault,
    context.requestId,
    context.ownerId,
    context.workspaceId,
  );
  return fixed(() => {
    db.pragma("secure_delete=ON");
    return db
      .transaction(() => {
        recordContext(db, vault, context);
        db.prepare("DELETE FROM session WHERE userId=?").run(context.ownerId);
        db.prepare("DELETE FROM account WHERE userId=?").run(context.ownerId);
        db.prepare("DELETE FROM verification WHERE value=?").run(
          context.ownerId,
        );
        return {
          users: db.prepare("DELETE FROM user WHERE id=?").run(context.ownerId)
            .changes,
        };
      })
      .immediate();
  });
}
