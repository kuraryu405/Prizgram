"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const NAV_LINKS = [
  { href: "#about", label: "Prizgramとは" },
  { href: "#capabilities", label: "できること" },
  { href: "#how-it-works", label: "仕組み" },
  { href: "#product", label: "プロダクト" },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!href.startsWith("#")) return;
      e.preventDefault();
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else window.location.hash = href;
    },
    [],
  );

  return (
    <>
      <nav
        aria-label="グローバルナビゲーション"
        className={`lp-nav${scrolled ? " is-scrolled" : ""}`}
      >
        <Link href="/" className="lp-nav-left" aria-label="Prizgram トップ">
          <Image
            src="/brand/prizgram-horizontal.svg"
            alt=""
            width={2103}
            height={748}
            className="lp-nav-logo"
            priority
          />
        </Link>

        <div className="lp-nav-center">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => handleNavClick(e, l.href)}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <Link href="/login" className="lp-nav-login">
            ログイン
          </Link>
          <Link href="/register" className="lp-nav-cta">
            はじめる
          </Link>
          <details className="lp-mobile-details">
            <summary
              aria-label="メニューを開く／閉じる"
              className="lp-nav-menu-btn"
            >
              <svg
                className="lp-menu-icon-open"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M4 7h16" />
                <path d="M4 12h16" />
                <path d="M4 17h16" />
              </svg>
              <svg
                className="lp-menu-icon-close"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </summary>
            <div
              id="lp-mobile-nav"
              className="lp-mobile"
              aria-label="ナビゲーションメニュー"
            >
              <div className="lp-mobile-top">
                <Image
                  src="/brand/prizgram-horizontal.svg"
                  alt="Prizgram"
                  width={2103}
                  height={748}
                  className="lp-mobile-logo"
                />
              </div>
              <div>
                <nav
                  aria-label="モバイルナビゲーション"
                  className="lp-mobile-links"
                >
                  {NAV_LINKS.map((l) => (
                    <a key={l.href} href={l.href}>
                      {l.label}
                    </a>
                  ))}
                  <a href="/login">ログイン</a>
                </nav>
                <Link href="/register" className="lp-mobile-cta">
                  Prizgramをはじめる →
                </Link>
              </div>
            </div>
          </details>
        </div>
      </nav>
    </>
  );
}
