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

/** Statuses whose selection process is finished and no longer active. */
const closedApplicationStatuses: ReadonlySet<string> = new Set([
  "accepted",
  "rejected",
  "withdrawn",
]);

function formatDateTime(iso: string, timeZone?: string): string {
  const zone = timeZone ?? "Asia/Tokyo";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date(iso));
  }
}

function formatDeadline(view: DeadlineView): string {
  return formatDateTime(view.dueAt, view.timeZone);
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

  // Batch, freshness-aware fetch avoids N*2 queries and hides stale scores
  // (persona/job version mismatch) from "evaluated" counts until re-evaluated.
  const scoreByJob = scoring.getCurrentScores(
    user.id,
    jobList.map((job) => job.jobId),
  );

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

  // Brand-new users (nothing registered at all) get a single onboarding
  // flow instead of a dashboard of unrelated empty cards.
  const onboardingNeeded =
    persona === undefined &&
    jobList.length === 0 &&
    applications.length === 0 &&
    deadlines.length === 0;
  // Empty states skip their own CTA when the next-actions list already
  // links to the same place, so the same guidance is not shown twice.
  const actionHrefs = new Set(actions.map((action) => action.href));

  return (
    <div className="page page-dashboard">
      <h1>ようこそ、{user.loginId} さん</h1>
      <p className="page-lead">
        現在の就活状況と、次に取るべきアクションをここで確認できます。
      </p>

      <div className="dashboard-grid">
        <div className="dashboard-area dashboard-area--focus">
          {onboardingNeeded ? (
            <section
              aria-labelledby="getting-started"
              className="card card-focus"
            >
              <h2 id="getting-started">はじめましょう</h2>
              <p className="hint-text">
                4つのステップで、就活の進行と締切をここで管理できるようになります。
              </p>
              <ol className="onboarding-steps">
                <li>
                  <span className="onboarding-step-head">
                    <span aria-hidden="true" className="onboarding-step-number">
                      1
                    </span>
                    <span className="onboarding-step-title">
                      ペルソナを作る
                    </span>
                  </span>
                  <p className="hint-text">
                    ヒアリングに答えると、スキル・経験・価値観が整理され、求人評価の基準になります。
                  </p>
                  <Link
                    className="button button-primary"
                    href="/app/persona/intake"
                  >
                    ペルソナ・ヒアリングを始める
                  </Link>
                </li>
                <li>
                  <span className="onboarding-step-head">
                    <span aria-hidden="true" className="onboarding-step-number">
                      2
                    </span>
                    <span className="onboarding-step-title">
                      求人を取り込む
                    </span>
                  </span>
                  <p className="hint-text">
                    気になる求人を貼り付けて保存すると、3軸で評価できます。
                  </p>
                </li>
                <li>
                  <span className="onboarding-step-head">
                    <span aria-hidden="true" className="onboarding-step-number">
                      3
                    </span>
                    <span className="onboarding-step-title">
                      応募を登録する
                    </span>
                  </span>
                  <p className="hint-text">
                    選考ステータスの変化を記録し、進捗として把握できます。
                  </p>
                </li>
                <li>
                  <span className="onboarding-step-head">
                    <span aria-hidden="true" className="onboarding-step-number">
                      4
                    </span>
                    <span className="onboarding-step-title">
                      締切を登録する
                    </span>
                  </span>
                  <p className="hint-text">
                    日が近づくとリマインダーがこの画面に表示されます。
                  </p>
                </li>
              </ol>
            </section>
          ) : (
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
          )}

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
                          ）—{" "}
                          <time dateTime={deadline.dueAt}>
                            {formatDeadline(deadline)}
                          </time>{" "}
                          <span className="hint-text">
                            ({deadline.timeZone})
                          </span>
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
              </>
            )}
            <div className="card-footer">
              <Link className="button button-secondary" href="/app/deadlines">
                締切一覧へ
              </Link>
              <Link className="button button-secondary" href="/app/reminders">
                リマインダー一覧へ
              </Link>
            </div>
          </section>
        </div>

        <div className="dashboard-area dashboard-area--progress">
          <section aria-labelledby="dashboard-applications" className="card">
            <h2 id="dashboard-applications">応募の状況</h2>
            {applications.length === 0 ? (
              <>
                <p className="hint-text">
                  まだ応募がありません。取り込んだ求人から応募を登録すると、このカードに選考の進捗が表示されます。
                </p>
                {actionHrefs.has("/app/applications") ? null : (
                  <div className="card-footer">
                    <Link
                      className="button button-secondary"
                      href="/app/applications"
                    >
                      応募を登録する
                    </Link>
                  </div>
                )}
              </>
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
                <div className="card-footer">
                  <Link
                    className="button button-secondary"
                    href="/app/applications"
                  >
                    応募一覧へ
                  </Link>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="dashboard-jobs" className="card">
            <h2 id="dashboard-jobs">取り込んだ求人と評価</h2>
            {jobList.length === 0 ? (
              <>
                <p className="hint-text">
                  求人がまだありません。求人票を貼り付けて取り込むと、このカードに一覧と評価が表示されます。
                </p>
                {actionHrefs.has("/app/jobs") ? null : (
                  <div className="card-footer">
                    <Link className="button button-secondary" href="/app/jobs">
                      求人取り込みへ
                    </Link>
                  </div>
                )}
              </>
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
                  <div className="card-footer">
                    <Link className="button button-secondary" href="/app/jobs">
                      求人一覧へ
                    </Link>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        <div className="dashboard-area dashboard-area--profile">
          <section aria-labelledby="dashboard-persona" className="card">
            <h2 id="dashboard-persona">ペルソナ</h2>
            {persona === undefined ? (
              <p className="hint-text">
                まだペルソナがありません。
                ヒアリングに答えると、スキル・経験・価値観が構造化され、求人評価の基準になります。
              </p>
            ) : (
              <>
                <p className="summary-line">
                  最終更新:{" "}
                  <time dateTime={persona.createdAt}>
                    {formatDateTime(persona.createdAt)}
                  </time>
                  <span className="hint-text">（v{persona.version}）</span>
                </p>
                <p className="hint-text">
                  スキル {persona.snapshot.skills.length}
                  件・強み {persona.snapshot.strengths.length}
                  件・価値観 {persona.snapshot.values.length} 件を整理済み
                </p>
                <div className="card-footer">
                  <Link className="button button-secondary" href="/app/persona">
                    詳細を見る
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
