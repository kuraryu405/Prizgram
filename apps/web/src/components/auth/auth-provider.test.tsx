// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { UNAUTHORIZED_EVENT } from "@/lib/api-client";
import { errorEnvelope, okEnvelope, stubFetch } from "@/test-support/http";

import { AuthProvider, useAuth } from "./auth-provider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe() {
  const { user, status, login, register, logout, reloadSession } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.loginId ?? "none"}</p>
      <button
        onClick={() =>
          void login({ loginId: "user", password: "password-123456" })
        }
        type="button"
      >
        login
      </button>
      <button
        onClick={() =>
          void register({ loginId: "user", password: "password-123456" })
        }
        type="button"
      >
        register
      </button>
      <button onClick={() => void logout()} type="button">
        signout
      </button>
      <button onClick={reloadSession} type="button">
        reload
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  test("restores the session via GET /api/auth/me", async () => {
    const fetchMock = stubFetch((url) =>
      url === "/api/auth/me"
        ? okEnvelope({ user: { id: "u1", loginId: "user" } })
        : new Response(null, { status: 500 }),
    );
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
    expect(screen.getByTestId("user").textContent).toContain("user");
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/me")).toBe(
      true,
    );
  });

  test("becomes unauthenticated when the session is missing", async () => {
    stubFetch(() => errorEnvelope(401, "AUTHENTICATION_REQUIRED"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "unauthenticated",
      ),
    );
    expect(screen.getByTestId("user").textContent).toContain("none");
  });

  test("login stores the authenticated user", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/login" && init?.method === "POST") {
        return okEnvelope({ user: { id: "u1", loginId: "user" } });
      }
      return errorEnvelope(404, "NOT_FOUND");
    });
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
    expect(screen.getByTestId("user").textContent).toContain("user");
  });

  test("does not let a delayed session probe undo a successful login", async () => {
    let resolveProbe: ((response: Response) => void) | undefined;
    stubFetch((url, init) => {
      if (url === "/api/auth/me") {
        return new Promise<Response>((resolve) => {
          resolveProbe = resolve;
        });
      }
      if (url === "/api/auth/login" && init?.method === "POST") {
        return okEnvelope({ user: { id: "u1", loginId: "user" } });
      }
      return errorEnvelope(404, "NOT_FOUND");
    });
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByRole("button", { name: "login" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );

    resolveProbe?.(errorEnvelope(401, "AUTHENTICATION_REQUIRED"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("status").textContent).toContain("authenticated");
    expect(screen.getByTestId("user").textContent).toContain("user");
  });

  test("register stores the authenticated user", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/register" && init?.method === "POST") {
        return okEnvelope({ user: { id: "u2", loginId: "user" } }, 201);
      }
      return errorEnvelope(404, "NOT_FOUND");
    });
    const user = userEvent.setup();
    renderProvider();
    await user.click(screen.getByRole("button", { name: "register" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
  });

  test("logout clears the authenticated user", async () => {
    stubFetch((url, init) => {
      if (url === "/api/auth/me")
        return okEnvelope({ user: { id: "u1", loginId: "user" } });
      if (url === "/api/auth/logout" && init?.method === "POST")
        return new Response(null, { status: 204 });
      return errorEnvelope(404, "NOT_FOUND");
    });
    const user = userEvent.setup();
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
    await user.click(screen.getByRole("button", { name: "signout" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "unauthenticated",
      ),
    );
    expect(screen.getByTestId("user").textContent).toContain("none");
  });

  test("clears the user when an unauthorized event fires", async () => {
    stubFetch((url) =>
      url === "/api/auth/me"
        ? okEnvelope({ user: { id: "u1", loginId: "user" } })
        : errorEnvelope(404, "NOT_FOUND"),
    );
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "unauthenticated",
      ),
    );
  });

  test("rejects malformed session payloads instead of trusting them", async () => {
    stubFetch((url) =>
      url === "/api/auth/me"
        ? okEnvelope({ user: { id: "", loginId: "BAD ID!" } })
        : errorEnvelope(404, "NOT_FOUND"),
    );
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "unauthenticated",
      ),
    );
  });

  test("treats transient /api/auth/me failures as unavailable, not logged out", async () => {
    stubFetch(() => Promise.reject(new TypeError("network down")));
    renderProvider();
    await waitFor(
      () =>
        expect(screen.getByTestId("status").textContent).toContain(
          "unavailable",
        ),
      { timeout: 5000 },
    );

    // The session cookie was never invalid, so recovery must not require a
    // fresh login.
    stubFetch((url) =>
      url === "/api/auth/me"
        ? okEnvelope({ user: { id: "u1", loginId: "user" } })
        : errorEnvelope(404, "NOT_FOUND"),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toContain(
        "authenticated",
      ),
    );
  }, 10_000);

  test("a 5xx probe response is retried instead of clearing the session", async () => {
    stubFetch(() => errorEnvelope(500, "INTERNAL_ERROR"));
    renderProvider();
    await waitFor(
      () =>
        expect(screen.getByTestId("status").textContent).toContain(
          "unavailable",
        ),
      { timeout: 5000 },
    );
    expect(screen.getByTestId("user").textContent).toContain("none");
  }, 10_000);
});
