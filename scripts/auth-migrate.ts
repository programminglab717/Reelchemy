import { migrateAuth } from "../src/lib/auth";
await migrateAuth();
console.log("Authentication schema is current.");
