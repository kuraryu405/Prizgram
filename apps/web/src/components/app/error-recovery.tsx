"use client";

import Link from "next/link";
import { useEffect } from "react";

export interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function ErrorRecovery({ error, reset }: RouteErrorProps) {
  useEffect(() => {
    console.error("Unexpected route error", error);
  }, [error]);

  return (
    <section
      aria-labelledby="route-error-title"
      className="card error-recovery form-stack"
      role="alert"
    >
      <h1 id="route-error-title">画面の読み込みに失敗しました</h1>
      <p>
        一時的な問題が発生した可能性があります。しばらく待ってから再試行してください。
      </p>
      <div className="button-row">
        <button className="button button-primary" onClick={reset} type="button">
          再試行
        </button>
        <Link className="button button-secondary" href="/app">
          ホームへ戻る
        </Link>
      </div>
    </section>
  );
}
