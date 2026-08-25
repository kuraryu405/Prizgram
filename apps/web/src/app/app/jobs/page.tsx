import Link from "next/link";

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

  return (
    <div className="page">
      <h1>求人</h1>
      <p className="page-lead">
        求人票を貼り付けて取り込むと、要件・難易度・文化が構造化されて保存され、3軸評価の対象になります。
      </p>

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
    </div>
  );
}
