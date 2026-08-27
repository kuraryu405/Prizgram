import type { Metadata } from "next";
import Link from "next/link";

import { PublicPasswordChangeForm } from "@/components/auth/public-password-change-form";
import { PublicHeader } from "@/components/landing-v2/public-header";

export const metadata: Metadata = { title: "パスワード変更 | Prizgram" };

export default function PasswordChangePage() {
  return (
    <>
      <PublicHeader actionHref="/login" actionLabel="ログイン" />
      <main className="auth-page">
        <section
          aria-labelledby="password-change-title"
          className="card auth-card"
        >
          <h1 id="password-change-title">パスワード変更</h1>
          <PublicPasswordChangeForm />
          <p className="auth-switch">
            <Link href="/login">ログインへ戻る</Link>
          </p>
        </section>
      </main>
    </>
  );
}
