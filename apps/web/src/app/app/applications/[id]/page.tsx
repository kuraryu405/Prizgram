import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplicationDocumentsSection } from "@/components/application-documents/documents-section";
import { ApplicationUpdateForm } from "@/components/applications/application-update-form";
import { InterviewSection } from "@/components/interview/interview-section";
import {
  applicationStatusLabels as statusLabels,
  deadlineKindLabels as kindLabels,
} from "@/lib/labels";
import { AppError } from "@/server/api";
import { getDatabase } from "@/server/database";
import {
  ApplicationService,
  type ApplicationDetail,
} from "@/server/applications/service";
import { DeadlineService, type DeadlineView } from "@/server/deadlines/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function formatDeadline(view: DeadlineView): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: view.timeZone,
  }).format(new Date(view.dueAt));
}

function historyEventLabel(event: ApplicationDetail["events"][number]): string {
  const toStatus = statusLabels[event.toStatus] ?? event.toStatus;
  const stage = event.stageLabel === undefined ? "" : ` / ${event.stageLabel}`;
  if (event.fromStatus === undefined) return `作成: ${toStatus}${stage}`;
  if (event.fromStatus === event.toStatus) {
    return `段階を更新: ${event.stageLabel ?? "未設定"}`;
  }
  const fromStatus = statusLabels[event.fromStatus] ?? event.fromStatus;
  return `${fromStatus} → ${toStatus}${stage}`;
}

export default async function ApplicationDetailPage({
  params,
}: Readonly<{ params: Promise<{ id: string }> }>) {
  const { id } = await params;
  const user = await requireSessionUserPage();
  const db = getDatabase();
  const detail = (() => {
    try {
      return new ApplicationService(db).getApplicationDetail(user.id, id);
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }
  })();
  const deadlines = new DeadlineService(db).listForApplication(user.id, id);
  const nextDeadline = deadlines.find(
    (deadline) => !deadline.completed && !deadline.overdue,
  );

  return (
    <div className="page application-workspace">
      <p className="breadcrumb">
        <Link href="/app/applications">応募管理へ戻る</Link> /{" "}
        <Link href={`/app/jobs/${detail.jobId}`}>求人を見る</Link>
      </p>

      <header className="workspace-header card">
        <h1>{detail.company}</h1>
        <p className="page-lead">
          {detail.role} / {statusLabels[detail.status] ?? detail.status}
          {detail.stageLabel !== undefined && ` / ${detail.stageLabel}`}
        </p>
        {detail.nextAction !== undefined ? (
          <p>
            次にやること: <strong>{detail.nextAction}</strong>
          </p>
        ) : (
          <p className="hint-text">次にやることを設定できます。</p>
        )}
        {nextDeadline !== undefined && (
          <p className="hint-text">
            次の締切: {nextDeadline.title} — {formatDeadline(nextDeadline)}
          </p>
        )}
      </header>

      <div className="workspace-grid">
        <section aria-labelledby="overview-title" className="card">
          <h2 id="overview-title">現在の状況</h2>
          <dl className="workspace-dl">
            <dt>ステータス</dt>
            <dd>{statusLabels[detail.status] ?? detail.status}</dd>
            <dt>現在の段階</dt>
            <dd>{detail.stageLabel ?? "未設定"}</dd>
            <dt>応募した求人</dt>
            <dd>
              {detail.appliedCompany ?? detail.company} —{" "}
              {detail.appliedRole ?? detail.role}
            </dd>
          </dl>
        </section>

        <ApplicationUpdateForm
          allowedNextStatuses={detail.allowedNextStatuses}
          applicationId={detail.applicationId}
          currentStatus={statusLabels[detail.status] ?? detail.status}
          initialStageLabel={detail.stageLabel}
          initialNextAction={detail.nextAction}
          initialNote={detail.note}
          statusLabels={statusLabels}
        />

        <section aria-labelledby="job-title" className="card">
          <h2 id="job-title">応募した求人</h2>
          <p>
            <strong>{detail.appliedCompany ?? detail.company}</strong>
            <br />
            {detail.appliedRole ?? detail.role}
          </p>
          <p className="hint-text">
            応募時の求人情報を保持しているため、求人が後から更新されてもこの応募の記録は変わりません。
          </p>
          <p>
            <Link href={`/app/jobs/${detail.jobId}`}>現在の求人詳細を見る</Link>
          </p>
        </section>

        <section aria-labelledby="deadlines-title" className="card">
          <h2 id="deadlines-title">締切</h2>
          {deadlines.length === 0 ? (
            <p className="hint-text">締切はまだ登録されていません。</p>
          ) : (
            <ul className="deadline-list">
              {deadlines.map((deadline) => (
                <li key={deadline.deadlineId}>
                  <strong>{deadline.title}</strong>（
                  {kindLabels[deadline.kind] ?? deadline.kind}） —{" "}
                  {formatDeadline(deadline)}
                  {deadline.completed
                    ? " — 完了"
                    : deadline.overdue
                      ? " — 期限超過"
                      : ""}
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link href={`/app/deadlines?applicationId=${detail.applicationId}`}>
              締切を管理する
            </Link>
          </p>
        </section>

        <section aria-labelledby="documents-title" className="card">
          <h2 id="documents-title">応募書類 / ES</h2>
          <ApplicationDocumentsSection applicationId={detail.applicationId} />
        </section>

        <section aria-labelledby="interview-title" className="card">
          <h2 id="interview-title">面接準備</h2>
          <p className="hint-text">
            ペルソナ・応募先・ESを基に想定質問、回答骨子、深掘り、振り返りを支援します。
          </p>
          <InterviewSection
            applicationId={detail.applicationId}
            stageLabel={detail.stageLabel}
          />
          <p style={{ marginTop: "0.75rem" }}>
            <Link href={`/app/deadlines?applicationId=${detail.applicationId}`}>
              面接予定を登録する
            </Link>
          </p>
        </section>

        <section aria-labelledby="timeline-title" className="card">
          <h2 id="timeline-title">選考履歴</h2>
          <ol className="timeline">
            {detail.events.map((event) => (
              <li key={event.id}>
                <span className="signal-id">#{event.sequence}</span>{" "}
                {historyEventLabel(event)} （{formatDateTime(event.occurredAt)}
                ）
                {event.note !== undefined && (
                  <span className="hint-text"> — {event.note}</span>
                )}
              </li>
            ))}
          </ol>
        </section>

        {detail.note !== undefined && (
          <section aria-labelledby="application-note-title" className="card">
            <h2 id="application-note-title">最新メモ</h2>
            <p className="prewrap">{detail.note}</p>
          </section>
        )}
      </div>
    </div>
  );
}
