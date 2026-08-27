import Link from "next/link";
import { cookies } from "next/headers";

import { ReminderService } from "@prizgram/db";

import { applicationStatusLabels, deadlineKindLabels } from "@/lib/labels";
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

  // Deadlines drive "今日やること". Reminders are derived, so dashboard
  // shows deadlines only (no duplicate reminder list).
  const openDeadlines = deadlines.filter((deadline) => !deadline.completed);
  const overdue = openDeadlines.filter((d) => d.overdue).sort(byDueAt);
  const upcoming = openDeadlines.filter((d) => !d.overdue).sort(byDueAt);
  const nextDeadlines = [...overdue, ...upcoming].slice(0, 3);

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

  const activeApplicationCount = applications.filter(
    (application) => !closedApplicationStatuses.has(application.status),
  ).length;
  const upcomingWithin7Days = upcoming.filter((d) => d.within7Days).length;

  // Brand-new users get a single CTA, not a wall of empty cards.
  const onboardingNeeded =
    persona === undefined &&
    jobList.length === 0 &&
    applications.length === 0 &&
    deadlines.length === 0;

  return (
    <div className="page page-dashboard">
      <h1>ようこそ、{user.loginId} さん</h1>

      <div className="dashboard-grid">
        <div className="dashboard-area dashboard-area--focus">
          {onboardingNeeded ? (
            <section
              aria-labelledby="getting-started"
              className="card card-focus"
            >
              <h2 id="getting-started">はじめましょう</h2>
              <p className="hint-text">
                求人を追加すると、応募から選考までを一か所で進められます。
              </p>
              <div className="card-footer">
                <Link className="button button-primary" href="/app/jobs">
                  求人を探す
                </Link>
              </div>
            </section>
          ) : (
            <section aria-labelledby="next-actions" className="card card-focus">
              <h2 id="next-actions">今日やること</h2>
              {actions.length === 0 ? (
                <p className="hint-text">
                  今すぐ対応が必要な項目はありません。気になる求人を追加してみましょう。
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

          {nextDeadlines.length > 0 && (
            <section aria-labelledby="dashboard-deadlines" className="card">
              <h2 id="dashboard-deadlines">直近の締切</h2>
              <ul>
                {nextDeadlines.map((deadline) => (
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
                    {deadlineKindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                    <time dateTime={deadline.dueAt}>
                      {formatDeadline(deadline)}
                    </time>
                  </li>
                ))}
              </ul>
              <div className="card-footer">
                <Link className="button button-secondary" href="/app/deadlines">
                  締切一覧へ
                </Link>
              </div>
            </section>
          )}
        </div>

        <div className="dashboard-area dashboard-area--progress">
          <section aria-labelledby="dashboard-metrics" className="card">
            <h2 id="dashboard-metrics">状況</h2>
            <ul className="dashboard-metrics">
              <li>
                <span className="dashboard-metric-value">
                  {activeApplicationCount}
                </span>
                <span className="dashboard-metric-label">選考中</span>
              </li>
              <li>
                <span className="dashboard-metric-value">
                  {upcomingWithin7Days}
                </span>
                <span className="dashboard-metric-label">7日以内の締切</span>
              </li>
              <li>
                <span className="dashboard-metric-value">{jobList.length}</span>
                <span className="dashboard-metric-label">保存求人</span>
              </li>
            </ul>
            <div className="card-footer">
              <Link
                className="button button-secondary"
                href="/app/applications"
              >
                応募を見る
              </Link>
              <Link className="button button-secondary" href="/app/jobs">
                求人を見る
              </Link>
            </div>
          </section>

          {applications.length > 0 && (
            <section aria-labelledby="dashboard-apps-compact" className="card">
              <h2 id="dashboard-apps-compact">応募</h2>
              <ul>
                {applications.slice(0, 3).map((application) => (
                  <li key={application.applicationId}>
                    <Link
                      href={`/app/applications/${encodeURIComponent(application.applicationId)}`}
                    >
                      {application.company} — {application.role}
                    </Link>{" "}
                    <span className="hint-text">
                      /{" "}
                      {applicationStatusLabels[application.status] ??
                        application.status}
                    </span>
                  </li>
                ))}
              </ul>
              {applications.length > 3 && (
                <div className="card-footer">
                  <Link
                    className="button button-secondary"
                    href="/app/applications"
                  >
                    すべて見る（{applications.length}件）
                  </Link>
                </div>
              )}
            </section>
          )}

          {jobList.length > 0 && (
            <section aria-labelledby="dashboard-jobs-compact" className="card">
              <h2 id="dashboard-jobs-compact">求人</h2>
              <ul>
                {jobList.slice(0, 3).map((job) => {
                  const score = scoreByJob.get(job.jobId);
                  return (
                    <li key={job.jobId}>
                      <Link href={`/app/jobs/${job.jobId}`}>
                        {job.company} / {job.role}
                      </Link>{" "}
                      {score === undefined ? (
                        <span className="hint-text">未評価</span>
                      ) : (
                        <span className="hint-text">
                          {score.axes.skillFit.score} /{" "}
                          {score.axes.cultureValueFit.score} /{" "}
                          {score.axes.difficultyGap.score}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="dashboard-area dashboard-area--profile">
          <section aria-labelledby="dashboard-persona" className="card">
            <h2 id="dashboard-persona">ペルソナ</h2>
            {persona === undefined ? (
              <p className="hint-text">
                未作成です。作成すると求人評価の基準になります。
              </p>
            ) : (
              <>
                <p className="hint-text">
                  v{persona.version} / スキル {persona.snapshot.skills.length}
                  ・強み {persona.snapshot.strengths.length}・価値観{" "}
                  {persona.snapshot.values.length}
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
