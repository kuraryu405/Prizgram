// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  apiFetch,
  ApiClientError,
  jsonRequestInit,
  UNAUTHORIZED_EVENT,
} from "./api-client";

function okEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data, requestId: "req-1" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorEnvelope(
  status: number,
  code: string,
  fieldErrors?: Record<string, string[]>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message: "failure",
        requestId: "req-1",
        ...(fieldErrors === undefined ? {} : { fieldErrors }),
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  test("returns the envelope data on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okEnvelope({ id: "a" })));
    await expect(apiFetch<{ id: string }>("/api/example")).resolves.toEqual({
      id: "a",
    });
  });

  test("throws a typed error with API details on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorEnvelope(409, "LOGIN_ID_TAKEN")),
    );
    const error = await apiFetch("/api/example").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    const clientError = error as ApiClientError;
    expect(clientError.code).toBe("LOGIN_ID_TAKEN");
    expect(clientError.status).toBe(409);
    expect(clientError.requestId).toBe("req-1");
  });

  test("propagates field errors from validation failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          errorEnvelope(400, "VALIDATION_ERROR", { loginId: ["短すぎます"] }),
        ),
    );
    const error = (await apiFetch("/api/example").catch(
      (caught: unknown) => caught,
    )) as ApiClientError;
    expect(error.fieldErrors).toEqual({ loginId: ["短すぎます"] });
  });

  test("maps transport failures to NETWORK_ERROR", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const error = (await apiFetch("/api/example").catch(
      (caught: unknown) => caught,
    )) as ApiClientError;
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.status).toBe(0);
  });

  test("reports unreadable non-JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html></html>", { status: 500 })),
    );
    const error = (await apiFetch("/api/example").catch(
      (caught: unknown) => caught,
    )) as ApiClientError;
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.status).toBe(500);
  });

  test("reports envelopes that are not shaped as expected", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"unexpected":true}', { status: 200 }),
        ),
    );
    const error = (await apiFetch("/api/example").catch(
      (caught: unknown) => caught,
    )) as ApiClientError;
    expect(error.code).toBe("INVALID_RESPONSE");
  });

  test("resolves to undefined for 204 responses without parsing a body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      apiFetch<undefined>("/api/auth/logout"),
    ).resolves.toBeUndefined();
  });

  test("dispatches an unauthorized event on session expiry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(errorEnvelope(401, "AUTHENTICATION_REQUIRED")),
    );
    const listener = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, listener);
    try {
      await expect(apiFetch("/api/example")).rejects.toBeInstanceOf(
        ApiClientError,
      );
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, listener);
    }
  });
});

describe("jsonRequestInit", () => {
  test("builds a JSON POST request descriptor", () => {
    const init = jsonRequestInit("POST", { loginId: "user" });
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ loginId: "user" }));
  });
});
