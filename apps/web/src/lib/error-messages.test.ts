import { describe, expect, test } from "vitest";

import { describeApiError, errorMessageFor } from "./error-messages";

describe("errorMessageFor", () => {
  test("maps known codes to Japanese messages", () => {
    expect(errorMessageFor("LOGIN_ID_TAKEN")).toBe(
      "このログインIDは既に使用されています。",
    );
    expect(errorMessageFor("AUTHENTICATION_FAILED")).toBe(
      "ログインIDまたはパスワードが正しくありません。",
    );
    expect(errorMessageFor("AUTHENTICATION_REQUIRED")).toContain(
      "セッションの有効期限が切れました",
    );
  });

  test("falls back to a generic message for unknown codes", () => {
    expect(errorMessageFor("FUTURE_CODE")).not.toBe("");
    expect(errorMessageFor("FUTURE_CODE")).toMatch(/再度/);
  });
});

describe("describeApiError", () => {
  test("uses the mapped message for ApiClientError instances", async () => {
    const { ApiClientError } = await import("./api-client");
    expect(
      describeApiError(new ApiClientError("NETWORK_ERROR", "x", 0)),
    ).toContain("ネットワークエラー");
  });

  test("uses the generic message for unrelated values", () => {
    expect(describeApiError(new Error("boom"))).toMatch(/問題が発生しました/);
    expect(describeApiError(undefined)).toMatch(/問題が発生しました/);
  });
});
