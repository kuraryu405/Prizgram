import Link from "next/link";
import { notFound } from "next/navigation";

import { ScoreEvaluateButton } from "@/components/scoring/score-panel";
import { decodeJsonColumn, personaSnapshotSchema } from "@prizgram/shared";

import { AppError } from "@/server/api";
import { getDatabase } from "@/server/database";
import { JobService } from "@/server/jobs/service";
import { PersonaService } from "@/server/persona/service";
import { ScoringService } from "@/server/scoring/service";
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
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
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

  // Scoring: freshness-aware current score + history for reload persistence
  const db = getDatabase();
  const scoring = new ScoringService(db);
  const freshness = scoring.describeFreshness(user.id, id);
  const currentScore = scoring.getCurrentScore(user.id, id);
  const history = scoring.listScores(user.id, id);
  const personaLatest = new PersonaService(db).latestPersona(user.id);
  // Build evidence map that includes both job signals and persona evidence
  // so cultureValueFit's persona-side refs resolve instead of empty.
  const evidenceTextById = new Map(signalTextById);
  if (personaLatest !== undefined) {
    for (const ev of personaLatest.snapshot.evidence) {
      evidenceTextById.set(ev.id, ev.summary);
    }
  }
  // If the current score pins an older persona version, also include its evidence
  if (
    currentScore !== undefined &&
    personaLatest?.personaVersionId !== currentScore.personaVersionId
  ) {
    try {
      const raw = db.sqlite
        .prepare("select snapshot from persona_versions where id = ?")
        .get(currentScore.personaVersionId) as { snapshot: string } | undefined;
      if (raw !== undefined) {
        const pinned = decodeJsonColumn(
          "persona_versions.snapshot",
          personaSnapshotSchema,
          raw.snapshot,
        );
        for (const ev of pinned.evidence) {
          if (!evidenceTextById.has(ev.id))
            evidenceTextById.set(ev.id, ev.summary);
        }
      }
    } catch {
      // Fallback to latest persona evidence already added
    }
  }

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

      <section aria-labelledby="job-scoring" className="card">
        <h2 id="job-scoring">3軸評価</h2>
        {currentScore !== undefined ? (
          <div className="score-current">
            <p className="hint-text">
              最新の評価を表示しています（
              {new Intl.DateTimeFormat("ja-JP", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(currentScore.createdAt))}
              ）
            </p>
            <ul className="axis-list">
              {(
                [
                  { key: "skillFit", label: "スキル適合" },
                  { key: "cultureValueFit", label: "文化・価値観フィット" },
                  { key: "difficultyGap", label: "難易度ギャップ" },
                ] as const
              ).map((def) => {
                const dim = currentScore.axes[def.key];
                return (
                  <li key={def.key} className="axis-item">
                    <h3>{def.label}</h3>
                    <p className="axis-score">
                      {dim.score}
                      <span className="hint-text"> / 100</span>
                    </p>
                    <ul>
                      {dim.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <p className="hint-text">根拠:</p>
                    <ul>
                      {dim.evidenceRefs.map((ref) => (
                        <li key={ref}>
                          <span className="signal-id">{ref}</span>{" "}
                          {evidenceTextById.get(ref) ?? ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            <p className="hint-text">
              v{detail.latest.version} / persona{" "}
              {currentScore.personaVersionId.slice(0, 8)} / {currentScore.model}
            </p>
          </div>
        ) : freshness.status === "stale" && freshness.detail !== undefined ? (
          <div className="score-stale">
            <p className="hint-text" role="status">
              評価が古くなっています。ペルソナまたは求人内容が更新されたため、再評価を推奨します。
            </p>
            <p className="hint-text">
              前回の評価（
              {new Intl.DateTimeFormat("ja-JP", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(freshness.detail.createdAt))}
              ）: skill {freshness.detail.axes.skillFit.score} / culture{" "}
              {freshness.detail.axes.cultureValueFit.score} / gap{" "}
              {freshness.detail.axes.difficultyGap.score}
            </p>
          </div>
        ) : (
          <p className="hint-text">
            まだ評価されていません。下のボタンから評価を実行してください。
          </p>
        )}
        {history.length > 0 && (
          <details className="score-history">
            <summary>評価履歴（{history.length}件）</summary>
            <ul>
              {history.map((entry) => (
                <li key={entry.scoreId} className="hint-text">
                  {new Intl.DateTimeFormat("ja-JP", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(entry.createdAt))}{" "}
                  — skill {entry.axes.skillFit.score} / culture{" "}
                  {entry.axes.cultureValueFit.score} / gap{" "}
                  {entry.axes.difficultyGap.score}（p
                  {entry.personaVersionId.slice(0, 6)} / j
                  {entry.jobVersionId.slice(0, 6)}）
                  {freshness.status === "stale" &&
                    entry.scoreId === freshness.detail?.scoreId &&
                    " — 古いバージョン"}
                </li>
              ))}
            </ul>
          </details>
        )}
        <ScoreEvaluateButton
          jobId={detail.jobId}
          evidenceTextById={Object.fromEntries(evidenceTextById)}
        />
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
