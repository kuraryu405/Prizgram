import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/register-form";
import { AuthService, SESSION_COOKIE_NAME } from "@/server/auth";
import { getDatabase } from "@/server/database";

export const metadata: Metadata = { title: "新規登録 | Prizgram" };

export default async function RegisterPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (new AuthService(getDatabase()).authenticate(token) !== undefined) {
    redirect("/app");
  }

  return (
    <main className="auth-page">
      <section aria-labelledby="register-title" className="card auth-card">
        <h1 id="register-title">新規登録</h1>
        <RegisterForm />
        <p className="auth-switch">
          既にアカウントをお持ちの方は <Link href="/login">ログイン</Link>へ
        </p>
      </section>
    </main>
  );
}
