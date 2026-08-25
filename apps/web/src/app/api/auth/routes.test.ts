import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateDatabase } from "@prizgram/db";

process.env.DATABASE_URL = "file::memory:";
process.env.APP_ORIGIN = "https://prizgram.test";

import { getDatabase } from "@/server/database";
import { scryptGate } from "@/server/auth";
import { POST as loginPost } from "./login/route";
import { POST as registerPost } from "./register/route";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../../packages/db/drizzle",
);

const ORIGIN = "https://prizgram.test";
// Mirrors the default AUTH_SCRYPT_MAX_CONCURRENT / AUTH_SCRYPT_MAX_QUEUED
// limits the module configures when no environment overrides are set.
const DEFAULT_SCRYPT_MAX_CONCURRENT = 4;
const DEFAULT_SCRYPT_MAX_QUEUED = 64;

function authRequest(
  path: string,
  body: Record<string, string>,
  origin = ORIGIN,
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      host: "prizgram.test",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function waitForIdleGate(): Promise<void> {
  // Module-load work such as the timing-protection dummy hash may still
  // occupy the gate right after import; wait for a fully idle state so the
  // saturation below is deterministic.
  while (scryptGate.active > 0 || scryptGate.queued > 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function saturateScryptGate(): Promise<() => void> {
  await waitForIdleGate();
  const capacity =
    scryptGate.active +
    scryptGate.queued +
    DEFAULT_SCRYPT_MAX_CONCURRENT +
    DEFAULT_SCRYPT_MAX_QUEUED;
  // Pre-create every deferred outside the task factory: a queued entry may
  // be resumed later, and its task must then return the SAME already
  // settled-or-settleable promise instead of arming a new pending one.
  const resolvers: Array<() => void> = [];
  for (let index = 0; index < capacity; index += 1) {
    let resolveTask!: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });
    void scryptGate.run(() => taskPromise).catch(() => undefined);
    resolvers.push(resolveTask);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const resolve of resolvers) resolve();
  };
}

describe("authentication routes", () => {
  beforeAll(() => {
    migrateDatabase(getDatabase(), migrationsFolder);
  });

  afterAll(() => {
    getDatabase().close();
  });

  it("registers and logs in through the HTTP boundary", async () => {
    const credentials = {
      loginId: "route.user.one",
      password: "correct horse battery staple",
    };
    const registered = await registerPost(
      authRequest("/api/auth/register", credentials),
    );
    expect(registered.status).toBe(201);
    const registeredBody = (await registered.json()) as {
      ok: boolean;
      data: { user: { loginId: string } };
    };
    expect(registeredBody.ok).toBe(true);
    expect(registeredBody.data.user.loginId).toBe("route.user.one");
    expect(registered.headers.get("set-cookie")).toContain("HttpOnly");

    const loggedIn = await loginPost(
      authRequest("/api/auth/login", credentials),
    );
    expect(loggedIn.status).toBe(200);
    await expect(loggedIn.json()).resolves.toMatchObject({
      ok: true,
      data: { user: { loginId: "route.user.one" } },
    });
  });

  it("keeps unknown logins a generic 401", async () => {
    const response = await loginPost(
      authRequest("/api/auth/login", {
        loginId: "route.unknown",
        password: "irrelevant long password",
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "AUTHENTICATION_FAILED" },
    });
  });

  it("rejects cross-origin mutations without touching the database", async () => {
    const response = await registerPost(
      authRequest(
        "/api/auth/register",
        { loginId: "route.evil", password: "correct horse battery staple" },
        "https://evil.test",
      ),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ORIGIN" },
    });
  });

  it("answers scrypt saturation with 429 instead of an unexpected 500", async () => {
    const release = await saturateScryptGate();
    try {
      const response = await registerPost(
        authRequest("/api/auth/register", {
          loginId: "route.saturated.register",
          password: "correct horse battery staple",
        }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("5");
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "RATE_LIMITED" },
      });

      const loginResponse = await loginPost(
        authRequest("/api/auth/login", {
          loginId: "route.saturated.login",
          password: "correct horse battery staple",
        }),
      );
      expect(loginResponse.status).toBe(429);
      expect(loginResponse.headers.get("retry-after")).toBe("5");
      await expect(loginResponse.json()).resolves.toMatchObject({
        error: { code: "RATE_LIMITED" },
      });
    } finally {
      release();
    }

    // Capacity recovered: registration succeeds again after release.
    const recovered = await registerPost(
      authRequest("/api/auth/register", {
        loginId: "route.after.saturation",
        password: "correct horse battery staple",
      }),
    );
    expect(recovered.status).toBe(201);
  });
});
