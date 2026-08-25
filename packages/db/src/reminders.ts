import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { applicationDeadlines, applications, reminders } from "./schema";
import type { DatabaseConnection } from "./client";

/**
 * Deterministic reminder generation for approaching deadlines.
 *
 * Buckets derive purely from remaining time (no LLM): overdue, 24 hours,
 * 3 days, and 7 days. Each bucket maps to at most one reminder row keyed by
 * a stable dedupe key, so cron re-runs and concurrent runs cannot duplicate
 * notifications. Completed deadlines, terminal applications, and dismissed
 * reminders are never re-notified.
 */

export type ReminderPriority = "low" | "medium" | "high" | "urgent";
export type ReminderStatus = "pending" | "sent" | "dismissed" | "failed";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const TERMINAL_APPLICATION_STATUSES = new Set([
  "accepted",
  "rejected",
  "withdrawn",
]);

const kindLabels: Readonly<Record<string, string>> = {
  application: "応募締切",
  document: "ES・書類",
  interview: "面接",
  offer_response: "内定承諾",
  other: "その他",
};

type BucketName = "overdue" | "24h" | "3d" | "7d";

function bucketsFor(
  remainingMs: number,
): Array<{ name: BucketName; priority: ReminderPriority }> {
  const buckets: Array<{ name: BucketName; priority: ReminderPriority }> = [];
  if (remainingMs < 0) {
    buckets.push({ name: "overdue", priority: "urgent" });
    return buckets;
  }
  if (remainingMs <= DAY_MS) {
    buckets.push({ name: "24h", priority: "urgent" });
  }
  if (remainingMs <= 3 * DAY_MS) {
    buckets.push({ name: "3d", priority: "high" });
  }
  if (remainingMs <= 7 * DAY_MS) {
    buckets.push({ name: "7d", priority: "medium" });
  }
  return buckets;
}

function messageFor(
  bucket: BucketName,
  kind: string,
  title: string,
  dueAt: Date,
): string {
  const label = kindLabels[kind] ?? "締切";
  const dueText = new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(dueAt);
  switch (bucket) {
    case "overdue":
      return `${label}「${title}」が期限超過しています（期限: ${dueText}）`;
    case "24h":
      return `24時間以内に${label}「${title}」の期限です（期限: ${dueText}）`;
    case "3d":
      return `3日以内に${label}「${title}」の期限が迫っています（期限: ${dueText}）`;
    case "7d":
      return `1週間以内に${label}「${title}」の期限があります（期限: ${dueText}）`;
  }
}

export interface GenerateOptions {
  now: Date;
  /** Safety valve for very large scans. */
  limit?: number;
}

export interface GenerateSummary {
  scanned: number;
  created: number;
}

/** Read-side row used by the API/UI. */
export interface ReminderRow {
  id: string;
  userId: string;
  deadlineId: string;
  priority: ReminderPriority;
  status: ReminderStatus;
  message: string;
  dedupeKey: string;
  scheduledFor: string;
  createdAt: string;
}

export class ReminderService {
  private readonly db: DatabaseConnection["db"];

  constructor(db: DatabaseConnection["db"]) {
    this.db = db;
  }

  /**
   * Scans open deadlines and inserts one reminder per newly-entered bucket.
   * Returns the number of scanned deadlines and created reminders. Safe to
   * run concurrently: duplicates are absorbed by the unique dedupe index.
   */
  generateDueReminders(options: GenerateOptions): GenerateSummary {
    const now = options.now.getTime();
    const rows = this.db
      .select({
        id: applicationDeadlines.id,
        userId: applicationDeadlines.userId,
        applicationId: applicationDeadlines.applicationId,
        kind: applicationDeadlines.kind,
        title: applicationDeadlines.title,
        dueAt: applicationDeadlines.dueAt,
      })
      .from(applicationDeadlines)
      .innerJoin(
        applications,
        eq(applications.id, applicationDeadlines.applicationId),
      )
      .where(and(isNull(applicationDeadlines.completedAt)))
      .all() as Array<{
      id: string;
      userId: string;
      applicationId: string;
      kind: string;
      title: string;
      dueAt: Date;
    }>;

    let scanned = 0;
    let created = 0;

    for (const row of rows) {
      if (options.limit !== undefined && scanned >= options.limit) break;
      scanned += 1;

      // Terminal applications never generate reminders.
      const application = this.db
        .select({ status: applications.status })
        .from(applications)
        .where(eq(applications.id, row.applicationId))
        .get();
      if (
        application === undefined ||
        TERMINAL_APPLICATION_STATUSES.has(application.status)
      ) {
        continue;
      }

      const remaining = row.dueAt.getTime() - now;
      for (const bucket of bucketsFor(remaining)) {
        const dedupeKey = `${row.kind}:${row.id}:${bucket.name}`;
        const inserted = this.db
          .insert(reminders)
          .values({
            id: randomUUID(),
            userId: row.userId,
            deadlineId: row.id,
            scheduledFor: new Date(now),
            priority: bucket.priority,
            status: "pending",
            message: messageFor(bucket.name, row.kind, row.title, row.dueAt),
            dedupeKey,
          })
          .onConflictDoNothing()
          .run();
        created += inserted.changes;
      }
    }

    return { scanned, created };
  }

  /**
   * Lists active (pending + sent) reminders ordered by urgency. Pending rows
   * returned here are flipped to `sent`: listing IS the in-app delivery.
   */
  listActive(userId: string): ReminderRow[] {
    const rows = this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, userId),
          inArray(reminders.status, ["pending", "sent"]),
        ),
      )
      .all();

    const priorityRank: Record<ReminderPriority, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    rows.sort((a, b) => {
      const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
      if (byPriority !== 0) return byPriority;
      return a.scheduledFor.getTime() - b.scheduledFor.getTime();
    });

    const pendingIds = rows
      .filter((row) => row.status === "pending")
      .map((row) => row.id);
    if (pendingIds.length > 0) {
      this.db
        .update(reminders)
        .set({ status: "sent", updatedAt: new Date() })
        .where(inArray(reminders.id, pendingIds))
        .run();
    }

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      deadlineId: row.deadlineId,
      priority: row.priority,
      status: row.status,
      message: row.message,
      dedupeKey: row.dedupeKey,
      scheduledFor: new Date(row.scheduledFor).toISOString(),
      createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  dismiss(userId: string, reminderId: string): boolean {
    const result = this.db
      .update(reminders)
      .set({
        status: "dismissed",
        dismissedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(reminders.id, reminderId), eq(reminders.userId, userId)))
      .run();
    return result.changes === 1;
  }

  countActive(userId: string): { urgent: number; total: number } {
    const rows = this.listActive(userId);
    return {
      urgent: rows.filter((row) => row.priority === "urgent").length,
      total: rows.length,
    };
  }
}
