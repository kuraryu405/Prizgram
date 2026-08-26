// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import { AuthProvider } from "@/components/auth/auth-provider";

import { AppShell } from "./app-shell";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: "/app",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: navigationMocks.replace,
    push: navigationMocks.push,
  }),
  usePathname: () => navigationMocks.pathname,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.replace.mockClear();
});

function renderShell() {
  return render(
    <AuthProvider>
      <AppShell>
        <p data-testid="content">本文</p>
      </AppShell>
    </AuthProvider>,
  );
}

function stubAuthenticatedSession() {
  return stubFetch((url, init) => {
    if (url === "/api/auth/me")
      return okEnvelope({ user: { id: "u1", loginId: "user01" } });
    if (url === "/api/auth/logout" && init?.method === "POST")
      return new Response(null, { status: 204 });
    throw new Error(`unexpected request to ${url}`);
  });
}

describe("AppShell", () => {
  test("shows a loading state while the session is being restored", () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderShell();
    expect(screen.getByRole("status").textContent?.includes("読み込み中")).toBe(
      true,
    );
    expect(screen.queryByTestId("content")).toBeNull();
  });

  test("redirects to the login page when unauthenticated", async () => {
    stubFetch(() => errorEnvelope(401, "AUTHENTICATION_REQUIRED"));
    renderShell();
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/login"),
    );
  });

  test("renders navigation with the active item marked", async () => {
    navigationMocks.pathname = "/app/jobs";
    stubAuthenticatedSession();
    renderShell();
    await waitFor(() => expect(screen.queryByTestId("content")).not.toBeNull());

    for (const label of [
      "ホーム",
      "ペルソナ",
      "求人",
      "応募",
      "締切",
      "通知",
    ]) {
      expect(screen.getByRole("link", { name: label }).textContent).toBe(label);
    }
    expect(
      screen.getByRole("link", { name: "求人" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "ホーム" }).getAttribute("aria-current"),
    ).toBeNull();
    navigationMocks.pathname = "/app";
  });

  test("logs out and returns to the landing page", async () => {
    const fetchMock = stubAuthenticatedSession();
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(screen.queryByTestId("content")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() =>
      expect(navigationMocks.replace).toHaveBeenCalledWith("/"),
    );
    const logoutCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/auth/logout",
    ) as unknown as [string, RequestInit];
    expect(logoutCall[1].method).toBe("POST");
  });

  test("shows an inline message when logout fails", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return okEnvelope({ user: { id: "u1", loginId: "user01" } });
      if (url === "/api/auth/logout" && init?.method === "POST")
        return errorEnvelope(500, "INTERNAL_ERROR");
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();
    renderShell();
    await waitFor(() => expect(screen.queryByTestId("content")).not.toBeNull());

    await user.click(screen.getByRole("button", { name: "ログアウト" }));
    await waitFor(() =>
      expect(
        document
          .querySelector('[role="alert"]')
          ?.textContent?.includes("サーバーで問題が発生しました"),
      ).toBe(true),
    );
    expect(navigationMocks.replace).not.toHaveBeenCalled();
  });
});
