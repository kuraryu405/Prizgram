"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  authenticatedUserSchema,
  type AuthenticatedUser,
} from "@prizgram/shared";

import {
  apiFetch,
  jsonRequestInit,
  UNAUTHORIZED_EVENT,
} from "@/lib/api-client";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = Readonly<{
  user: AuthenticatedUser | null;
  status: AuthStatus;
  refresh: () => Promise<void>;
  login: (credentials: { loginId: string; password: string }) => Promise<void>;
  register: (credentials: {
    loginId: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

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

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: unknown }>("/api/auth/me");
      setUser(authenticatedUserSchema.parse(data.user));
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  // The initial restore mirrors refresh() but keeps its state updates inside
  // promise callbacks so the effect never sets state synchronously.
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ user: unknown }>("/api/auth/me")
      .then((data) => {
        if (cancelled) return;
        setUser(authenticatedUserSchema.parse(data.user));
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setStatus("unauthenticated");
    };
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () =>
      window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

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
    () => ({ user, status, refresh, login, register, logout }),
    [user, status, refresh, login, register, logout],
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
