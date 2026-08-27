"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

const NAV_LINKS = [
  { href: "#about", label: "Prizgramとは" },
  { href: "#capabilities", label: "できること" },
  { href: "#how-it-works", label: "仕組み" },
  { href: "#product", label: "プロダクト" },
] as const;

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const background = document.querySelectorAll<HTMLElement>(
      ".lp-root > main, .lp-footer",
    );
    document.body.style.overflow = "hidden";
    background.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    const focusTimer = window.setTimeout(() => {
      overlayRef.current
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = prev;
      background.forEach((element) => {
        element.inert = false;
        element.removeAttribute("aria-hidden");
      });
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!href.startsWith("#")) return;
      e.preventDefault();
      setOpen(false);
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
          <Link href="/register" className="lp-nav-cta">
            はじめる
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            aria-label={open ? "メニューを閉じる" : "メニューを開く"}
            aria-expanded={open}
            aria-controls="lp-mobile-nav"
            className="lp-nav-menu-btn"
            onClick={() => setOpen((v) => !v)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              {open ? (
                <path d="M6 6l12 12M18 6L6 18" />
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div
          ref={overlayRef}
          id="lp-mobile-nav"
          className="lp-mobile"
          role="dialog"
          aria-modal="true"
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
            <button
              type="button"
              aria-label="メニューを閉じる"
              onClick={() => setOpen(false)}
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                border: "1px solid rgba(10,10,10,0.14)",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              <svg
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
            </button>
          </div>
          <div>
            <nav
              aria-label="モバイルナビゲーション"
              className="lp-mobile-links"
            >
              {NAV_LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={(e) => handleNavClick(e, l.href)}
                >
                  {l.label}
                </a>
              ))}
              <a href="/login" onClick={() => setOpen(false)}>
                ログイン
              </a>
            </nav>
            <Link
              href="/register"
              className="lp-mobile-cta"
              onClick={() => setOpen(false)}
            >
              Prizgramをはじめる →
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
