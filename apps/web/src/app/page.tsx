import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";

const features = [
  {
    title: "対話からペルソナを生成",
    body: "ヒアリングの回答から、スキル・経験・価値観を根拠付きで構造化します。",
  },
  {
    title: "3軸で求人を説明可能に評価",
    body: "skill fit / culture-value fit / difficulty gapを、理由と参照元とともに表示します。",
  },
  {
    title: "応募と締切を漏れなく管理",
    body: "選考ステータスの履歴、ES・面接・内定承諾の締切をひと続きで追跡します。",
  },
] as const;

export default async function Home() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).authenticate(token);
  if (user !== undefined) redirect("/app");

  return (
    <main className="landing">
      <p className="eyebrow">PRIZGRAM</p>
      <h1>就活の判断を、根拠と履歴から。</h1>
      <p className="landing-lead">
        対話、求人評価、選考管理をひとつの継続的なペルソナへつなげる就活パーソナルエージェントです。
      </p>
      <div className="landing-actions">
        <Link className="button button-primary" href="/register">
          新規登録
        </Link>
        <Link className="button button-secondary" href="/login">
          ログイン
        </Link>
      </div>
      <ul className="landing-features">
        {features.map((feature) => (
          <li key={feature.title}>
            <h2>{feature.title}</h2>
            <p>{feature.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
