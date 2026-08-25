// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import { AuthProvider } from "./auth-provider";
import { RegisterForm } from "./register-form";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationMocks.replace,
    push: navigationMocks.push,
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.replace.mockClear();
});

function renderForm() {
  return render(
    <AuthProvider>
      <RegisterForm />
    </AuthProvider>,
  );
}

describe("RegisterForm", () => {
  test("rejects mismatched password confirmation without contacting the API", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error("fetch must not be called");
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("ログインID"), "user01");
    await user.type(screen.getByLabelText("パスワード"), "password-123456");
    await user.type(
      screen.getByLabelText("パスワード（確認）"),
      "password-999999",
    );
    await user.click(screen.getByRole("button", { name: "アカウントを作成" }));

    expect(screen.getByText(/パスワードが一致しません/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/auth/register"),
    ).toBe(false);
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  test("shows a Japanese message when the login ID is already taken", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return errorEnvelope(401, "AUTHENTICATION_REQUIRED");
      if (url === "/api/auth/register" && init?.method === "POST")
        return errorEnvelope(409, "LOGIN_ID_TAKEN");
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("ログインID"), "user01");
    await user.type(screen.getByLabelText("パスワード"), "password-123456");
    await user.type(
      screen.getByLabelText("パスワード（確認）"),
      "password-123456",
    );
    await user.click(screen.getByRole("button", { name: "アカウントを作成" }));

    await waitFor(() =>
      expect(
        document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("このログインIDは既に使用されています"),
      ).toBe(true),
    );
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  test("creates the account and navigates to /app on success", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return errorEnvelope(401, "AUTHENTICATION_REQUIRED");
      if (url === "/api/auth/register" && init?.method === "POST") {
        return okEnvelope({ user: { id: "u1", loginId: "user01" } }, 201);
      }
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("ログインID"), "User01");
    await user.type(screen.getByLabelText("パスワード"), "password-123456");
    await user.type(
      screen.getByLabelText("パスワード（確認）"),
      "password-123456",
    );
    await user.click(screen.getByRole("button", { name: "アカウントを作成" }));

    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/app"),
    );
    const registerCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/register",
    ) as unknown as [string, RequestInit];
    expect(JSON.parse(registerCall[1].body as string)).toEqual({
      loginId: "user01",
      password: "password-123456",
    });
  });

  test("displays API field errors for invalid input", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return errorEnvelope(401, "AUTHENTICATION_REQUIRED");
      if (url === "/api/auth/register" && init?.method === "POST") {
        return errorEnvelope(400, "VALIDATION_ERROR", "validation failed", {
          loginId: ["既に予約されたIDです"],
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("ログインID"), "user01");
    await user.type(screen.getByLabelText("パスワード"), "password-123456");
    await user.type(
      screen.getByLabelText("パスワード（確認）"),
      "password-123456",
    );
    await user.click(screen.getByRole("button", { name: "アカウントを作成" }));

    await waitFor(() =>
      expect(screen.getAllByText(/ログインID:/).length).toBeGreaterThan(0),
    );
  });
});
