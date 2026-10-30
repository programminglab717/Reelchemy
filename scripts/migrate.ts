export {};
const arguments_ = process.argv.slice(2);
if (
  arguments_.length > 1 ||
  (arguments_.length === 1 && arguments_[0] !== "--recount-media")
)
  throw new Error("Usage: npm run db:migrate -- [--recount-media]");
const { recountMediaStorage } = await import("../src/lib/db");
if (arguments_[0] === "--recount-media") {
  const result = recountMediaStorage();
  console.log(
    `Rebuilt media accounting for ${result.assetCount} referenced files.`,
  );
}
const { migrateAuth } = await import("../src/lib/auth");
await migrateAuth();
console.log("Studio and authentication schemas are current.");
