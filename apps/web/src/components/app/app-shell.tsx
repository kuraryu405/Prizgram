"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { describeApiError } from "@/lib/error-messages";

import { useAuth } from "@/components/auth/auth-provider";
import { useToast } from "@/components/app/toast";

function HomeIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
    </svg>
  );
}

function PersonaIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5c0-3.8 3.6-6 8-6s8 2.2 8 6" />
    </svg>
  );
}

function JobsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4-4" />
    </svg>
  );
}

function ApplicationsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </svg>
  );
}

function DeadlinesIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function RemindersIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="M18 9a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </svg>
  );
}

const navigationItems = [
  { href: "/app", Icon: HomeIcon, label: "ホーム" },
  { href: "/app/persona", Icon: PersonaIcon, label: "ペルソナ" },
  { href: "/app/jobs", Icon: JobsIcon, label: "求人" },
  { href: "/app/applications", Icon: ApplicationsIcon, label: "応募" },
  { href: "/app/deadlines", Icon: DeadlinesIcon, label: "締切" },
  { href: "/app/reminders", Icon: RemindersIcon, label: "通知" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { user, status, logout, reloadSession } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "unavailable") {
    // Transient failures must not look like a logged-out session.
    return (
      <main className="app-main">
        <div className="card form-stack" role="alert">
          <p>
            セッション情報の取得に失敗しました。ネットワークを確認してください。
          </p>
          <div className="button-row">
            <button
              className="button button-primary"
              onClick={reloadSession}
              type="button"
            >
              再試行
            </button>
            <Link className="button button-secondary" href="/login">
              ログインへ
            </Link>
          </div>
        </div>
      </main>
    );
  }

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
    try {
      await logout();
      router.replace("/");
    } catch (error) {
      setLoggingOut(false);
      notify({ variant: "error", message: describeApiError(error) });
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へスキップ
      </a>
      <div className="app-layout">
        <header className="app-header">
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
                    <item.Icon />
                    <span>{item.label}</span>
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
        </header>
        <main className="app-main" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
