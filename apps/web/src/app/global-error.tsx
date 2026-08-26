"use client";

import { useEffect } from "react";

import type { RouteErrorProps } from "@/components/app/error-recovery";

export default function GlobalError({ error, retry }: RouteErrorProps) {
  useEffect(() => {
    console.error("Unexpected root layout error", error);
  }, [error]);

  return (
    <html lang="ja">
      <body>
        <title>エラー | Prizgram</title>
        <main
          style={{
            alignItems: "center",
            background: "#f5f7f6",
            color: "#1b2722",
            display: "grid",
            fontFamily: "system-ui, sans-serif",
            justifyItems: "center",
            minHeight: "100vh",
            padding: "2rem 1rem",
          }}
        >
          <section
            aria-labelledby="global-error-title"
            role="alert"
            style={{
              background: "#ffffff",
              border: "1px solid #d8e0dc",
              borderRadius: "0.75rem",
              boxShadow: "0 1px 2px rgb(27 39 34 / 0.04)",
              display: "grid",
              gap: "1rem",
              maxWidth: "34rem",
              padding: "1.5rem",
              width: "100%",
            }}
          >
            <h1 id="global-error-title" style={{ fontSize: "1.5rem" }}>
              Prizgramを表示できませんでした
            </h1>
            <p style={{ lineHeight: 1.7, margin: 0 }}>
              一時的な問題が発生した可能性があります。しばらく待ってから再試行してください。
            </p>
            <button
              onClick={retry}
              style={{
                background: "#087a55",
                border: 0,
                borderRadius: "0.5rem",
                color: "#ffffff",
                cursor: "pointer",
                font: "inherit",
                fontWeight: 600,
                minHeight: "2.75rem",
                padding: "0 1.25rem",
                width: "fit-content",
              }}
              type="button"
            >
              再試行
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
