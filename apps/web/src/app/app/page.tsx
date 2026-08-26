import Link from "next/link";
import { cookies } from "next/headers";

import { ReminderService } from "@prizgram/db";
import { applicationStatuses } from "@prizgram/shared";

import {
  applicationStatusLabels,
  deadlineKindLabels,
  reminderPriorityLabels,
} from "@/lib/labels";
import { ApplicationService } from "@/server/applications/service";
import { AuthService, sessionCookieName } from "@/server/auth";
import { buildNextActions } from "@/server/dashboard/actions";
import { getDatabase } from "@/server/database";
import { DeadlineService } from "@/server/deadlines/service";
import type { DeadlineView } from "@/server/deadlines/service";
import { JobService } from "@/server/jobs/service";
import { PersonaService } from "@/server/persona/service";
import { ScoringService } from "@/server/scoring/service";
import type { ScoreDetail } from "@/server/scoring/service";

/** Statuses whose selection process is finished and no longer active. */
const closedApplicationStatuses: ReadonlySet<string> = new Set([
  "accepted",
  "rejected",
  "withdrawn",
]);

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function byDueAt(a: DeadlineView, b: DeadlineView): number {
  return a.dueAt.localeCompare(b.dueAt);
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

  // Deadlines shown on the dashboard: overdue first (they need attention),
  // then the nearest upcoming ones, capped so the list stays scannable.
  const openDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const overdue = openDeadlines.filter((d) => d.overdue).sort(byDueAt);
  const upcoming = openDeadlines.filter((d) => !d.overdue).sort(byDueAt);
  const recentDeadlines = [...overdue, ...upcoming].slice(0, 5);
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

  // Application summary: counts per status in the canonical status order,
  // plus an overall "how many are still moving" figure.
  const statusCounts = new Map<string, number>();
  for (const application of applications) {
    statusCounts.set(
      application.status,
      (statusCounts.get(application.status) ?? 0) + 1,
    );
  }
  const statusEntries = applicationStatuses
    .map((status) => [status, statusCounts.get(status) ?? 0] as const)
    .filter(([, count]) => count > 0);
  const activeApplicationCount = applications.filter(
    (application) => !closedApplicationStatuses.has(application.status),
  ).length;

  return (
    <div className="page">
      <h1>ようこそ、{user.loginId} さん</h1>
      <p className="page-lead">
        現在の就活状況と、次に取るべきアクションをここで確認できます。
      </p>

      <div className="dashboard-grid">
        <div className="dashboard-area dashboard-area--focus">
          <section aria-labelledby="next-actions" className="card card-focus">
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

          <section aria-labelledby="dashboard-deadlines" className="card">
            <h2 id="dashboard-deadlines">締切とリマインダー</h2>
            {recentDeadlines.length === 0 && topReminders.length === 0 ? (
              <p className="hint-text">
                対応が必要な締切・リマインダーはありません。応募や求人詳細から締切を登録すると、日が近づいた時点でここにお知らせします。
              </p>
            ) : (
              <>
                {recentDeadlines.length > 0 && (
                  <div className="dashboard-subsection">
                    <h3>直近の締切</h3>
                    <ul>
                      {recentDeadlines.map((deadline) => (
                        <li key={deadline.deadlineId}>
                          {deadline.overdue && (
                            <span className="priority-badge priority-urgent">
                              期限超過
                            </span>
                          )}
                          {!deadline.overdue && deadline.within24Hours && (
                            <span className="priority-badge priority-high">
                              24時間以内
                            </span>
                          )}{" "}
                          {deadline.title}（
                          {deadlineKindLabels[deadline.kind] ?? deadline.kind}
                          ）— {formatDateTime(deadline.dueAt)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {topReminders.length > 0 && (
                  <div className="dashboard-subsection">
                    <h3>アクティブなリマインダー</h3>
                    <ul>
                      {topReminders.map((reminder) => (
                        <li key={reminder.id}>
                          <span
                            className={`priority-badge priority-${reminder.priority}`}
                          >
                            優先度:{" "}
                            {reminderPriorityLabels[reminder.priority] ??
                              reminder.priority}
                          </span>{" "}
                          {reminder.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="dashboard-links">
                  <Link href="/app/deadlines">締切一覧へ</Link>
                  <Link href="/app/reminders">リマインダー一覧へ</Link>
                </p>
              </>
            )}
          </section>
        </div>

        <div className="dashboard-area dashboard-area--progress">
          <section aria-labelledby="dashboard-applications" className="card">
            <h2 id="dashboard-applications">応募の状況</h2>
            {applications.length === 0 ? (
              <p className="hint-text">
                まだ応募がありません。取り込んだ求人から応募を登録すると、選考履歴を追跡できます。
              </p>
            ) : (
              <>
                <p className="summary-line">
                  応募 {applications.length} 件（選考中 {activeApplicationCount}{" "}
                  件）
                </p>
                <ul>
                  {statusEntries.map(([status, count]) => (
                    <li key={status}>
                      {applicationStatusLabels[status] ?? status}: {count} 件
                    </li>
                  ))}
                </ul>
                <p className="dashboard-links">
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
              <>
                <p className="summary-line">
                  求人 {jobList.length} 件（評価済み {scoreByJob.size} 件）
                </p>
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
                {jobList.length > 5 && (
                  <p className="dashboard-links">
                    <Link href="/app/jobs">求人一覧へ</Link>
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <div className="dashboard-area dashboard-area--profile">
          <section aria-labelledby="dashboard-persona" className="card">
            <h2 id="dashboard-persona">ペルソナ</h2>
            {persona === undefined ? (
              <>
                <p className="hint-text">
                  まだペルソナがありません。
                  ヒアリングに答えると、スキル・経験・価値観が構造化され、求人評価の基準になります。
                </p>
                <p className="dashboard-links">
                  <Link href="/app/persona/intake">ヒアリングを開始</Link>
                </p>
              </>
            ) : (
              <>
                <p className="summary-line">
                  最終更新: {formatDateTime(persona.createdAt)}
                  <span className="hint-text">（v{persona.version}）</span>
                </p>
                <p className="hint-text">
                  スキル {persona.snapshot.skills.length}
                  件・強み {persona.snapshot.strengths.length}
                  件・価値観 {persona.snapshot.values.length} 件を整理済み
                </p>
                <p className="dashboard-links">
                  <Link href="/app/persona">詳細を見る</Link>
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
