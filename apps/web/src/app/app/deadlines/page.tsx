import Link from "next/link";

import {
  DeadlineActions,
  DeadlineCreateForm,
  DeadlineToggle,
} from "@/components/deadlines/deadline-components";
import { deadlineKindLabels as kindLabels } from "@/lib/labels";
import { terminalApplicationStatuses } from "@prizgram/shared";

import { getDatabase } from "@/server/database";
import { ApplicationService } from "@/server/applications/service";
import { DeadlineService, type DeadlineView } from "@/server/deadlines/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

const terminalApplicationStatusSet = new Set<string>(
  terminalApplicationStatuses as readonly string[],
);

function formatInZone(view: DeadlineView): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: view.timeZone,
  }).format(new Date(view.dueAt));
}

export default async function DeadlinesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ applicationId?: string }> }>) {
  const { applicationId: requestedApplicationId } = await searchParams;
  const user = await requireSessionUserPage();
  const deadlines = new DeadlineService(getDatabase()).list(user.id);
  const applications = new ApplicationService(getDatabase()).listApplications(
    user.id,
  );

  const upcoming = deadlines.filter(
    (deadline) => !deadline.completed && !deadline.overdue,
  );
  const attention = deadlines.filter(
    (deadline) => !deadline.completed && deadline.overdue,
  );
  const completed = deadlines.filter((deadline) => deadline.completed);
  const applicationsAcceptingDeadlines = applications.filter(
    (application) => !terminalApplicationStatusSet.has(application.status),
  );
  const requestedApplication = applicationsAcceptingDeadlines.find(
    (application) => application.applicationId === requestedApplicationId,
  );
  const orderedApplications =
    requestedApplication === undefined
      ? applicationsAcceptingDeadlines
      : [
          requestedApplication,
          ...applicationsAcceptingDeadlines.filter(
            (application) =>
              application.applicationId !== requestedApplication.applicationId,
          ),
        ];

  return (
    <div className="page">
      <h1>締切</h1>
      <p className="page-lead">
        ES・面接・内定承諾などの期限をタイムゾーン込みで管理します。完了済みの締切はリマインダー対象外になります。
      </p>

      <DeadlineCreateForm
        applications={orderedApplications.map((application) => ({
          id: application.applicationId,
          label: `${application.company} — ${application.role}`,
        }))}
      />

      {attention.length > 0 && (
        <section aria-labelledby="deadline-overdue" className="card">
          <h2 id="deadline-overdue">期限超過（未完了）</h2>
          <ul>
            {attention.map((deadline) => (
              <li className="deadline-item" key={deadline.deadlineId}>
                <div className="deadline-item-content">
                  <strong>{deadline.title}</strong>（
                  {kindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                  {formatInZone(deadline)}
                </div>
                <div className="deadline-item-actions">
                  <DeadlineToggle {...deadline} />
                  <DeadlineActions {...deadline} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="deadline-upcoming" className="card">
        <h2 id="deadline-upcoming">今後の締切</h2>
        {upcoming.length === 0 ? (
          <p className="hint-text">予定されている締切はありません。</p>
        ) : (
          <ul>
            {upcoming.map((deadline) => (
              <li className="deadline-item" key={deadline.deadlineId}>
                <div className="deadline-item-content">
                  <strong>{deadline.title}</strong>（
                  {kindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                  {formatInZone(deadline)}
                  {deadline.within24Hours && (
                    <span className="form-alert deadline-soon">24時間以内</span>
                  )}{" "}
                  <Link
                    href={`/app/applications/${encodeURIComponent(deadline.applicationId)}`}
                  >
                    応募を見る
                  </Link>
                </div>
                <div className="deadline-item-actions">
                  <DeadlineToggle {...deadline} />
                  <DeadlineActions {...deadline} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section aria-labelledby="deadline-completed" className="card">
          <h2 id="deadline-completed">完了済み</h2>
          <ul>
            {completed.map((deadline) => (
              <li className="deadline-item" key={deadline.deadlineId}>
                <div className="deadline-item-content">
                  {deadline.title}（{kindLabels[deadline.kind] ?? deadline.kind}
                  ） — {formatInZone(deadline)}
                </div>
                <div className="deadline-item-actions">
                  <DeadlineToggle {...deadline} />
                  <DeadlineActions {...deadline} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
