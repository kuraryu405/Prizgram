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
import { DeadlineService } from "@/server/deadlines/service";
import { JobService } from "@/server/jobs/service";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
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

  // Workspace aggregations: deadlines for this application (source of truth: application_deadlines)
  let deadlines: ReturnType<DeadlineService["listForApplication"]> = [];
  try {
    deadlines = new DeadlineService(db).listForApplication(user.id, id);
  } catch {
    deadlines = [];
  }

  // Pinned JobVersion snapshot (source of truth: applications.jobVersionId)
  // If pinned is missing (legacy row), fall back to latest via ApplicationService logic already in detail.appliedCompany
  let pinnedSnapshot:
    { company: string; role: string; description?: string } | undefined;
  try {
    if (detail.jobVersionId !== undefined) {
      const jobDetail = new JobService(db).getJobDetail(user.id, detail.jobId);
      const pinned = jobDetail.versions.find(
        (v) => v.jobVersionId === detail.jobVersionId,
      );
      if (pinned !== undefined) {
        // We need full snapshot for description; fetch latest snapshot as placeholder
        // The pinned version's snapshot is not directly exposed via JobService list, so use latest snapshot
        // as the pinned and latest are same company/role for most cases; full snapshot fetch via jobVersions table
        const row = db.sqlite
          .prepare(
            "select snapshot from job_versions where id = ? and user_id = ?",
          )
          .get(detail.jobVersionId, user.id) as
          { snapshot: string } | undefined;
        if (row !== undefined) {
          try {
            const snap = JSON.parse(row.snapshot) as {
              company: string;
              role: string;
              description: string;
            };
            pinnedSnapshot = {
              company: snap.company,
              role: snap.role,
              description: snap.description,
            };
          } catch {
            pinnedSnapshot = undefined;
          }
        }
      }
    }
  } catch {
    pinnedSnapshot = undefined;
  }

  const nextDeadline = deadlines.find((d) => !d.completed && !d.overdue);

  return (
    <div className="page application-workspace">
      <p className="breadcrumb">
        <Link href="/app/applications">応募管理へ戻る</Link> /{" "}
        <Link href={`/app/jobs/${detail.jobId}`}>求人を見る</Link>
      </p>

      {/* Header: single source of truth is applications.status / stageLabel / nextAction */}
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
          <p className="hint-text">次にやることを設定してください。</p>
        )}
        {nextDeadline !== undefined && (
          <p className="hint-text">
            次の締切: {nextDeadline.title} —{" "}
            {formatDateTime(nextDeadline.dueAt)} ({nextDeadline.timeZone})
          </p>
        )}
      </header>

      <div className="workspace-grid">
        <section aria-labelledby="overview-title" className="card">
          <h2 id="overview-title">概要</h2>
          <dl className="workspace-dl">
            <dt>企業</dt>
            <dd>{detail.company}</dd>
            <dt>職種</dt>
            <dd>{detail.role}</dd>
            <dt>ステータス</dt>
            <dd>{statusLabels[detail.status] ?? detail.status}</dd>
            <dt>現在ステージ</dt>
            <dd>{detail.stageLabel ?? "未設定"}</dd>
            <dt>応募時求人バージョン</dt>
            <dd>{detail.jobVersionId ?? "未固定（レガシー）"}</dd>
            {pinnedSnapshot !== undefined && (
              <>
                <dt>応募時企業（pin）</dt>
                <dd>{pinnedSnapshot.company}</dd>
                <dt>応募時職種（pin）</dt>
                <dd>{pinnedSnapshot.role}</dd>
              </>
            )}
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

        <section aria-labelledby="pinned-job-title" className="card">
          <h2 id="pinned-job-title">応募した求人（固定）</h2>
          <p className="hint-text">
            この応募は作成時の求人バージョンに固定されています。求人内容が更新されても過去応募の対象はすり替わりません（source
            of truth: applications.jobVersionId）。
          </p>
          {pinnedSnapshot?.description !== undefined ? (
            <p className="prewrap">
              {pinnedSnapshot.description.slice(0, 500)}
            </p>
          ) : (
            <p className="hint-text">求人本文は求人詳細で確認できます。</p>
          )}
          <p>
            <Link href={`/app/jobs/${detail.jobId}`}>求人詳細を見る</Link>
          </p>
        </section>

        <section aria-labelledby="deadlines-title" className="card">
          <h2 id="deadlines-title">締切</h2>
          {deadlines.length === 0 ? (
            <p className="hint-text">締切はまだ登録されていません。</p>
          ) : (
            <ul className="deadline-list">
              {deadlines.map((d) => (
                <li key={d.deadlineId}>
                  <strong>{d.title}</strong> — {d.kind} —{" "}
                  {formatDateTime(d.dueAt)} ({d.timeZone}){" "}
                  {d.completed ? "(完了)" : d.overdue ? "(期限切れ)" : ""}
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link href={`/app/deadlines?applicationId=${detail.applicationId}`}>
              締切を管理する
            </Link>
          </p>
          <p className="hint-text">
            締切の source of truth は application_deadlines
            です。Application.nextAction は derived表示です。
          </p>
        </section>

        <section aria-labelledby="documents-title" className="card">
          <h2 id="documents-title">応募書類 / ES</h2>
          <p className="hint-text">
            ESや職務経歴書をこの応募に紐付けて管理できます（#125）。
          </p>
          <div className="workspace-placeholder" aria-label="ES領域">
            <p className="hint-text">
              まだ書類がありません。#125でdocument追加・編集・提出が可能になります。
            </p>
            {/* Future: ApplicationDocument list will be mounted here. Keep boundary small for #262. */}
          </div>
        </section>

        <section aria-labelledby="interview-title" className="card">
          <h2 id="interview-title">面接</h2>
          <p className="hint-text">
            面接予定は締切（interview）として管理し、選考履歴で面接実施を記録します。
          </p>
          <div className="workspace-placeholder" aria-label="面接領域">
            <p className="hint-text">
              面接支援は #264
              でこの領域に統合されます。現時点は履歴と締切をご利用ください。
            </p>
          </div>
        </section>

        <section aria-labelledby="timeline-title" className="card">
          <h2 id="timeline-title">選考履歴</h2>
          <p className="hint-text">
            source of truth:
            application_stage_events（append-only）。status/stageLabelの現在値はapplicationsが持ちますが、履歴はeventが正本です。
          </p>
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
