import Link from "next/link";
import { cookies } from "next/headers";

<<<<<<< HEAD
import { AuthService, sessionCookieName } from "@/server/auth";
=======
import { AuthService, SESSION_COOKIE_NAME } from "@/server/auth";
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
import { getDatabase } from "@/server/database";

const workItems = [
  {
    href: "/app/persona",
    title: "ペルソナ",
    body: "ヒアリングの回答から、あなたのスキル・経験・価値観を構造化して保存します。",
  },
  {
    href: "/app/jobs",
    title: "求人",
    body: "求人票を取り込み、要件・難易度を構造化して再現可能な形で保存します。",
  },
  {
    href: "/app/applications",
    title: "応募管理",
    body: "応募ごとの選考ステータスと履歴、次のアクションを管理します。",
  },
  {
    href: "/app/reminders",
    title: "リマインダー",
    body: "締切が近づいたら優先度付きで通知します。",
  },
] as const;

export default async function AppHome() {
<<<<<<< HEAD
  const token = (await cookies()).get(sessionCookieName())?.value;
=======
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
>>>>>>> 2200c73 (feat: ログイン・新規登録UIと認証済みアプリシェルを追加)
  const user = new AuthService(getDatabase()).requireUser(token);

  return (
    <div className="page">
      <h1>ようこそ、{user.loginId} さん</h1>
      <p className="page-lead">
        就活の進行状況をひと続きで管理します。まずはペルソナと求人を登録しましょう。
      </p>
      <ul className="card-grid">
        {workItems.map((item) => (
          <li key={item.href}>
            <Link className="card card-link" href={item.href}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
