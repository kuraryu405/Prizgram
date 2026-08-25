import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@prizgram/db", "@prizgram/shared"],
};

export default nextConfig;
