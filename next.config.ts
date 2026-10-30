import type { NextConfig } from "next";
const config: NextConfig = {
  logging: { incomingRequests: false, serverFunctions: false },
  distDir: process.env.REELCHEMY_NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingExcludes: {
    "/*": [".data/**/*", "artifacts/**/*", "private-auth/**/*", ".env*"],
  },
  serverExternalPackages: [
    "better-sqlite3",
    "better-auth",
    "nodemailer",
    "@remotion/renderer",
    "@remotion/bundler",
  ],
  experimental: { cpus: 2 },
};
export default config;
