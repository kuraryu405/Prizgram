import Link from "next/link";

import { ReminderDismissButton } from "@/components/reminders/reminder-dismiss-button";
import { ReminderService } from "@prizgram/db";
import { getDatabase } from "@/server/database";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

const priorityLabels: Readonly<Record<string, string>> = {
  urgent: "緊急",
  high: "高",
  medium: "中",
  low: "低",
};

function formatInZone(view: { scheduledFor: string }): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date(view.scheduledFor));
}

export default async function RemindersPage() {
  const user = await requireSessionUserPage();
  const reminders = new ReminderService(getDatabase().db).listActive(user.id);

  return (
    <div className="page">
      <h1>リマインダー</h1>
      <p className="page-lead">
        締切接近を優先度付きで通知します。生成はcronによる定期実行と、このページの閲覧時に行われます（重複しません）。
      </p>

      {reminders.length === 0 ? (
        <p className="hint-text">現在表示できるリマインダーはありません。</p>
      ) : (
        <ul className="card-grid">
          {reminders.map((reminder) => (
            <li key={reminder.id} className="card">
              <p>
                <span
                  className={`priority-badge priority-${reminder.priority}`}
                >
                  優先度:{" "}
                  {priorityLabels[reminder.priority] ?? reminder.priority}
                </span>
              </p>
              <p>{reminder.message}</p>
              <p className="hint-text">検知時刻: {formatInZone(reminder)}</p>
              <ReminderDismissButton reminderId={reminder.id} />
            </li>
          ))}
        </ul>
      )}

      <p className="hint-text">
        <Link href="/app/deadlines">締切の管理へ</Link>
      </p>
    </div>
  );
}
