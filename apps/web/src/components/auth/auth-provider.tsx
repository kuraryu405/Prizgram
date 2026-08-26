"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  authenticatedUserSchema,
  type AuthenticatedUser,
} from "@prizgram/shared";

import {
  ApiClientError,
  apiFetch,
  jsonRequestInit,
  UNAUTHORIZED_EVENT,
} from "@/lib/api-client";

export type AuthStatus =
  "loading" | "authenticated" | "unauthenticated" | "unavailable";

type AuthContextValue = Readonly<{
  user: AuthenticatedUser | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
  /** Restarts session restoration after a transient failure. */
  reloadSession: () => void;
  login: (credentials: { loginId: string; password: string }) => Promise<void>;
  register: (credentials: {
    loginId: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

const RESTORE_MAX_RETRIES = 2;

function isAuthRequiredError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

async function requestSession(
  path: string,
  credentials: { loginId: string; password: string },
): Promise<AuthenticatedUser> {
  const data = await apiFetch<{ user: unknown }>(
    path,
    jsonRequestInit("POST", credentials),
  );
  return authenticatedUserSchema.parse(data.user);
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const retryTimerRef = useRef<number | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const restoreRef = useRef<(attempt?: number) => void>(() => undefined);

  /**
   * Resolves the session from /api/auth/me. Only an explicit 401 marks the
   * user as unauthenticated; network errors and 5xx stay unresolved and are
   * retried a limited number of times before surfacing as `unavailable`,
   * so a transient blip never kicks a signed-in user to the login page.
   */
  const restore = useCallback(
    (attempt = 0) => {
      clearRetryTimer();
      apiFetch<{ user: unknown }>("/api/auth/me")
        .then((data) => {
          const parsed = authenticatedUserSchema.safeParse(data.user);
          if (!parsed.success) {
            // Malformed payloads must not be trusted as a session.
            setUser(null);
            setStatus("unauthenticated");
            return;
          }
          setUser(parsed.data);
          setStatus("authenticated");
        })
        .catch((error: unknown) => {
          if (isAuthRequiredError(error)) {
            setUser(null);
            setStatus("unauthenticated");
            return;
          }
          if (attempt < RESTORE_MAX_RETRIES) {
            retryTimerRef.current = window.setTimeout(
              () => restoreRef.current(attempt + 1),
              500 * (attempt + 1),
            );
            return;
          }
          setStatus("unavailable");
        });
    },
    [clearRetryTimer],
  );

  useEffect(() => {
    restoreRef.current = restore;
  }, [restore]);

  useEffect(() => {
    restore();
    return clearRetryTimer;
  }, [restore, clearRetryTimer]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: unknown }>("/api/auth/me");
      setUser(authenticatedUserSchema.parse(data.user));
      setStatus("authenticated");
    } catch (error) {
      // A failed probe must not log the user out; only an explicit 401 does.
      if (isAuthRequiredError(error)) {
        setUser(null);
        setStatus("unauthenticated");
      }
    }
  }, []);

  const reloadSession = useCallback(() => {
    setStatus("loading");
    restore();
  }, [restore]);

  const login = useCallback(
    async (credentials: { loginId: string; password: string }) => {
      setUser(await requestSession("/api/auth/login", credentials));
      setStatus("authenticated");
    },
    [],
  );

  const register = useCallback(
    async (credentials: { loginId: string; password: string }) => {
      setUser(await requestSession("/api/auth/register", credentials));
      setStatus("authenticated");
    },
    [],
  );

  const logout = useCallback(async () => {
    await apiFetch<undefined>("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      refresh,
      reloadSession,
      login,
      register,
      logout,
    }),
    [user, status, refresh, reloadSession, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
