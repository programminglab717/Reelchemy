import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: [
    "better-sqlite3",
    "@remotion/renderer",
    "@remotion/bundler",
  ],
  experimental: { cpus: 2 },
};
export default config;
