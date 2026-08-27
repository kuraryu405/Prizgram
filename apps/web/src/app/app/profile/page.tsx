import Link from "next/link";

import { PasswordChangeForm } from "@/components/auth/password-change-form";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireSessionUserPage();
  return (
    <div className="page">
      <h1>プロフィール</h1>
      <section className="card">
        <h2>アカウント</h2>
        <p>
          ログインID: <strong>{user.loginId}</strong>
        </p>
      </section>
      <PasswordChangeForm />
      <div className="card-footer">
        <Link className="button button-secondary" href="/app">
          ホームへ戻る
        </Link>
      </div>
    </div>
  );
}
