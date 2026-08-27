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

  // Every session probe gets a generation. Authentication actions invalidate
  // older probes so a delayed 401 cannot overwrite a successful login.
  const restoreGenerationRef = useRef(0);

  /**
   * Resolves the session from /api/auth/me. Only an explicit 401 marks the
   * user as unauthenticated; network errors and 5xx stay unresolved and are
   * retried a limited number of times before surfacing as `unavailable`,
   * so a transient blip never kicks a signed-in user to the login page.
   */
  const restore = useCallback(
    function restoreFn(attempt = 0, generation = restoreGenerationRef.current) {
      clearRetryTimer();
      apiFetch<{ user: unknown }>("/api/auth/me", undefined, {
        notifyUnauthorized: false,
      })
        .then((data) => {
          if (generation !== restoreGenerationRef.current) return;
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
          if (generation !== restoreGenerationRef.current) return;
          if (isAuthRequiredError(error)) {
            setUser(null);
            setStatus("unauthenticated");
            return;
          }
          if (attempt < RESTORE_MAX_RETRIES) {
            retryTimerRef.current = window.setTimeout(
              () => restoreFn(attempt + 1, generation),
              500 * (attempt + 1),
            );
            return;
          }
          setStatus("unavailable");
        });
    },
    [clearRetryTimer],
  );

  const beginRestore = useCallback(() => {
    const generation = restoreGenerationRef.current + 1;
    restoreGenerationRef.current = generation;
    restore(0, generation);
  }, [restore]);

  const invalidateRestore = useCallback(() => {
    restoreGenerationRef.current += 1;
    clearRetryTimer();
  }, [clearRetryTimer]);

  useEffect(() => {
    beginRestore();
    return clearRetryTimer;
  }, [beginRestore, clearRetryTimer]);

  useEffect(() => {
    const handleUnauthorized = () => {
      invalidateRestore();
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [invalidateRestore]);

  const refresh = useCallback(async () => {
    const generation = restoreGenerationRef.current + 1;
    restoreGenerationRef.current = generation;
    clearRetryTimer();
    try {
      const data = await apiFetch<{ user: unknown }>(
        "/api/auth/me",
        undefined,
        { notifyUnauthorized: false },
      );
      if (generation !== restoreGenerationRef.current) return;
      setUser(authenticatedUserSchema.parse(data.user));
      setStatus("authenticated");
    } catch (error) {
      if (generation !== restoreGenerationRef.current) return;
      // A failed probe must not log the user out; only an explicit 401 does.
      if (isAuthRequiredError(error)) {
        setUser(null);
        setStatus("unauthenticated");
      }
    }
  }, [clearRetryTimer]);

  const reloadSession = useCallback(() => {
    setStatus("loading");
    beginRestore();
  }, [beginRestore]);

  const login = useCallback(
    async (credentials: { loginId: string; password: string }) => {
      invalidateRestore();
      setUser(await requestSession("/api/auth/login", credentials));
      setStatus("authenticated");
    },
    [invalidateRestore],
  );

  const register = useCallback(
    async (credentials: { loginId: string; password: string }) => {
      invalidateRestore();
      setUser(await requestSession("/api/auth/register", credentials));
      setStatus("authenticated");
    },
    [invalidateRestore],
  );

  const logout = useCallback(async () => {
    invalidateRestore();
    await apiFetch<undefined>("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("unauthenticated");
  }, [invalidateRestore]);

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
