import Link from "next/link";

import { ApplicationAddForm } from "@/components/applications/application-add-form";
import { applicationStatusLabels } from "@/lib/labels";
import { getDatabase } from "@/server/database";
import { ApplicationService } from "@/server/applications/service";
import { JobService } from "@/server/jobs/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

const filterStatuses = [
  "saved",
  "applying",
  "submitted",
  "screening",
  "interview",
  "offer",
] as const;

export default async function ApplicationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ status?: string }> }>) {
  const { status } = await searchParams;
  const user = await requireSessionUserPage();
  const service = new ApplicationService(getDatabase());
  const applications =
    status !== undefined &&
    Object.prototype.hasOwnProperty.call(applicationStatusLabels, status)
      ? service.listApplications(user.id, { status: status as never })
      : service.listApplications(user.id);
  const jobs = new JobService(getDatabase()).listJobs(user.id);

  return (
    <div className="page">
      <h1>応募管理</h1>
      <p className="page-lead">
        応募ごとの選考ステータスと履歴を管理します。応募の自動送信は行いません。
      </p>

      <ApplicationAddForm
        jobs={jobs.map((job) => ({
          jobId: job.jobId,
          company: job.company,
          role: job.role,
        }))}
      />

      <nav aria-label="ステータス絞り込み" className="filter-nav">
        <Link
          data-active={status === undefined ? "true" : undefined}
          href="/app/applications"
        >
          すべて
        </Link>
        {filterStatuses.map((filter) => (
          <Link
            key={filter}
            data-active={status === filter ? "true" : undefined}
            href={`/app/applications?status=${filter}`}
          >
            {applicationStatusLabels[filter]}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="application-list-title" className="section">
        <h2 id="application-list-title">応募一覧</h2>
        {applications.length === 0 ? (
          <p>該当する応募がありません。</p>
        ) : (
          <ul className="card-grid">
            {applications.map((application) => (
              <li key={application.applicationId}>
                <Link
                  className="card card-link"
                  href={`/app/applications/${encodeURIComponent(application.applicationId)}`}
                >
                  <h3>{application.company}</h3>
                  <p>{application.role}</p>
                  <p className="hint-text">
                    {applicationStatusLabels[application.status] ??
                      application.status}
                    {application.stageLabel !== undefined &&
                      ` / 段階: ${application.stageLabel}`}
                    {application.nextAction !== undefined &&
                      ` / 次のアクション: ${application.nextAction}`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
