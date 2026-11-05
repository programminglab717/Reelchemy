import {
  compactInactiveDatabases,
  inspectDatabaseStorage,
  DatabaseCompactionUnavailable,
} from "../src/lib/database-compaction";
const args = process.argv.slice(2);
try {
  // No environment/cwd fallback: an operator must name BOTH existing stores.
  if (
    (args.length !== 4 && args.length !== 5) ||
    args[0] !== "--data" ||
    args[2] !== "--auth" ||
    (args.length === 5 && args[4] !== "--apply")
  )
    throw new DatabaseCompactionUnavailable();
  console.log(
    JSON.stringify(
      args.length === 5
        ? compactInactiveDatabases(args[1], args[3])
        : inspectDatabaseStorage(args[1], args[3]),
    ),
  );
} catch (error) {
  const known =
    error instanceof DatabaseCompactionUnavailable
      ? error
      : new DatabaseCompactionUnavailable();
  console.error(
    JSON.stringify({
      error: known.message,
      completed: known.completed,
      usage:
        "--data /absolute/existing-data --auth /absolute/existing-accounts [--apply]",
    }),
  );
  process.exitCode = 1;
}
