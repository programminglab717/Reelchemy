import {
  initializePrivacyVault,
  privacyVaultWatermark,
} from "../src/lib/privacy-vault";
import { privacyStorageDirectory } from "../src/lib/privacy-storage";
const [action, ...args] = process.argv.slice(2),
  options = new Map<string, string>();
let valid = true;
for (let index = 0; index < args.length; index += 2) {
  const name = args[index],
    value = args[index + 1];
  if (!name?.startsWith("--") || !value || options.has(name)) {
    valid = false;
    break;
  }
  options.set(name, value);
}
const allowed =
  action === "init"
    ? ["--directory"]
    : action === "status"
      ? ["--directory", "--id", "--fingerprint", "--minimum-sequence"]
      : [];
if (
  !valid ||
  !allowed.length ||
  [...options.keys()].some((key) => !allowed.includes(key)) ||
  !options.has("--directory")
) {
  console.error(
    "Usage: npm run privacy:init -- --directory /absolute/independent-vault OR npm run privacy:status -- --directory /absolute/independent-vault --id <vault-uuid> --fingerprint <key-fingerprint> [--minimum-sequence 0]",
  );
  process.exitCode = 1;
} else
  try {
    const directory = privacyStorageDirectory(options.get("--directory")!);
    if (action === "init")
      console.log(
        JSON.stringify(
          { version: 1, vault: initializePrivacyVault(directory) },
          null,
          2,
        ),
      );
    else {
      const raw = options.get("--minimum-sequence") || "0";
      if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error();
      console.log(
        JSON.stringify(
          {
            version: 1,
            vault: privacyVaultWatermark(
              {
                directory,
                id: options.get("--id") || "",
                keyFingerprint: options.get("--fingerprint") || "",
              },
              Number(raw),
            ),
          },
          null,
          2,
        ),
      );
    }
  } catch {
    console.error(
      "Privacy vault operation unavailable. Check explicit paths, expected identity and current independent storage.",
    );
    process.exitCode = 1;
  }
