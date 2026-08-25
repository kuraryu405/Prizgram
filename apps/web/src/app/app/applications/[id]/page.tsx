import Link from "next/link";
import { notFound } from "next/navigation";

import { ApplicationUpdateForm } from "@/components/applications/application-update-form";
import { getDatabase } from "@/server/database";
import { ApplicationService } from "@/server/applications/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

const statusLabels: Readonly<Record<string, string>> = {
  accepted: "内定承諾",
  applying: "応募中",
  interview: "面接",
  offer: "内定",
  rejected: "落選",
  saved: "保存済み",
  screening: "書類選考",
  submitted: "応募送信済み",
  withdrawn: "辞退",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
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
    } catch {
      notFound();
    }
  })();

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link href="/app/applications">応募管理へ戻る</Link>
      </p>
      <h1>{detail.company}</h1>
      <p className="page-lead">
        {detail.role} / 現在のステータス:{" "}
        {statusLabels[detail.status] ?? detail.status}
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
        statusLabels={statusLabels}
      />

      <section aria-labelledby="timeline-title" className="card">
        <h2 id="timeline-title">ステータス履歴</h2>
        <ol className="timeline">
          {detail.events.map((event) => (
            <li key={event.id}>
              <span className="signal-id">#{event.sequence}</span>{" "}
              {event.fromStatus === undefined
                ? "作成"
                : `${statusLabels[event.fromStatus] ?? event.fromStatus} → `}
              {statusLabels[event.toStatus] ?? event.toStatus}（
              {formatDateTime(event.occurredAt)}）
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
