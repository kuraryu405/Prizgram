"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { describeApiError } from "@/lib/error-messages";

import { useAuth } from "@/components/auth/auth-provider";

const navigationItems = [
  { href: "/app", label: "ホーム" },
  { href: "/app/persona", label: "ペルソナ" },
  { href: "/app/jobs", label: "求人" },
  { href: "/app/applications", label: "応募管理" },
  { href: "/app/reminders", label: "リマインダー" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated" || user === null) {
    return (
      <p className="app-shell-status" role="status">
        読み込み中…
      </p>
    );
  }

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await logout();
      router.replace("/");
    } catch (error) {
      setLoggingOut(false);
      setLogoutError(describeApiError(error));
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へスキップ
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link className="app-brand" href="/app">
            PRIZGRAM
          </Link>
          <nav aria-label="メインナビゲーション" className="app-nav">
            <ul>
              {navigationItems.map((item) => (
                <li key={item.href}>
                  <Link
                    aria-current={
                      isActive(pathname, item.href) ? "page" : undefined
                    }
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="app-header-account">
            <span className="app-login-id">{user.loginId}</span>
            <button
              className="button button-secondary"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
              type="button"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>
      {logoutError !== null && (
        <p className="form-alert" role="alert">
          {logoutError}
        </p>
      )}
      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}
