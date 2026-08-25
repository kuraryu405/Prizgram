import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
<<<<<<< HEAD
import { AuthService, sessionCookieName } from "@/server/auth";
=======
import { AuthService, SESSION_COOKIE_NAME } from "@/server/auth";
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
import { getDatabase } from "@/server/database";

export const metadata: Metadata = { title: "ログイン | Prizgram" };

export default async function LoginPage() {
<<<<<<< HEAD
  const token = (await cookies()).get(sessionCookieName())?.value;
=======
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
  if (new AuthService(getDatabase()).authenticate(token) !== undefined) {
    redirect("/app");
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="login-title" className="card auth-card">
        <h1 id="login-title">ログイン</h1>
        <LoginForm />
        <p className="auth-switch">
          アカウントをお持ちでない方は <Link href="/register">新規登録</Link>へ
        </p>
      </section>
    </main>
  );
}
