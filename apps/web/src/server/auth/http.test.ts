import { describe, expect, it } from "vitest";

import { AppError } from "../api";
import {
  assertSameOrigin,
  clearSessionCookie,
  readCredentials,
  sessionCookie,
  sessionTokenFromRequest,
  withNoStore,
} from "./http";

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
          headers: { cookie: `other=x; prizgram_session=token` },
        }),
      ),
    ).toBe("token");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("marks auth responses as non-cacheable", async () => {
    const response = await withNoStore(() => new Response("private"))(
      new Request("https://prizgram.test"),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
