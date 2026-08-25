import Link from "next/link";
import { cookies } from "next/headers";

import { ReminderService } from "@prizgram/db";

import { ApplicationService } from "@/server/applications/service";
import { AuthService, sessionCookieName } from "@/server/auth";
import { buildNextActions } from "@/server/dashboard/actions";
import { getDatabase } from "@/server/database";
import { DeadlineService } from "@/server/deadlines/service";
import { JobService } from "@/server/jobs/service";
import { PersonaService } from "@/server/persona/service";
import { ScoringService } from "@/server/scoring/service";
import type { ScoreDetail } from "@/server/scoring/service";

const statusLabels: Readonly<Record<string, string>> = {
  saved: "保存済み",
  applying: "応募書類準備中",
  submitted: "応募済み",
  screening: "書類選考中",
  interview: "面接",
  offer: "内定",
  accepted: "承諾",
  rejected: "辞退/不採用",
};

const deadlineKindLabels: Readonly<Record<string, string>> = {
  es: "ES締切",
  interview: "面接",
  offer_deadline: "内定承諾期限",
  other: "その他",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export default async function AppHome() {
  const token = (await cookies()).get(sessionCookieName())?.value;
  const user = new AuthService(getDatabase()).requireUser(token);

  const db = getDatabase();
  const persona = new PersonaService(db).latestPersona(user.id);
  const jobList = new JobService(db).listJobs(user.id);
  const applications = new ApplicationService(db).listApplications(user.id);
  const deadlines = new DeadlineService(db).list(user.id);
  const reminderService = new ReminderService(db.db);
  const reminders = reminderService.listActive(user.id);
  const scoring = new ScoringService(db);

  const scoreByJob = new Map<string, ScoreDetail>();
  for (const job of jobList) {
    const latest = scoring.getLatestScore(user.id, job.jobId);
    if (latest !== undefined) scoreByJob.set(job.jobId, latest);
  }

  const openDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const overdue = openDeadlines.filter((d) => d.overdue);
  const upcoming = openDeadlines
    .filter((d) => !d.overdue)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, 5);
  const topReminders = reminders.slice(0, 5);

  // Next actions are ordered by urgency so the first item is always the
  // single most useful thing the user can do right now.
  const actions = buildNextActions({
    hasPersona: persona !== undefined,
    jobs: jobList,
    scoredJobIds: new Set(scoreByJob.keys()),
    applicationCount: applications.length,
    urgentReminderCount: reminders.filter((r) => r.priority === "urgent")
      .length,
    overdueDeadlines: overdue.map((d) => ({
      title: d.title,
      dueAt: d.dueAt,
    })),
  });

  const statusCounts = new Map<string, number>();
  for (const application of applications) {
    statusCounts.set(
      application.status,
      (statusCounts.get(application.status) ?? 0) + 1,
    );
  }
  const activeStatuses = [...statusCounts.entries()].filter(
    ([status]) => status !== "accepted" && status !== "rejected",
  );

  return (
    <div className="page">
      <h1>ようこそ、{user.loginId} さん</h1>
      <p className="page-lead">
        現在の就活状況と、次に取るべきアクションをここで確認できます。
      </p>

      <section aria-labelledby="next-actions" className="card">
        <h2 id="next-actions">次のアクション</h2>
        {actions.length === 0 ? (
          <p className="hint-text">
            いま取り組むべき項目はありません。新しい求人の取り込みや評価から進めてみましょう。
          </p>
        ) : (
          <ol className="action-list">
            {actions.map((action) => (
              <li key={action.label} className={action.tone}>
                <Link href={action.href}>
                  <span className="action-label">{action.label}</span>
                  <span className="hint-text">{action.detail}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="dashboard-reminders" className="card">
        <h2 id="dashboard-reminders">リマインダー</h2>
        {topReminders.length === 0 ? (
          <p className="hint-text">
            未読のリマインダーはありません。締切を登録すると、近づいた時点でお知らせします。
          </p>
        ) : (
          <>
            <ul>
              {topReminders.map((reminder) => (
                <li key={reminder.id}>
                  <span className="signal-id">{reminder.priority}</span>{" "}
                  {reminder.message}
                </li>
              ))}
            </ul>
            <p>
              <Link href="/app/reminders">すべてのリマインダーを見る</Link>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="dashboard-deadlines" className="card">
        <h2 id="dashboard-deadlines">直近の締切</h2>
        {upcoming.length === 0 ? (
          <p className="hint-text">
            登録された締切はありません。応募詳細から ES
            締切や面接日程を追加できます。
          </p>
        ) : (
          <ul>
            {upcoming.map((deadline) => (
              <li key={deadline.deadlineId}>
                {deadline.within24Hours && (
                  <strong className="form-alert">24時間以内: </strong>
                )}
                {deadline.title}（
                {deadlineKindLabels[deadline.kind] ?? deadline.kind}）—{" "}
                {formatDateTime(deadline.dueAt)}
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link href="/app/deadlines">締切一覧へ</Link>
        </p>
      </section>

      <section aria-labelledby="dashboard-applications" className="card">
        <h2 id="dashboard-applications">応募の状況</h2>
        {applications.length === 0 ? (
          <p className="hint-text">
            まだ応募がありません。取り込んだ求人から応募を登録すると、選考履歴を追跡できます。
          </p>
        ) : (
          <>
            <ul>
              {activeStatuses.map(([status, count]) => (
                <li key={status}>
                  {statusLabels[status] ?? status}: {count} 件
                </li>
              ))}
            </ul>
            <p>
              <Link href="/app/applications">応募一覧へ</Link>
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="dashboard-jobs" className="card">
        <h2 id="dashboard-jobs">取り込んだ求人と評価</h2>
        {jobList.length === 0 ? (
          <p className="hint-text">
            求人がまだありません。<Link href="/app/jobs">求人取り込み</Link>{" "}
            から始めてください。
          </p>
        ) : (
          <ul>
            {jobList.slice(0, 5).map((job) => {
              const score = scoreByJob.get(job.jobId);
              return (
                <li key={job.jobId}>
                  <Link href={`/app/jobs/${job.jobId}`}>
                    {job.company} / {job.role}
                  </Link>
                  {" — "}
                  {score === undefined ? (
                    <span className="hint-text">未評価</span>
                  ) : (
                    <span>
                      skill {score.axes.skillFit.score} / culture{" "}
                      {score.axes.cultureValueFit.score} / gap{" "}
                      {score.axes.difficultyGap.score}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {jobList.length > 5 && (
          <p>
            <Link href="/app/jobs">求人一覧へ</Link>
          </p>
        )}
      </section>

      <section aria-labelledby="dashboard-persona" className="card">
        <h2 id="dashboard-persona">ペルソナ</h2>
        {persona === undefined ? (
          <p className="hint-text">
            まだペルソナがありません。
            <Link href="/app/persona/intake">ヒアリングを開始</Link>
            してください。
          </p>
        ) : (
          <p>
            最新バージョン v{persona.version}（
            {formatDateTime(persona.createdAt)}）—{" "}
            <Link href="/app/persona">詳細を見る</Link>
          </p>
        )}
      </section>
    </div>
  );
}
