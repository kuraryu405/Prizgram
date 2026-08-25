import Link from "next/link";

import { getDatabase } from "@/server/database";
import { PersonaService } from "@/server/persona/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

const skillLevelLabels: Readonly<Record<string, string>> = {
  advanced: "上級",
  beginner: "入門",
  expert: "専門",
  intermediate: "中級",
};

export default async function PersonaPage() {
  const user = await requireSessionUserPage();
  const service = new PersonaService(getDatabase());
  const latest = service.latestPersona(user.id);
  const versions = service.listVersions(user.id);

  if (latest === undefined) {
    return (
      <div className="page">
        <h1>ペルソナ</h1>
        <p className="page-lead">
          まだペルソナがありません。6問のヒアリングから生成できます。
        </p>
        <Link className="button button-primary" href="/app/persona/intake">
          ヒアリングをはじめる
        </Link>
      </div>
    );
  }

  const snapshot = latest.snapshot;
  const evidenceById = new Map(
    snapshot.evidence.map((evidence) => [evidence.id, evidence] as const),
  );
  const answerIdToSummary = new Map(
    snapshot.evidence.map(
      (evidence) => [evidence.sourceId ?? "", evidence.summary] as const,
    ),
  );

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app">ホームへ戻る</Link>
      </p>
      <h1>ペルソナ</h1>
      <p className="page-lead">
        バージョン{latest.version}（{formatDateTime(latest.createdAt)}生成）
        {latest.model !== undefined && ` / model: ${latest.model}`}
        {latest.promptVersion !== undefined &&
          ` / prompt: ${latest.promptVersion}`}
      </p>
      <p className="hint-text">
        すべての項目はヒアリングの回答のみを根拠にしています。推測は含まれません。
      </p>

      <section aria-labelledby="persona-confidence" className="card">
        <h2 id="persona-confidence">確信度</h2>
        <p>{Math.round(snapshot.confidence * 100)}%</p>
      </section>

      <section aria-labelledby="persona-skills" className="card">
        <h2 id="persona-skills">スキル</h2>
        {snapshot.skills.length === 0 ? (
          <p className="hint-text">回答からは抽出されませんでした。</p>
        ) : (
          <ul>
            {snapshot.skills.map((skill) => (
              <li key={skill.name}>
                {skill.name}（{skillLevelLabels[skill.level] ?? skill.level}）
                <ul className="hint-text">
                  {skill.evidenceRefs.map((reference) => (
                    <li key={reference}>
                      根拠: {evidenceById.get(reference)?.summary ?? reference}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="persona-experiences" className="card">
        <h2 id="persona-experiences">経験</h2>
        {snapshot.experiences.length === 0 ? (
          <p className="hint-text">回答からは抽出されませんでした。</p>
        ) : (
          <ul>
            {snapshot.experiences.map((experience) => (
              <li key={experience.title}>
                <strong>{experience.title}</strong> — {experience.description}
                <ul className="hint-text">
                  {experience.evidenceRefs.map((reference) => (
                    <li key={reference}>
                      根拠: {evidenceById.get(reference)?.summary ?? reference}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="persona-strengths" className="card">
        <h2 id="persona-strengths">強み</h2>
        <ul>
          {snapshot.strengths.map((strength, index) => (
            <li key={`${strength}-${index}`}>{strength}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="persona-weaknesses" className="card">
        <h2 id="persona-weaknesses">弱み</h2>
        <ul>
          {snapshot.weaknesses.map((weakness, index) => (
            <li key={`${weakness}-${index}`}>{weakness}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="persona-values" className="card">
        <h2 id="persona-values">価値観</h2>
        <ul>
          {snapshot.values.map((value, index) => (
            <li key={`${value}-${index}`}>{value}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="persona-preferences" className="card">
        <h2 id="persona-preferences">志向</h2>
        <p>
          職種: {snapshot.preferences.roles.join("、") || "—"} / 業界:{" "}
          {snapshot.preferences.industries.join("、") || "—"} / 働き方:{" "}
          {snapshot.preferences.workStyles.join("、") || "—"} / 勤務地:{" "}
          {snapshot.preferences.locations.join("、") || "—"}
        </p>
      </section>

      <section aria-labelledby="persona-evidence" className="card">
        <h2 id="persona-evidence">根拠となった回答（抜粋）</h2>
        <ul className="hint-text">
          {[...answerIdToSummary.entries()].map(([answerId, summary]) => (
            <li key={answerId}>{summary}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="persona-versions" className="card">
        <h2 id="persona-versions">バージョン履歴</h2>
        <ul>
          {versions.map((version) => (
            <li key={version.personaVersionId}>
              v{version.version}（{formatDateTime(version.createdAt)}）
            </li>
          ))}
        </ul>
        <Link className="button button-secondary" href="/app/persona/intake">
          新しいヒアリングで更新する
        </Link>
      </section>
    </div>
  );
}
