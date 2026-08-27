import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplicationUpdateForm } from "@/components/applications/application-update-form";
import { applicationStatusLabels as statusLabels } from "@/lib/labels";
import { AppError } from "@/server/api";
import { getDatabase } from "@/server/database";
import {
  ApplicationService,
  type ApplicationDetail,
} from "@/server/applications/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

function historyEventLabel(
  event: ApplicationDetail["events"][number],
): string {
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
  const detail = (() => {
    try {
      return new ApplicationService(getDatabase()).getApplicationDetail(
        user.id,
        id,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
      throw error;
    }
  })();

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app/applications">応募管理へ戻る</Link>
      </p>
      <h1>{detail.company}</h1>
      <p className="page-lead">
        {detail.role} / {statusLabels[detail.status] ?? detail.status}
        {detail.stageLabel !== undefined && ` / ${detail.stageLabel}`}
      </p>
      {detail.nextAction !== undefined && (
        <p>
          次のアクション: <strong>{detail.nextAction}</strong>
        </p>
      )}

      <ApplicationUpdateForm
        allowedNextStatuses={detail.allowedNextStatuses}
        applicationId={detail.applicationId}
        currentStatus={statusLabels[detail.status] ?? detail.status}
        initialStageLabel={detail.stageLabel}
        initialNextAction={detail.nextAction}
        initialNote={detail.note}
        statusLabels={statusLabels}
      />

      <section aria-labelledby="timeline-title" className="card">
        <h2 id="timeline-title">選考履歴</h2>
        <ol className="timeline">
          {detail.events.map((event) => (
            <li key={event.id}>
              <span className="signal-id">#{event.sequence}</span>{" "}
              {historyEventLabel(event)} （{formatDateTime(event.occurredAt)}）
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
  );
}
