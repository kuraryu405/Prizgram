import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabase } from "@/server/database";
import { JobService } from "@/server/jobs/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

const employmentTypeLabels: Readonly<Record<string, string>> = {
  contract: "契約社員",
  full_time: "正社員",
  internship: "インターン",
  part_time: "アルバイト",
};

const difficultyLabels: Readonly<Record<string, string>> = {
  competitive: "選考競争あり",
  developing: "育成前提",
  entry: "未経験歓迎",
  highly_competitive: "非常に高い難易度",
};

const sourceKindLabels: Readonly<Record<string, string>> = {
  licensed_source: "ライセンス済みデータ",
  official_api: "公式API",
  user_provided: "ユーザー提供の求人票",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function SignalList({
  signals,
}: Readonly<{ signals: ReadonlyArray<{ id: string; text: string }> }>) {
  if (signals.length === 0) return <p className="hint-text">なし</p>;
  return (
    <ul>
      {signals.map((signal) => (
        <li key={signal.id}>
          <span className="signal-id">{signal.id}</span> {signal.text}
        </li>
      ))}
    </ul>
  );
}

export default async function JobDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const user = await requireSessionUserPage();
  const service = new JobService(getDatabase());
  const detail = (() => {
    try {
      return service.getJobDetail(user.id, id);
    } catch {
      notFound();
    }
  })();

  const snapshot = detail.latest.snapshot;
  const signalTextById = new Map(
    [
      ...snapshot.requirements,
      ...snapshot.desiredSkills,
      ...snapshot.cultureValues,
    ].map((signal) => [signal.id, signal.text] as const),
  );

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app/jobs">求人一覧へ戻る</Link>
      </p>
      <h1>{snapshot.company}</h1>
      <p className="page-lead">
        {snapshot.role} /{" "}
        {employmentTypeLabels[snapshot.employmentType] ??
          snapshot.employmentType}
      </p>

      <section aria-labelledby="job-description" className="card">
        <h2 id="job-description">本文</h2>
        <p className="prewrap">{snapshot.description}</p>
      </section>

      <section aria-labelledby="job-requirements" className="card">
        <h2 id="job-requirements">要件</h2>
        <SignalList signals={snapshot.requirements} />
      </section>

      <section aria-labelledby="job-desired-skills" className="card">
        <h2 id="job-desired-skills">歓迎スキル</h2>
        <SignalList signals={snapshot.desiredSkills} />
      </section>

      <section aria-labelledby="job-culture-values" className="card">
        <h2 id="job-culture-values">文化・価値観</h2>
        <SignalList signals={snapshot.cultureValues} />
      </section>

      <section aria-labelledby="job-difficulty" className="card">
        <h2 id="job-difficulty">難易度</h2>
        <p>
          {difficultyLabels[snapshot.difficulty.level] ??
            snapshot.difficulty.level}
        </p>
        <p className="hint-text">根拠となった要素:</p>
        <ul>
          {snapshot.difficulty.evidenceRefs.map((reference) => (
            <li key={reference}>
              <span className="signal-id">{reference}</span>{" "}
              {signalTextById.get(reference) ?? reference}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="job-source" className="card">
        <h2 id="job-source">出典</h2>
        <p>
          {sourceKindLabels[snapshot.source.kind] ?? snapshot.source.kind} /{" "}
          {snapshot.source.name} / 取り込み日時:{" "}
          {formatDateTime(snapshot.source.retrievedAt)}
        </p>
        {snapshot.source.url !== undefined && (
          <p>
            {/* User-supplied URLs are external references, never trusted for
                navigation injection beyond a plain http(s) anchor. */}
            <a
              href={
                snapshot.source.url.startsWith("https://") ||
                snapshot.source.url.startsWith("http://")
                  ? snapshot.source.url
                  : undefined
              }
              rel="noreferrer noopener"
              target="_blank"
            >
              {snapshot.source.url}
            </a>
          </p>
        )}
      </section>

      <section aria-labelledby="job-versions" className="card">
        <h2 id="job-versions">バージョン履歴</h2>
        <ul>
          {detail.versions.map((version) => (
            <li key={version.jobVersionId}>
              v{version.version}（{formatDateTime(version.createdAt)}）
              {version.model !== undefined && ` / model: ${version.model}`}
              {version.promptVersion !== undefined &&
                ` / prompt: ${version.promptVersion}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
