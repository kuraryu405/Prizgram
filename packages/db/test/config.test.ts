import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../src/client";
import {
  databasePathFromUrl,
  findWorkspaceRoot,
  loadPrizgramEnvironment,
} from "../src/config";

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, "../../..");
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("database environment configuration", () => {
  it("finds the same workspace root from the repository and the web app", () => {
    expect(findWorkspaceRoot(workspaceRoot)).toBe(workspaceRoot);
    expect(findWorkspaceRoot(path.join(workspaceRoot, "apps/web"))).toBe(
      workspaceRoot,
    );
  });

  it("resolves relative SQLite URLs identically from repository and web cwd", () => {
    const databaseUrl = "file:./data/prizgram.sqlite";
    const expected = path.join(workspaceRoot, "data/prizgram.sqlite");

    expect(
      databasePathFromUrl(databaseUrl, { startingDirectory: workspaceRoot }),
    ).toBe(expected);
    expect(
      databasePathFromUrl(databaseUrl, {
        startingDirectory: path.join(workspaceRoot, "apps/web"),
      }),
    ).toBe(expected);
  });

  it("opens the same SQLite file from migration and web working directories", () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "prizgram-workspace-test-"),
    );
    temporaryDirectories.push(fixtureRoot);
    fs.writeFileSync(
      path.join(fixtureRoot, "pnpm-workspace.yaml"),
      "packages: []\n",
    );
    const webDirectory = path.join(fixtureRoot, "apps/web");
    fs.mkdirSync(webDirectory, { recursive: true });

    const cliConnection = createDatabase("file:./data/prizgram.sqlite", {
      startingDirectory: fixtureRoot,
    });
    const webConnection = createDatabase("file:./data/prizgram.sqlite", {
      startingDirectory: webDirectory,
    });
    try {
      cliConnection.sqlite.exec("create table cwd_equivalence (id integer)");
      expect(
        webConnection.sqlite
          .prepare(
            "select name from sqlite_master where type = 'table' and name = 'cwd_equivalence'",
          )
          .get(),
      ).toEqual({ name: "cwd_equivalence" });
    } finally {
      cliConnection.close();
      webConnection.close();
    }
  });

  it("loads the workspace-root .env from a non-Next entrypoint", () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "prizgram-env-test-"),
    );
    temporaryDirectories.push(fixtureRoot);
    fs.writeFileSync(
      path.join(fixtureRoot, "pnpm-workspace.yaml"),
      "packages: []\n",
    );
    fs.writeFileSync(
      path.join(fixtureRoot, ".env"),
      "PRIZGRAM_ENV_LOADING_TEST=loaded-from-root\n",
    );

    const before = process.env.PRIZGRAM_ENV_LOADING_TEST;
    delete process.env.PRIZGRAM_ENV_LOADING_TEST;
    try {
      expect(loadPrizgramEnvironment(fixtureRoot)).toBe(fixtureRoot);
      expect(process.env.PRIZGRAM_ENV_LOADING_TEST).toBe("loaded-from-root");
    } finally {
      if (before === undefined) {
        delete process.env.PRIZGRAM_ENV_LOADING_TEST;
      } else {
        process.env.PRIZGRAM_ENV_LOADING_TEST = before;
      }
    }
  });

  it("rejects relative SQLite paths when no workspace can anchor them", () => {
    const standaloneDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "prizgram-standalone-test-"),
    );
    temporaryDirectories.push(standaloneDirectory);

    expect(() =>
      databasePathFromUrl("file:./data/prizgram.sqlite", {
        startingDirectory: standaloneDirectory,
      }),
    ).toThrow(/absolute SQLite path/);
  });

  it("accepts an absolute SQLite path without a workspace", () => {
    const standaloneDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), "prizgram-standalone-test-"),
    );
    temporaryDirectories.push(standaloneDirectory);
    const absolutePath = path.join(standaloneDirectory, "prizgram.sqlite");

    expect(
      databasePathFromUrl(`file:${absolutePath}`, {
        startingDirectory: standaloneDirectory,
      }),
    ).toBe(absolutePath);
  });

  it("rejects non-SQLite URL schemes with an actionable error", () => {
    expect(() => databasePathFromUrl("postgres://localhost/prizgram")).toThrow(
      /must be a SQLite path or a file: URL/,
    );
    expect(() => databasePathFromUrl("mysql://user:pass@host/db")).toThrow(
      /must be a SQLite path or a file: URL/,
    );
  });

  it("rejects query and fragment components in the SQLite path", () => {
    expect(() =>
      databasePathFromUrl("file:./data/prizgram.sqlite?mode=ro"),
    ).toThrow(/query or fragment components/);
    expect(() =>
      databasePathFromUrl("./data/prizgram.sqlite#fragment"),
    ).toThrow(/query or fragment components/);
  });
});
