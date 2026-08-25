import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";

import {
  apiNoContent,
  apiResult,
  AppError,
  parseRequest,
  withApiHandler,
} from "./errors";

afterEach(() => {
  vi.restoreAllMocks();
});

function spyConsoleError(): MockInstance {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

function loggedErrors(spy: MockInstance): string[] {
  return spy.mock.calls.map(([payload]) => String(payload));
}

describe("withApiHandler", () => {
  it("returns a consistent success envelope", async () => {
    const response = await withApiHandler(() => ({ value: 1 }))(
      new Request("https://example.test", {
        headers: { "x-request-id": "request-1" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { value: 1 },
      requestId: "request-1",
    });
  });

  it("preserves success status and headers", async () => {
    const response = await withApiHandler(() =>
      apiResult(
        { id: "created" },
        { status: 201, headers: { "set-cookie": "session=test; HttpOnly" } },
      ),
    )(new Request("https://example.test"));
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("supports a bodyless 204 response", async () => {
    const response = await withApiHandler(() =>
      apiNoContent({ "cache-control": "no-store" }),
    )(new Request("https://example.test"));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    await expect(response.text()).resolves.toBe("");
  });

  it("does not allow a body helper to construct a 204 response", () => {
    expect(() =>
      // @ts-expect-error A bodyless response must use apiNoContent.
      apiResult({ invalid: true }, { status: 204 }),
    ).toThrow(/permits a body/);
  });

  it("maps Zod and explicit application errors", async () => {
    const validationResponse = await withApiHandler(() => {
      parseRequest(z.object({ name: z.string().min(1) }), { name: "" });
    })(new Request("https://example.test"));
    expect(validationResponse.status).toBe(400);
    expect(await validationResponse.json()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });

    const conflictResponse = await withApiHandler(() => {
      throw new AppError("ALREADY_EXISTS", "Already exists", 409);
    })(new Request("https://example.test"));
    expect(conflictResponse.status).toBe(409);
    expect(await conflictResponse.json()).toMatchObject({
      error: { code: "ALREADY_EXISTS", message: "Already exists" },
    });
  });

  it("does not expose unexpected error details", async () => {
    const response = await withApiHandler(() => {
      throw new Error("database password and stack");
    })(new Request("https://example.test"));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain("An unexpected error occurred");
    expect(body).not.toContain("database password");
  });

  it("does not misclassify an internal Zod failure as bad input", async () => {
    const response = await withApiHandler(() =>
      z.object({ id: z.string() }).parse({ id: 1 }),
    )(new Request("https://example.test"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });
  });

  it("does not reflect an unsafe request id into response headers", async () => {
    const response = await withApiHandler(() => ({ ok: true }))(
      new Request("https://example.test", {
        headers: { "x-request-id": "unsafe request id" },
      }),
    );
    expect(response.headers.get("x-request-id")).not.toBe("unsafe request id");
  });

  it("logs an unexpected error once with the same requestId it returns", async () => {
    const errorSpy = spyConsoleError();
    const request = new Request("https://example.test/api/things?query=secret");
    const response = await withApiHandler(() => {
      throw new Error("database exploded");
    })(request);
    expect(response.status).toBe(500);
    const {
      error: { requestId },
    } = (await response.json()) as { error: { requestId: string } };

    expect(loggedErrors(errorSpy)).toHaveLength(1);
    const payload = JSON.parse(loggedErrors(errorSpy)[0] ?? "{}") as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      level: "error",
      code: "INTERNAL_ERROR",
      method: "GET",
      path: "/api/things",
      requestId,
      requestIdSource: "server",
      name: "Error",
      message: "database exploded",
    });
    expect(typeof payload.stack).toBe("string");
  });

  it("keeps credentials and query strings out of the error log", async () => {
    const errorSpy = spyConsoleError();
    const request = new Request(
      "https://example.test/api/auth/login?token=leaky",
      {
        method: "POST",
        headers: {
          authorization: "Bearer super-secret-token",
          cookie: "prizgram_session=super-secret-session",
        },
        body: JSON.stringify({ password: "super-secret-password" }),
      },
    );
    await withApiHandler(() => {
      throw new Error("failed after reading the request");
    })(request);

    expect(loggedErrors(errorSpy)).toHaveLength(1);
    expect(loggedErrors(errorSpy)[0]).not.toContain("super-secret-token");
    expect(loggedErrors(errorSpy)[0]).not.toContain("super-secret-session");
    expect(loggedErrors(errorSpy)[0]).not.toContain("super-secret-password");
    expect(loggedErrors(errorSpy)[0]).not.toContain("leaky");
  });

  it("does not log expected client-facing application errors", async () => {
    const errorSpy = spyConsoleError();
    const conflict = await withApiHandler(() => {
      throw new AppError("ALREADY_EXISTS", "Already exists", 409);
    })(new Request("https://example.test"));
    const invalid = await withApiHandler(() => {
      parseRequest(z.object({ name: z.string().min(1) }), { name: "" });
    })(new Request("https://example.test"));
    expect(conflict.status).toBe(409);
    expect(invalid.status).toBe(400);
    expect(loggedErrors(errorSpy)).toEqual([]);
  });

  it("logs server-fault application errors with their own code", async () => {
    const errorSpy = spyConsoleError();
    const response = await withApiHandler(() => {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "Origin is not configured",
        500,
      );
    })(
      new Request("https://example.test", {
        headers: { "x-request-id": "client-id-1" },
      }),
    );
    expect(response.status).toBe(500);

    expect(loggedErrors(errorSpy)).toHaveLength(1);
    expect(JSON.parse(loggedErrors(errorSpy)[0] ?? "{}")).toMatchObject({
      code: "SERVER_MISCONFIGURED",
      message: "Origin is not configured",
      requestId: "client-id-1",
      requestIdSource: "client",
    });
  });

  it("propagates AppError response headers such as Retry-After", async () => {
    const response = await withApiHandler(() => {
      throw new AppError("RATE_LIMITED", "Too many attempts", 429, undefined, {
        "retry-after": "42",
      });
    })(new Request("https://example.test"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
