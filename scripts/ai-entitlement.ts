// Operator/billing hook for platform AI access (REELCHEMY_PLATFORM_AI=granted):
//   npm run ai:entitlement -- list
//   npm run ai:entitlement -- grant --workspace ID [--daily-usd 10] [--reference plan-123]
//   npm run ai:entitlement -- revoke --workspace ID
// Studios that save their own key always use it regardless of entitlement.
export {};
const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
let invalid = false;
for (let i = 0; i < rest.length; i += 2) {
  if (
    ["--workspace", "--daily-usd", "--reference"].includes(rest[i]) &&
    rest[i + 1] !== undefined
  )
    flags.set(rest[i], rest[i + 1]);
  else invalid = true;
}
if (
  invalid ||
  !["list", "grant", "revoke"].includes(command) ||
  (command !== "list" && !flags.get("--workspace"))
) {
  console.error(
    "Usage: ai-entitlement list | grant --workspace ID [--daily-usd AMOUNT] [--reference TEXT] | revoke --workspace ID",
  );
  process.exit(64);
}
const { studioAiEntitlements } = await import("../src/lib/db");
if (command === "list")
  console.log(JSON.stringify(studioAiEntitlements.list(), null, 2));
else if (command === "grant") {
  studioAiEntitlements.grant(
    flags.get("--workspace")!,
    flags.get("--daily-usd"),
    flags.get("--reference"),
  );
  console.log(
    JSON.stringify(studioAiEntitlements.get(flags.get("--workspace")!)),
  );
} else
  console.log(
    JSON.stringify({
      revoked: studioAiEntitlements.revoke(flags.get("--workspace")!),
    }),
  );
