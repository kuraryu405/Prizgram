import Link from "next/link";

import { JobDiscovery } from "@/components/jobs/job-discovery";
import { JobImportForm } from "@/components/jobs/job-import-form";
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

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

export default async function JobsPage() {
  const user = await requireSessionUserPage();
  const jobs = new JobService(getDatabase()).listJobs(user.id);
  const archivedJobs = new JobService(getDatabase()).listJobs(user.id, {
    archived: true,
  });
  const importedExternalIds = [...jobs, ...archivedJobs].flatMap((job) =>
    job.sourceExternalId === undefined ? [] : [job.sourceExternalId],
  );

  return (
    <div className="page page-jobs">
      <header className="page-heading">
        <p className="eyebrow">JOB DISCOVERY</p>
        <h1>求人を探す</h1>
        <p className="page-lead">
          ペルソナから求人候補を探索するか、求人票を貼り付けて取り込めます。取り込んだ求人は要件・難易度・文化が構造化されて保存され、3軸評価の対象になります。
        </p>
      </header>

      <JobDiscovery importedExternalIds={importedExternalIds} />

      <div className="jobs-secondary-grid">
        <JobImportForm />

        <section aria-labelledby="jobs-list" className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SAVED JOBS</p>
              <h2 id="jobs-list">取り込み済みの求人</h2>
            </div>
            <span className="count-badge">{jobs.length}件</span>
          </div>
          {jobs.length === 0 ? (
            <p className="hint-text">
              まだ求人がありません。上の検索結果または求人票の貼り付けから取り込めます。
            </p>
          ) : (
            <ul className="saved-job-list">
              {jobs.map((job) => (
                <li className="saved-job-item" key={job.jobId}>
                  <Link href={`/app/jobs/${job.jobId}`}>
                    <strong>{job.role}</strong>
                    <span>{job.company}</span>
                  </Link>
                  <p className="hint-text">
                    {employmentTypeLabels[job.employmentType] ??
                      job.employmentType}
                    {" · "}
                    {formatDateTime(job.importedAt)}に取り込み
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="archived-jobs-list" className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ARCHIVE</p>
              <h2 id="archived-jobs-list">アーカイブ済み</h2>
            </div>
            <span className="count-badge">{archivedJobs.length}件</span>
          </div>
          {archivedJobs.length === 0 ? (
            <p className="hint-text">アーカイブ済みの求人はありません。</p>
          ) : (
            <ul className="saved-job-list">
              {archivedJobs.map((job) => (
                <li className="saved-job-item" key={job.jobId}>
                  <Link href={`/app/jobs/${job.jobId}`}>
                    <strong>{job.role}</strong>
                    <span>{job.company}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
