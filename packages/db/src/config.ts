import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { loadEnvConfig } from "@next/env";
import { z } from "zod";

export const DEFAULT_DATABASE_URL = "file:./data/prizgram.sqlite";

const databaseUrlSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (url) => {
      const [, schemeName] = /^([a-z][a-z0-9+.-]*):/i.exec(url) ?? [];
      if (schemeName === undefined) return true;
      return schemeName.length === 1 || schemeName.toLowerCase() === "file";
    },
    {
      message:
        "DATABASE_URL must be a SQLite path or a file: URL, not another database scheme",
    },
  )
  .refine((url) => !/[?#]/.test(url.replace(/^([a-z][a-z0-9+.-]*:)/i, "")), {
    message:
      "DATABASE_URL must not contain query or fragment components; the path is passed to SQLite verbatim",
  });

export interface DatabasePathOptions {
  /** Directory from which to locate the monorepo. */
  startingDirectory?: string;
}

/**
 * Finds the repository root from a directory inside the workspace. A
 * standalone deployment intentionally has no workspace root and must supply
 * an absolute database path.
 */
export function findWorkspaceRoot(
  startingDirectory = process.cwd(),
): string | undefined {
  let candidate = path.resolve(startingDirectory);

  while (true) {
    if (fs.existsSync(path.join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
}

/** Loads the documented workspace-root `.env` for non-Next entrypoints. */
export function loadPrizgramEnvironment(
  startingDirectory = process.cwd(),
): string | undefined {
  const workspaceRoot = findWorkspaceRoot(startingDirectory);
  if (workspaceRoot) {
    const requireFromDatabasePackage = createRequire(
      path.join(workspaceRoot, "packages/db/package.json"),
    );
    const environmentLoader = requireFromDatabasePackage("@next/env") as {
      loadEnvConfig: typeof loadEnvConfig;
    };
    environmentLoader.loadEnvConfig(
      workspaceRoot,
      process.env.NODE_ENV !== "production",
    );
  }
  return workspaceRoot;
}

export function databaseUrlFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Converts a SQLite URL/path to an absolute filename. Relative paths are
 * anchored at the workspace root rather than the caller's current directory.
 */
export function databasePathFromUrl(
  databaseUrl: string,
  { startingDirectory = process.cwd() }: DatabasePathOptions = {},
): string {
  const normalizedUrl = databaseUrlSchema.parse(databaseUrl);
  const filename = normalizedUrl.startsWith("file:")
    ? normalizedUrl.slice("file:".length)
    : normalizedUrl;

  if (filename === ":memory:") return filename;
  if (path.isAbsolute(filename)) return path.normalize(filename);

  const workspaceRoot = findWorkspaceRoot(startingDirectory);
  if (!workspaceRoot) {
    throw new Error(
      "A relative SQLite database path requires a Prizgram workspace. Set DATABASE_URL to an absolute SQLite path when running standalone.",
    );
  }
  return path.resolve(workspaceRoot, filename);
}
