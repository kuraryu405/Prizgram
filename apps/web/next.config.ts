import type { NextConfig } from "next";

import { loadPrizgramEnvironment } from "../../packages/db/src/config";

// Next normally loads apps/web/.env. This project keeps .env at the workspace
// root, which must also be used by the migration CLI.
loadPrizgramEnvironment();

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@prizgram/db", "@prizgram/shared"],
};

export default nextConfig;
