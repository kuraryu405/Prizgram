import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  authSessions,
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
  userCredentials,
  users,
} from "@prizgram/db";

import { AppError } from "../api";
import { AuthService, isLoginIdUniqueViolation } from "./service";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);
const credentials = {
  loginId: "student.one",
  password: "correct horse battery staple",
};

let temporaryDirectory: string;
let connection: DatabaseConnection;
let now: Date;
let service: AuthService;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-auth-"));
  connection = createDatabase(path.join(temporaryDirectory, "auth.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  now = new Date("2026-08-25T00:00:00Z");
  service = new AuthService(connection, () => now);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function appErrorCode(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    throw new Error("Expected action to fail");
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
}

describe("AuthService", () => {
  it("registers atomically without storing the password or raw session token", async () => {
    const session = await service.register(credentials);

    expect(session.user.loginId).toBe("student.one");
    expect(service.authenticate(session.token)).toEqual(session.user);
    const storedCredential = connection.db.select().from(userCredentials).get();
    expect(storedCredential?.passwordHash).not.toContain(credentials.password);
    expect(storedCredential?.passwordHash).toMatch(/^scrypt\$/);
    expect(connection.db.select().from(authSessions).get()?.tokenHash).not.toBe(
      session.token,
    );
  });

  it("rolls back duplicate registration without creating an orphan user", async () => {
    await service.register(credentials);
    await expect(appErrorCode(service.register(credentials))).resolves.toBe(
      "LOGIN_ID_TAKEN",
    );
    expect(connection.db.select().from(users).all()).toHaveLength(1);
    expect(connection.db.select().from(authSessions).all()).toHaveLength(1);
  });

  it("maps only a unique violation on user_credentials.login_id to LOGIN_ID_TAKEN", () => {
    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message: "UNIQUE constraint failed: user_credentials.login_id",
      }),
    ).toBe(true);

    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_CONSTRAINT_UNIQUE",
        message:
          "UNIQUE constraint failed: index 'user_credentials_login_id_unique'",
      }),
    ).toBe(false);
    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_CONSTRAINT_PRIMARYKEY",
        message: "PRIMARY KEY constraint failed: users.id",
      }),
    ).toBe(false);
    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_CONSTRAINT_CHECK",
        message:
          "CHECK constraint failed: user_credentials_password_hash_shape",
      }),
    ).toBe(false);
    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
        message: "FOREIGN KEY constraint failed",
      }),
    ).toBe(false);
    expect(
      isLoginIdUniqueViolation({
        code: "SQLITE_ERROR",
        message: "no such table",
      }),
    ).toBe(false);
    expect(isLoginIdUniqueViolation(new Error("plain error"))).toBe(false);
  });

  it("propagates unexpected database failures instead of reporting a login conflict", async () => {
    connection.sqlite.exec("drop table users");
    await expect(service.register(credentials)).rejects.toThrow(
      /no such table/,
    );
    await expect(appErrorCode(service.register(credentials))).rejects.not.toBe(
      "LOGIN_ID_TAKEN",
    );
  });

  it("uses a generic login failure and locks repeated failures", async () => {
    await service.register(credentials);
    await expect(
      Promise.all(
        Array.from({ length: 5 }, () =>
          appErrorCode(
            service.login({
              ...credentials,
              password: "incorrect password value",
            }),
          ),
        ),
      ),
    ).resolves.toEqual(Array(5).fill("AUTHENTICATION_FAILED"));
    expect(connection.db.select().from(userCredentials).get()).toMatchObject({
      failedAttempts: 5,
      lockedUntil: new Date("2026-08-25T00:15:00Z"),
    });
    await expect(appErrorCode(service.login(credentials))).resolves.toBe(
      "AUTHENTICATION_FAILED",
    );

    now = new Date(now.getTime() + 16 * 60 * 1_000);
    const session = await service.login(credentials);
    expect(service.authenticate(session.token)).toEqual(session.user);
    expect(
      connection.db.select().from(userCredentials).get()?.failedAttempts,
    ).toBe(0);
  });

  it("invalidates only the presented session on logout", async () => {
    const first = await service.register(credentials);
    const second = await service.login(credentials);
    service.logout(first.token);
    expect(service.authenticate(first.token)).toBeUndefined();
    expect(service.authenticate(second.token)).toEqual(second.user);
  });

  it("purges expired sessions whenever a new session is registered", async () => {
    await service.register(credentials);
    now = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000);
    await service.register({
      loginId: "student.two",
      password: "another correct long password",
    });
    expect(connection.db.select().from(authSessions).all()).toHaveLength(1);
  });
});
