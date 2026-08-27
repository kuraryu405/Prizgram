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

  return (
    <div className="page page-jobs">
      <h1>求人</h1>

      <JobDiscovery />
      <JobImportForm />

      <section aria-labelledby="jobs-list" className="card">
        <h2 id="jobs-list">取り込み済みの求人</h2>
        {jobs.length === 0 ? (
          <p className="hint-text">
            まだ求人がありません。上のフォームから求人票を取り込んでください。
          </p>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => (
              <li key={job.jobId}>
                <Link href={`/app/jobs/${job.jobId}`}>
                  {job.company} / {job.role}
                </Link>{" "}
                —{" "}
                {employmentTypeLabels[job.employmentType] ?? job.employmentType}
                （{formatDateTime(job.importedAt)}に取り込み）
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="archived-jobs-list" className="card">
        <h2 id="archived-jobs-list">アーカイブ済み</h2>
        {archivedJobs.length === 0 ? (
          <p className="hint-text">アーカイブ済みの求人はありません。</p>
        ) : (
          <ul className="job-list">
            {archivedJobs.map((job) => (
              <li key={job.jobId}>
                <Link href={`/app/jobs/${job.jobId}`}>
                  {job.company} / {job.role}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
