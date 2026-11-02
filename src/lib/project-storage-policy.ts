import { LimitConfigurationError } from "./limits-policy";
export type ProjectStoragePolicy = ReturnType<typeof projectStoragePolicy>;
export function projectStoragePolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const value = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9]\d*$/.test(raw)) throw new LimitConfigurationError();
    const result = Number(raw);
    if (!Number.isSafeInteger(result) || result < min || result > max)
      throw new LimitConfigurationError();
    return result;
  };
  const projectBytes = value(
    "REELCHEMY_PROJECT_DATA_BYTES",
    32 * 1024 ** 2,
    1024 ** 2,
    256 * 1024 ** 2,
  );
  const studioBytes = value(
    "REELCHEMY_STUDIO_DATA_BYTES",
    256 * 1024 ** 2,
    1024 ** 2,
    16 * 1024 ** 3,
  );
  const serviceBytes = value(
    "REELCHEMY_SERVICE_DATA_BYTES",
    4 * 1024 ** 3,
    1024 ** 2,
    1024 ** 4,
  );
  if (projectBytes > studioBytes || studioBytes > serviceBytes)
    throw new LimitConfigurationError();
  return {
    projectBytes,
    studioBytes,
    serviceBytes,
    studioProjects: value("REELCHEMY_STUDIO_PROJECTS", 500, 1, 10000),
    serviceProjects: value("REELCHEMY_SERVICE_PROJECTS", 20000, 1, 100000),
    versions: value("REELCHEMY_PROJECT_VERSIONS", 10000, 2, 10000),
    messages: value("REELCHEMY_PROJECT_MESSAGES", 10000, 3, 10000),
  };
}
export class ProjectStorageLimit extends Error {
  readonly code = "PROJECT_STORAGE_LIMIT";
  constructor(
    readonly scope: "project" | "studio" | "service",
    readonly kind: "bytes" | "projects" | "versions" | "messages",
  ) {
    super(
      scope === "service"
        ? "Project storage is temporarily full. Contact the studio operator; your current edits remain on this device."
        : kind === "projects"
          ? "Your studio's project allowance is full, including Trash. Permanently remove a project you no longer need before creating another."
          : "This change exceeds the retained project allowance. Keep a recovery copy, then use Manage saved history to remove earlier versions or directions. Your current edits are kept here.",
    );
  }
}
