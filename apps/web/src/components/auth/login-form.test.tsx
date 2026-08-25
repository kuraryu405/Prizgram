// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import { AuthProvider } from "./auth-provider";
import { LoginForm } from "./login-form";

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
      <LoginForm />
    </AuthProvider>,
  );
}

async function fillAndSubmit(loginId: string, password: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("ログインID"), loginId);
  await user.type(screen.getByLabelText("パスワード"), password);
  await user.click(screen.getByRole("button", { name: "ログイン" }));
}

describe("LoginForm", () => {
  test("shows validation errors without contacting the API", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error("fetch must not be called");
    });
    renderForm();
    await fillAndSubmit("ab", "short");
    expect(screen.getAllByText(/ログインID:/).length).toBeGreaterThan(0);
    expect(
      fetchMock.mock.calls.some(([url]) => url === "/api/auth/login"),
    ).toBe(false);
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });

  test("submits credentials once and navigates to /app on success", async () => {
    let resolveLogin: ((response: Response) => void) | undefined;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return errorEnvelope(401, "AUTHENTICATION_REQUIRED");
      if (url === "/api/auth/login" && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveLogin = resolve;
        });
      }
      throw new Error(`unexpected request to ${url}`);
    });

    renderForm();
    await fillAndSubmit("user01", "password-123456");

    const submitButton = screen.getByRole("button", {
      name: "ログイン",
    });
    await waitFor(() => expect(submitButton.matches(":disabled")).toBe(true));
    expect(submitButton.getAttribute("aria-busy")).toBe("true");

    // A click while submission is pending must not trigger another request.
    await userEvent.click(submitButton);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/auth/login"),
    ).toHaveLength(1);

    resolveLogin?.(okEnvelope({ user: { id: "u1", loginId: "user01" } }));
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/app"),
    );

    const loginCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/login",
    ) as unknown as [string, RequestInit];
    expect(JSON.parse(loginCall[1].body as string)).toEqual({
      loginId: "user01",
      password: "password-123456",
    });
  });

  test("displays a Japanese message for failed logins", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return errorEnvelope(401, "AUTHENTICATION_REQUIRED");
      if (url === "/api/auth/login" && init?.method === "POST")
        return errorEnvelope(401, "AUTHENTICATION_FAILED");
      throw new Error(`unexpected request to ${url}`);
    });
    renderForm();
    await fillAndSubmit("user01", "wrong-password-1");
    await waitFor(() =>
      expect(
        screen
          .getByRole("alert")
          .textContent?.includes(
            "ログインIDまたはパスワードが正しくありません",
          ),
      ).toBe(true),
    );
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
});
