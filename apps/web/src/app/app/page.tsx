import Link from "next/link";
import { cookies } from "next/headers";

import { ReminderService } from "@prizgram/db";

import { AuthService, sessionCookieName } from "@/server/auth";
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
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).requireUser(token);
  const reminderCounts = new ReminderService(getDatabase().db).countActive(
    user.id,
  );

  return (
    <div className="page">
      <h1>ようこそ、{user.loginId} さん</h1>
      {reminderCounts.total > 0 && (
        <p className="form-alert" role="status">
          未読のリマインダーがあります（緊急 {reminderCounts.urgent} 件 / 全体{" "}
          {reminderCounts.total} 件） —{" "}
          <Link href="/app/reminders">確認する</Link>
        </p>
      )}
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
