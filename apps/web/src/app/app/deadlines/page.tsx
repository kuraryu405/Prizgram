import Link from "next/link";

import {
  DeadlineCreateForm,
  DeadlineToggle,
} from "@/components/deadlines/deadline-components";
import { deadlineKindLabels as kindLabels } from "@/lib/labels";
import { getDatabase } from "@/server/database";
import { ApplicationService } from "@/server/applications/service";
import { DeadlineService, type DeadlineView } from "@/server/deadlines/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatInZone(view: DeadlineView): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: view.timeZone,
  }).format(new Date(view.dueAt));
}

export default async function DeadlinesPage() {
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

  return (
    <div className="page">
      <h1>締切</h1>
      <p className="summary-line">
        未完了 {attention.length + upcoming.length}件 / 期限超過{" "}
        {attention.length}件
      </p>

      <DeadlineCreateForm
        applications={applications.map((application) => ({
          id: application.applicationId,
          label: `${application.company} — ${application.role}`,
        }))}
      />

      {attention.length > 0 && (
        <section aria-labelledby="deadline-overdue" className="card">
          <h2 id="deadline-overdue">期限超過（未完了）</h2>
          <ul>
            {attention.map((deadline) => (
              <li key={deadline.deadlineId}>
                <strong>{deadline.title}</strong>（
                {kindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                {formatInZone(deadline)} <DeadlineToggle {...deadline} />
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
              <li key={deadline.deadlineId}>
                <strong>{deadline.title}</strong>（
                {kindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                {formatInZone(deadline)}
                {deadline.within24Hours && (
                  <span className="form-alert"> 24時間以内</span>
                )}{" "}
                <Link
                  href={`/app/applications/${encodeURIComponent(deadline.applicationId)}`}
                >
                  応募を見る
                </Link>{" "}
                <DeadlineToggle {...deadline} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section aria-labelledby="deadline-completed" className="card">
          <h2 id="deadline-completed">完了済み</h2>
          <ul className="hint-text">
            {completed.map((deadline) => (
              <li key={deadline.deadlineId}>
                {deadline.title} — {formatInZone(deadline)}{" "}
                <DeadlineToggle {...deadline} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
