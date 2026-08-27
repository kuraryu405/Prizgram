import type { ScoreDetail } from "@/server/scoring/service";

export interface NextActionInput {
  hasPersona: boolean;
  jobs: ReadonlyArray<{ jobId: string }>;
  scoredJobIds: ReadonlySet<string>;
  applicationCount: number;
  urgentReminderCount: number;
  overdueDeadlines: ReadonlyArray<{
    applicationId: string;
    title: string;
    dueAt: string;
  }>;
}

export type ActionItem = Readonly<{
  href: string;
  label: string;
  detail: string;
  tone: "urgent" | "normal";
}>;

/**
 * Orders dashboard next-actions by urgency: blockers first (urgent
 * reminders, overdue deadlines), then onboarding gaps (persona → jobs →
 * scoring → applications) so the list always starts with the single most
 * useful action.
 */
export function buildNextActions(
  input: NextActionInput,
): readonly ActionItem[] {
  const actions: ActionItem[] = [];

  if (input.urgentReminderCount > 0) {
    actions.push({
      href: "/app/reminders",
      label: "緊急リマインダーを確認",
      detail: `緊急 ${input.urgentReminderCount} 件が待機中です`,
      tone: "urgent",
    });
  }
  for (const deadline of input.overdueDeadlines.slice(0, 2)) {
    actions.push({
      href: `/app/applications/${encodeURIComponent(deadline.applicationId)}`,
      label: `期限超過: ${deadline.title}`,
      detail: "締切を過ぎています。状況を確認してください",
      tone: "urgent",
    });
  }
  if (!input.hasPersona) {
    actions.push({
      href: "/app/persona/intake",
      label: "ペルソナ・ヒアリングを始める",
      detail: "対話に答えると、スキル・経験・価値観が構造化されます",
      tone: "normal",
    });
  }
  if (input.hasPersona && input.jobs.length === 0) {
    actions.push({
      href: "/app/jobs",
      label: "求人票を取り込む",
      detail: "気になる求人を貼り付けると、評価できる形で保存されます",
      tone: "normal",
    });
  }
  if (input.hasPersona && input.jobs.length > 0) {
    const unscored = input.jobs.filter(
      (job) => !input.scoredJobIds.has(job.jobId),
    );
    if (unscored.length > 0) {
      actions.push({
        href: `/app/jobs/${encodeURIComponent(unscored[0]?.jobId ?? "")}`,
        label: `未評価の求人を評価する（残り ${unscored.length} 件）`,
        detail: "3軸スコアと根拠を確認しましょう",
        tone: "normal",
      });
    }
  }
  if (input.applicationCount === 0 && input.jobs.length > 0) {
    actions.push({
      href: "/app/applications",
      label: "応募を登録する",
      detail: "選考ステータスと締切を追跡できます",
      tone: "normal",
    });
  }
  return actions;
}

export type DashboardScoreSummary = Pick<ScoreDetail, "axes" | "scoreId">;
