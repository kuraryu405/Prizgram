"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { describeApiError } from "@/lib/error-messages";

import { useAuth } from "@/components/auth/auth-provider";

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

function MoreIcon() {
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
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19.5" cy="12" r="1.8" />
      <circle cx="4.5" cy="12" r="1.8" />
    </svg>
  );
}

// Primary navigation (bottom bar / sidebar). Secondary items live in the
// header bell and the account menu / More sheet so the bottom bar stays at
// 5 tap targets with comfortable width even at 320px.
const primaryNavigationItems = [
  { href: "/app", Icon: HomeIcon, label: "ホーム" },
  { href: "/app/jobs", Icon: JobsIcon, label: "求人" },
  { href: "/app/applications", Icon: ApplicationsIcon, label: "応募" },
  { href: "/app/persona", Icon: PersonaIcon, label: "ペルソナ" },
] as const;

const secondaryNavigationItems = [
  { href: "/app/deadlines", Icon: DeadlinesIcon, label: "締切" },
  { href: "/app/reminders", Icon: RemindersIcon, label: "通知" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getAccountInitials(loginId: string): string {
  const parts = loginId.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  return loginId.slice(0, 2).toUpperCase();
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { user, status, logout, reloadSession } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      const next = encodeURIComponent(pathname);
      router.replace(`/login?next=${next}`);
    }
  }, [status, router, pathname]);

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
    setLogoutError(null);
    try {
      await logout();
      router.replace("/");
    } catch (error) {
      setLoggingOut(false);
      setLogoutError(describeApiError(error));
    }
  };

  const isMoreActive = secondaryNavigationItems.some((item) =>
    isActive(pathname, item.href),
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        本文へスキップ
      </a>
      <div className="app-layout">
        <header className="app-header">
          <Link aria-label="PRIZGRAM" className="app-brand" href="/app">
            PRIZGRAM
          </Link>
          <nav aria-label="メインナビゲーション" className="app-nav">
            <ul>
              {primaryNavigationItems.map((item) => (
                <li key={item.href}>
                  <Link
                    aria-label={item.label}
                    aria-current={
                      isActive(pathname, item.href) ? "page" : undefined
                    }
                    data-tooltip={item.label}
                    href={item.href}
                    title={item.label}
                  >
                    <item.Icon />
                    <span className="app-nav-label">{item.label}</span>
                  </Link>
                </li>
              ))}
              {/* Mobile-only: More sheet containing secondary items + profile */}
              <li className="app-nav-item--more">
                <details className="app-nav-more">
                  <summary
                    aria-label="その他"
                    aria-current={isMoreActive ? "page" : undefined}
                    className={
                      isMoreActive
                        ? "app-nav-more-trigger is-active"
                        : "app-nav-more-trigger"
                    }
                    data-tooltip="その他"
                    title="その他"
                  >
                    <MoreIcon />
                    <span className="app-nav-label">その他</span>
                  </summary>
                  <div className="app-nav-more-panel">
                    {secondaryNavigationItems.map((item) => (
                      <Link
                        key={item.href}
                        aria-current={
                          isActive(pathname, item.href) ? "page" : undefined
                        }
                        className="app-nav-more-link"
                        href={item.href}
                      >
                        <item.Icon />
                        <span>{item.label}</span>
                      </Link>
                    ))}
                    <Link
                      aria-current={
                        isActive(pathname, "/app/profile") ? "page" : undefined
                      }
                      className="app-nav-more-link"
                      href="/app/profile"
                    >
                      <PersonaIcon />
                      <span>プロフィール</span>
                    </Link>
                  </div>
                </details>
              </li>
            </ul>
          </nav>
          <div className="app-header-account">
            <Link
              aria-label="通知"
              className="app-header-bell"
              href="/app/reminders"
              title="通知"
            >
              <RemindersIcon />
            </Link>
            <details className="app-account-menu">
              <summary
                aria-label={`アカウント ${user.loginId}`}
                className="app-account-trigger"
                title={`アカウント ${user.loginId}`}
              >
                <span aria-hidden="true" className="app-account-avatar">
                  {getAccountInitials(user.loginId)}
                </span>
                <span className="app-account-copy">
                  <span className="app-login-id">{user.loginId}</span>
                </span>
              </summary>
              <div className="app-account-popover">
                <Link className="button button-secondary" href="/app/profile">
                  プロフィール
                </Link>
                <button
                  className="button button-secondary"
                  disabled={loggingOut}
                  onClick={() => void handleLogout()}
                  type="button"
                >
                  ログアウト
                </button>
              </div>
            </details>
          </div>
        </header>
        {logoutError !== null && (
          <p className="form-alert app-shell-alert" role="alert">
            {logoutError}
          </p>
        )}
        <main className="app-main" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
