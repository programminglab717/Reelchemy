import path from "node:path";
import { z } from "zod";
import { authStorageDirectory, storagePathsOverlap } from "./auth-storage";
import { AccountErasureUnavailable } from "./account-erasure-policy";
import type { PrivacyVault } from "./privacy-vault";
export function privacyStorageDirectory(
  directory: string,
  env: Record<string, string | undefined> = process.env,
) {
  try {
    if (!directory || !path.isAbsolute(directory))
      throw new AccountErasureUnavailable();
    const selected = path.resolve(directory);
    const roots = [
      path.resolve(env.REELCHEMY_DATA_DIR || ".data"),
      authStorageDirectory(env),
      path.resolve(env.REELCHEMY_ARTIFACT_DIR || "artifacts"),
      ...(env.REELCHEMY_RENDER_CACHE_DIR
        ? [path.resolve(env.REELCHEMY_RENDER_CACHE_DIR)]
        : []),
    ];
    if (roots.some((root) => storagePathsOverlap(selected, root)))
      throw new AccountErasureUnavailable();
    return selected;
  } catch {
    throw new AccountErasureUnavailable();
  }
}
export function configuredPrivacyVault(
  env: Record<string, string | undefined> = process.env,
): PrivacyVault {
  try {
    const directory = privacyStorageDirectory(
        env.REELCHEMY_PRIVACY_DIR || "",
        env,
      ),
      id = z.uuid().parse(env.REELCHEMY_PRIVACY_ID),
      keyFingerprint = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(env.REELCHEMY_PRIVACY_KEY_FINGERPRINT);
    return { directory, id, keyFingerprint };
  } catch {
    throw new AccountErasureUnavailable();
  }
}
