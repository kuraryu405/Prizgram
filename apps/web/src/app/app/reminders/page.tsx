import Link from "next/link";

import { ReminderDismissButton } from "@/components/reminders/reminder-dismiss-button";
import { reminderPriorityLabels } from "@/lib/labels";
import { ReminderService } from "@prizgram/db";
import { getDatabase } from "@/server/database";
import { requireSessionUserPage } from "@/server/page-session";

export const dynamic = "force-dynamic";

function formatInZone(view: {
  scheduledFor: string;
  deadlineTimezone?: string;
}): string {
  const zone = view.deadlineTimezone ?? "Asia/Tokyo";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(view.scheduledFor));
  } catch {
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date(view.scheduledFor));
  }
}

export default async function RemindersPage() {
  const user = await requireSessionUserPage();
  const reminders = new ReminderService(getDatabase().db).listActive(user.id);

  return (
    <div className="page">
      <h1>リマインダー</h1>

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
                  {reminderPriorityLabels[reminder.priority] ??
                    reminder.priority}
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
