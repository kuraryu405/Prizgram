import { describe, expect, it, vi } from "vitest";

import { AppError } from "../api";
import {
  assertSameOrigin,
  authenticateMutationRequest,
  clearSessionCookie,
  readCredentials,
  sessionCookie,
  sessionCookieName,
  sessionTokenFromRequest,
  withNoStore,
} from "./http";
import { createAuthRateLimiter } from "./rate-limit";

function withEnvironment(
  overrides: Record<string, string | undefined>,
  action: () => void,
): void {
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    action();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function sameOriginRequest(): Request {
  return new Request("https://prizgram.test/api/auth/login", {
    headers: { host: "prizgram.test", origin: "https://prizgram.test" },
  });
}

describe("auth HTTP boundary", () => {
  it("requires an exact same origin for mutations", () => {
    expect(() =>
      assertSameOrigin(
        new Request("https://prizgram.test/api/auth/login", {
          headers: { host: "prizgram.test", origin: "https://evil.test" },
        }),
      ),
    ).toThrow(AppError);
    expect(() =>
      assertSameOrigin(
        new Request("https://prizgram.test/api/auth/login", {
          headers: {
            host: "prizgram.test",
            origin: "https://prizgram.test",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("requires an explicit APP_ORIGIN before trusting any host in production", () => {
    withEnvironment({ NODE_ENV: "production", APP_ORIGIN: undefined }, () => {
      let thrown: unknown;
      try {
        assertSameOrigin(sameOriginRequest());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("SERVER_MISCONFIGURED");
      expect((thrown as AppError).status).toBe(500);
    });
  });

  it("enforces the configured APP_ORIGIN instead of the request host in production", () => {
    withEnvironment(
      { NODE_ENV: "production", APP_ORIGIN: "https://app.example" },
      () => {
        expect(() => assertSameOrigin(sameOriginRequest())).toThrow(AppError);
        expect(() =>
          assertSameOrigin(
            new Request("https://app.example/api/auth/login", {
              headers: {
                host: "prizgram.test",
                origin: "https://app.example",
              },
            }),
          ),
        ).not.toThrow();
      },
    );
  });

  it("reports a malformed APP_ORIGIN as a server misconfiguration", () => {
    withEnvironment({ NODE_ENV: "production", APP_ORIGIN: "not-a-url" }, () => {
      let thrown: unknown;
      try {
        assertSameOrigin(sameOriginRequest());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect((thrown as AppError).code).toBe("SERVER_MISCONFIGURED");
      expect((thrown as AppError).message).toContain("APP_ORIGIN");
    });
  });

  it("parses and validates bounded credentials", async () => {
    const request = new Request("https://prizgram.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        loginId: " Student.One ",
        password: "correct horse battery staple",
      }),
    });
    await expect(readCredentials(request)).resolves.toEqual({
      loginId: "student.one",
      password: "correct horse battery staple",
    });
  });

  it("rejects non-JSON and oversized chunked bodies", async () => {
    await expect(
      readCredentials(
        new Request("https://prizgram.test/api/auth/login", {
          method: "POST",
          body: "plain text",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(17_000));
      },
    });
    await expect(
      readCredentials(
        new Request("https://prizgram.test/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", status: 413 });
  });

  it("uses an HttpOnly same-site cookie and can clear it", () => {
    const cookie = sessionCookie("token", new Date("2026-09-01T00:00:00Z"));
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(
      sessionTokenFromRequest(
        new Request("https://prizgram.test", {
          headers: { cookie: `other=x; ${sessionCookieName()}=token` },
        }),
      ),
    ).toBe("token");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("uses a __Host-prefixed secure cookie in production", () => {
    withEnvironment({ NODE_ENV: "production" }, () => {
      expect(sessionCookieName()).toBe("__Host-prizgram_session");
      const cookie = sessionCookie("token", new Date("2026-09-01T00:00:00Z"));
      expect(cookie.startsWith("__Host-prizgram_session=")).toBe(true);
      expect(cookie).toContain("Secure");
      expect(clearSessionCookie().startsWith("__Host-prizgram_session=")).toBe(
        true,
      );
    });
  });

  it("marks auth responses as non-cacheable", async () => {
    const response = await withNoStore(() => new Response("private"))(
      new Request("https://prizgram.test"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("enforces the authentication rate limit after the API origin guard", () => {
    const limiter = createAuthRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const checkSpy = vi.spyOn(limiter, "check");

    expect(() =>
      authenticateMutationRequest(
        new Request("https://prizgram.test/api/auth/login", {
          method: "POST",
          headers: {
            host: "prizgram.test",
            origin: "https://prizgram.test",
          },
        }),
        { rateLimiter: limiter },
      ),
    ).not.toThrow();
    expect(checkSpy).toHaveBeenCalledTimes(1);

    let caught: unknown;
    try {
      authenticateMutationRequest(
        new Request("https://prizgram.test/api/auth/login", {
          method: "POST",
          headers: {
            host: "prizgram.test",
            origin: "https://prizgram.test",
          },
        }),
        { rateLimiter: limiter },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("RATE_LIMITED");
  });
});
