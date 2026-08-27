import { createHash, randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";

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
  "cancelled",
]);

const priorityRank: Record<ReminderPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const kindLabels: Readonly<Record<string, string>> = {
  application: "応募締切",
  document: "ES・書類",
  interview: "面接",
  offer_response: "内定承諾",
  other: "その他",
};

type BucketName = "overdue" | "24h" | "3d" | "7d";

function desiredBucketFor(
  remainingMs: number,
): { name: BucketName; priority: ReminderPriority } | null {
  if (remainingMs < 0) {
    return { name: "overdue", priority: "urgent" };
  }
  if (remainingMs <= DAY_MS) {
    return { name: "24h", priority: "urgent" };
  }
  if (remainingMs <= 3 * DAY_MS) {
    return { name: "3d", priority: "high" };
  }
  if (remainingMs <= 7 * DAY_MS) {
    return { name: "7d", priority: "medium" };
  }
  return null;
}

// Kept for backwards compatibility; now delegates to desiredBucketFor.
export function bucketsFor(
  remainingMs: number,
): Array<{ name: BucketName; priority: ReminderPriority }> {
  const desired = desiredBucketFor(remainingMs);
  return desired === null ? [] : [desired];
}

function titleHashFor(title: string): string {
  return createHash("sha256").update(title).digest("hex").slice(0, 12);
}

function dedupeKeyFor(params: {
  kind: string;
  deadlineId: string;
  bucket: BucketName;
  dueAt: Date;
  timezone: string;
  title: string;
}): string {
  return `${params.kind}:${params.deadlineId}:${params.bucket}:${params.dueAt.getTime()}:${params.timezone}:${titleHashFor(params.title)}`;
}

function messageFor(
  bucket: BucketName,
  kind: string,
  title: string,
  dueAt: Date,
  timezone: string,
): string {
  const label = kindLabels[kind] ?? "締切";
  let dueText: string;
  try {
    dueText = new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(dueAt);
  } catch {
    dueText = new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(dueAt);
  }
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
  /** Deadline wall-clock zone used for message due text; exposed so UI can format consistently. */
  deadlineTimezone?: string;
  /** ISO instant of the associated deadline's dueAt. */
  deadlineDueAt?: string;
}

export class ReminderService {
  private readonly db: DatabaseConnection["db"];

  constructor(db: DatabaseConnection["db"]) {
    this.db = db;
  }

  /**
   * Scans open deadlines and inserts one reminder per deadline for its most
   * urgent applicable bucket. Returns the number of scanned deadlines and
   * created reminders. Safe to run concurrently: duplicates are absorbed by
   * the unique dedupe index which now includes dueAt/timezone/title so
   * rescheduled or renamed deadlines produce distinct keys while manual
   * dismissals of an unchanged bucket remain blocked.
   *
   * Active reminders whose bucket is no longer desired (superseded, overdue
   * transition, or rescheduled) are dismissed before insertion so at most one
   * active reminder remains per deadline.
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
        timezone: applicationDeadlines.timezone,
        appStatus: applications.status,
      })
      .from(applicationDeadlines)
      .innerJoin(
        applications,
        eq(applications.id, applicationDeadlines.applicationId),
      )
      .where(
        and(
          isNull(applicationDeadlines.completedAt),
          notInArray(applications.status, [
            "accepted",
            "rejected",
            "withdrawn",
            "cancelled",
          ]),
        ),
      )
      .all() as Array<{
      id: string;
      userId: string;
      applicationId: string;
      kind: string;
      title: string;
      dueAt: Date;
      timezone: string;
      appStatus: string;
    }>;

    // Preload existing active reminders for all scanned deadlines in one query
    // to avoid per-deadline N+1.
    const deadlineIds = rows.map((row) => row.id);
    const activeByDeadline = new Map<
      string,
      Array<typeof reminders.$inferSelect>
    >();
    if (deadlineIds.length > 0) {
      const actives = this.db
        .select()
        .from(reminders)
        .where(
          and(
            inArray(reminders.deadlineId, deadlineIds),
            inArray(reminders.status, ["pending", "sent"]),
          ),
        )
        .all();
      for (const reminder of actives) {
        const bucket = activeByDeadline.get(reminder.deadlineId);
        if (bucket === undefined) {
          activeByDeadline.set(reminder.deadlineId, [reminder]);
        } else {
          bucket.push(reminder);
        }
      }
    }

    let scanned = 0;
    let created = 0;

    for (const row of rows) {
      if (options.limit !== undefined && scanned >= options.limit) break;
      scanned += 1;

      const remaining = row.dueAt.getTime() - now;
      const desired = desiredBucketFor(remaining);
      const existing = activeByDeadline.get(row.id) ?? [];

      if (desired === null) {
        // Too far away: delete system-stale reminders so they don't block regeneration (#174)
        if (existing.length > 0) {
          this.deleteMany(
            row.userId,
            existing.map((r) => r.id),
          );
          // Keep map in sync for later listActive calls in same tick.
          activeByDeadline.delete(row.id);
        }
        continue;
      }

      const expectedKey = dedupeKeyFor({
        kind: row.kind,
        deadlineId: row.id,
        bucket: desired.name,
        dueAt: row.dueAt,
        timezone: row.timezone,
        title: row.title,
      });

      // Delete system-stale reminder whose dedupe does not match the current desired state (#174)
      const staleIds = existing
        .filter((r) => r.dedupeKey !== expectedKey)
        .map((r) => r.id);
      if (staleIds.length > 0) {
        this.deleteMany(row.userId, staleIds);
      }

      const hasExpected = existing.some((r) => r.dedupeKey === expectedKey);
      if (hasExpected) continue;

      // Do not resurrect a previously dismissed identical reminder (user
      // manually dismissed this bucket for this content) – the unique dedupe
      // index will block it via onConflictDoNothing.
      const inserted = this.db
        .insert(reminders)
        .values({
          id: randomUUID(),
          userId: row.userId,
          deadlineId: row.id,
          scheduledFor: new Date(now),
          priority: desired.priority,
          status: "pending",
          message: messageFor(
            desired.name,
            row.kind,
            row.title,
            row.dueAt,
            row.timezone,
          ),
          dedupeKey: expectedKey,
        })
        .onConflictDoNothing()
        .run();
      created += inserted.changes;
    }

    return { scanned, created };
  }

  /**
   * Lists active (pending + sent) reminders ordered by urgency. Pure read
   * (#171): it never flips pending to sent. Stale system reminders are
   * deleted (not dismissed) so they don't block regeneration (#174).
   *
   * Reminders whose deadline has since been completed, moved to a terminal
   * application status, been deleted, rescheduled/renamed, changed timezone,
   * or whose bucket is no longer the single most-urgent applicable bucket
   * are deleted and excluded.
   */
  listActive(userId: string, now: Date = new Date()): ReminderRow[] {
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

    const staleIds = this.staleReminderIds(userId, rows, now);
    if (staleIds.length > 0) {
      // System stale must not be treated as user dismiss (#174) – delete so dedupe can be regenerated
      this.deleteMany(userId, staleIds);
    }

    const staleIdSet = new Set(staleIds);

    const activeRows = rows.filter((row) => !staleIdSet.has(row.id));
    // Enrich remaining rows with deadline timezone/dueAt for correct UI formatting.
    const activeDeadlineIds = [...new Set(activeRows.map((r) => r.deadlineId))];
    const deadlineMeta = new Map<string, { timezone: string; dueAt: Date }>();
    if (activeDeadlineIds.length > 0) {
      const metaRows = this.db
        .select({
          id: applicationDeadlines.id,
          timezone: applicationDeadlines.timezone,
          dueAt: applicationDeadlines.dueAt,
        })
        .from(applicationDeadlines)
        .where(
          and(
            eq(applicationDeadlines.userId, userId),
            inArray(applicationDeadlines.id, activeDeadlineIds),
          ),
        )
        .all();
      for (const m of metaRows) {
        deadlineMeta.set(m.id, { timezone: m.timezone, dueAt: m.dueAt });
      }
    }

    return activeRows
      .sort((a, b) => {
        const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
        if (byPriority !== 0) return byPriority;
        return a.scheduledFor.getTime() - b.scheduledFor.getTime();
      })
      .map((row) => {
        const meta = deadlineMeta.get(row.deadlineId);
        return {
          id: row.id,
          userId: row.userId,
          deadlineId: row.deadlineId,
          priority: row.priority,
          status: row.status,
          message: row.message,
          dedupeKey: row.dedupeKey,
          scheduledFor: new Date(row.scheduledFor).toISOString(),
          createdAt: new Date(row.createdAt).toISOString(),
          ...(meta === undefined
            ? {}
            : {
                deadlineTimezone: meta.timezone,
                deadlineDueAt: meta.dueAt.toISOString(),
              }),
        };
      });
  }

  /**
   * Returns the ids of active reminders whose underlying deadline is now
   * completed, deleted/terminal, rescheduled/renamed/timezone-changed, or
   * whose bucket is no longer the single most-urgent applicable one. Time
   * sensitivity is evaluated against the provided wall clock.
   */
  private staleReminderIds(
    userId: string,
    rows: Array<typeof reminders.$inferSelect>,
    nowDate: Date = new Date(),
  ): string[] {
    if (rows.length === 0) return [];
    const deadlineIds = [...new Set(rows.map((row) => row.deadlineId))];
    const applicationRows = this.db
      .select({
        id: applicationDeadlines.id,
        completedAt: applicationDeadlines.completedAt,
        status: applications.status,
        kind: applicationDeadlines.kind,
        title: applicationDeadlines.title,
        dueAt: applicationDeadlines.dueAt,
        timezone: applicationDeadlines.timezone,
      })
      .from(applicationDeadlines)
      .innerJoin(
        applications,
        eq(applications.id, applicationDeadlines.applicationId),
      )
      .where(
        and(
          eq(applicationDeadlines.userId, userId),
          inArray(applicationDeadlines.id, deadlineIds),
        ),
      )
      .all();

    const stateByDeadline = new Map(
      applicationRows.map((row) => [row.id, row] as const),
    );
    const now = nowDate.getTime();
    const stale: string[] = [];
    for (const row of rows) {
      const state = stateByDeadline.get(row.deadlineId);
      // A reminder whose deadline row vanished has nothing left to remind
      // about; treat it as stale as well.
      if (
        state === undefined ||
        state.completedAt !== null ||
        TERMINAL_APPLICATION_STATUSES.has(state.status)
      ) {
        stale.push(row.id);
        continue;
      }

      const desired = desiredBucketFor(state.dueAt.getTime() - now);
      if (desired === null) {
        // Deadline is now too far out for any bucket; any active reminder is
        // superseded.
        stale.push(row.id);
        continue;
      }
      const expectedKey = dedupeKeyFor({
        kind: state.kind,
        deadlineId: state.id,
        bucket: desired.name,
        dueAt: state.dueAt,
        timezone: state.timezone,
        title: state.title,
      });
      if (row.dedupeKey !== expectedKey) {
        // Different dueAt / timezone / title / bucket – the stored message
        // and scheduled priorites are stale.
        stale.push(row.id);
      }
    }
    return stale;
  }

  /** Dismisses the given reminders owned by the user; returns rows changed. */
  private dismissMany(userId: string, reminderIds: string[]): number {
    const result = this.db
      .update(reminders)
      .set({
        status: "dismissed",
        dismissedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(reminders.userId, userId), inArray(reminders.id, reminderIds)),
      )
      .run();
    return result.changes;
  }

  private deleteMany(userId: string, reminderIds: string[]): number {
    const result = this.db
      .delete(reminders)
      .where(
        and(eq(reminders.userId, userId), inArray(reminders.id, reminderIds)),
      )
      .run();
    return result.changes;
  }

  dismiss(userId: string, reminderId: string): boolean {
    return this.dismissMany(userId, [reminderId]) === 1;
  }

  countActive(
    userId: string,
    now: Date = new Date(),
  ): { urgent: number; total: number } {
    const rows = this.listActive(userId, now);
    return {
      urgent: rows.filter((row) => row.priority === "urgent").length,
      total: rows.length,
    };
  }
}
