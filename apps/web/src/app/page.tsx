import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AuthService, sessionCookieName } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { LandingExperience } from "@/components/landing/landing-experience";

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
      <div className="landing-grid">
        <section aria-labelledby="landing-title" className="landing-copy">
          <div className="landing-wordmark">
            <span aria-hidden="true" className="landing-wordmark-mark">
              P
            </span>
            <span>PRIZGRAM</span>
          </div>
          <p className="eyebrow">就活パーソナルエージェント</p>
          <h1 id="landing-title">
            就活の判断を、
            <span>根拠と履歴から。</span>
          </h1>
          <p className="landing-lead">
            対話、求人評価、選考管理をひとつの継続的なペルソナへつなげる、あなたのための就活パートナーです。
          </p>
          <div className="landing-actions">
            <Link className="button button-primary" href="/register">
              新規登録
            </Link>
            <Link className="button button-secondary" href="/login">
              ログイン
            </Link>
          </div>
          <p className="landing-note">
            あなたの経験を整理し、次の一歩を迷わず選べるように。
          </p>
        </section>
        <LandingExperience />
      </div>
      <section
        aria-labelledby="landing-features-title"
        className="landing-features-section"
      >
        <div className="landing-features-heading">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2 id="landing-features-title">選考のすべてを、ひと続きに。</h2>
        </div>
        <ul className="landing-features">
          {features.map((feature, index) => (
            <li key={feature.title}>
              <span aria-hidden="true" className="landing-feature-index">
                0{index + 1}
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
