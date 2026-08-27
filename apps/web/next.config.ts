import type { NextConfig } from "next";

import { loadPrizgramEnvironment } from "../../packages/db/src/config";

// Next normally loads apps/web/.env. This project keeps .env at the workspace
// root, which must also be used by the migration CLI.
loadPrizgramEnvironment();

const isProduction = process.env.NODE_ENV === "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // Keep unsafe-inline until a request nonce is propagated to every
  // Next.js-generated script. Removing it statically breaks hydration.
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self'${isProduction ? "" : " ws:"}`,
].join("; ");

const securityHeaders = [
  { key: "content-security-policy", value: contentSecurityPolicy },
  { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
  { key: "x-content-type-options", value: "nosniff" },
  { key: "x-frame-options", value: "DENY" },
  {
    key: "strict-transport-security",
    value: "max-age=31536000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@prizgram/db", "@prizgram/shared"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
