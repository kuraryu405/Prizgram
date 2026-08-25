import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError, parseRequest, withApiHandler } from "./errors";

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
});
