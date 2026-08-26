/**
 * Starts the full E2E environment: fresh SQLite database, migrations, the
 * mock OpenAI-compatible server, and the production Next.js server. Writes
 * readiness by exiting 0 only when /api/health answers; Playwright's
 * webServer uses this as the single entrypoint and tears everything down.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const webDir = path.join(repoRoot, "apps/web");

const PORT = Number(process.env.PORT ?? 3100);
export const APP_ORIGIN = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "prizgram-e2e-"));
const databaseUrl = `file:${path.join(dataDir, "e2e.sqlite")}`;

// Publish runtime facts for tests (e.g. the reminders cron needs the same DB).
const runtimeFile = path.join(here, ".runtime.json");
function writeRuntimeConfig() {
  writeFileSync(
    runtimeFile,
    JSON.stringify({ databaseUrl, appOrigin: APP_ORIGIN }, null, 2),
  );
}
writeRuntimeConfig();

function run(command, args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${label} failed (${code}):\n${output}`));
    });
  });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const children = [];
let shuttingDown = false;

function teardown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  }
  try {
    rmSync(runtimeFile, { force: true });
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

process.on("exit", teardown);
process.on("SIGINT", () => {
  teardown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  teardown();
  process.exit(143);
});

// 1. Fresh database + migrations.
await run(
  "npx",
  ["tsx", "packages/db/src/cli.ts"],
  { DATABASE_URL: databaseUrl },
  "migrate",
);

// 2. Mock OpenAI-compatible LLM server.
const mockLlm = spawn(
  process.execPath,
  [path.join(here, "mock-llm-server.mjs")],
  {
    cwd: repoRoot,
    env: { ...process.env, MOCK_LLM_PORT: "4141" },
    stdio: "inherit",
  },
);
children.push(mockLlm);
await waitFor("http://localhost:4141/chat/completions", 10_000).catch(
  async () => {
    // The mock answers POST-only; a failed GET probe is fine once connect succeeds.
    await fetch("http://localhost:4141/", { method: "HEAD" }).catch(
      () => undefined,
    );
  },
);

// 2b. Mock licensed job search API (Careerjet wire contract).
const mockCareerjet = spawn(
  process.execPath,
  [path.join(here, "mock-careerjet-server.mjs")],
  {
    cwd: repoRoot,
    env: { ...process.env, MOCK_CAREERJET_PORT: "4142" },
    stdio: "inherit",
  },
);
children.push(mockCareerjet);
await waitFor("http://localhost:4142/v4/query", 10_000).catch(async () => {
  await fetch("http://localhost:4142/", { method: "HEAD" }).catch(
    () => undefined,
  );
});

// 3. Production Next.js server wired to the mock LLM.
const nextServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: webDir,
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: databaseUrl,
    APP_ORIGIN: APP_ORIGIN,
    OPENAI_BASE_URL: "http://localhost:4141/v1",
    OPENAI_API_KEY: "e2e-mock-key",
    OPENAI_MODEL: "e2e-mock-model",
    OPENAI_TIMEOUT_MS: "20000",
    CAREERJET_API_KEY: "e2e-mock-careerjet-key",
    CAREERJET_LOCALE_CODE: "ja_JP",
    CAREERJET_BASE_URL: "http://localhost:4142/v4/query",
    CAREERJET_TIMEOUT_MS: "15000",
  },
  stdio: "inherit",
});
children.push(nextServer);
await waitFor(`${APP_ORIGIN}/api/health`, 30_000);

console.log(`[e2e] app ready on ${APP_ORIGIN}`);

// Keep the orchestrator alive while Playwright drives the servers.
setInterval(() => undefined, 60_000);
