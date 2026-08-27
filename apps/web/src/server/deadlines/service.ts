import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { deadlineKinds, type AuthenticatedUser } from "@prizgram/shared";
import {
  applications,
  applicationDeadlines,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";

const TIMEZONE_PATTERN = /^[A-Za-z_]+\/[A-Za-z_+-]+(\/[A-Za-z_+-]+)?$|^UTC$/;

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const deadlineCreateRequestSchema = z
  .object({
    applicationId: z.string().trim().min(1).max(128),
    kind: z.enum(deadlineKinds),
    title: z.string().trim().min(1).max(200),
    /** Wall-clock time in `timeZone`, format YYYY-MM-DDTHH:mm. */
    dueLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    timeZone: z
      .string()
      .trim()
      .regex(TIMEZONE_PATTERN)
      .refine(isValidTimeZone, {
        message: "unknown time zone",
      }),
  })
  .strict();

export const deadlineUpdateRequestSchema = z
  .object({
    kind: z.enum(deadlineKinds).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    dueLocal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .optional(),
    timeZone: z
      .string()
      .trim()
      .regex(TIMEZONE_PATTERN)
      .refine(isValidTimeZone, { message: "unknown time zone" })
      .optional(),
    completed: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.kind !== undefined ||
      input.title !== undefined ||
      input.dueLocal !== undefined ||
      input.timeZone !== undefined ||
      input.completed !== undefined,
    { message: "at least one field must be provided" },
  );

export type DeadlineCreateInput = z.infer<typeof deadlineCreateRequestSchema>;
export type DeadlineUpdateInput = z.infer<typeof deadlineUpdateRequestSchema>;

export type DeadlineView = Readonly<{
  deadlineId: string;
  applicationId: string;
  kind: (typeof deadlineKinds)[number];
  title: string;
  /** UTC instant. */
  dueAt: string;
  timeZone: string;
  completed: boolean;
  overdue: boolean;
  within24Hours: boolean;
  note?: string;
}>;

/** Converts wall-clock time in a zone to a UTC ISO instant (DST-safe). */
/** Service boundary wrapper: any invalid zone/date becomes a 400. */
export function safeZonedToIso(local: string, timeZone: string): string {
  try {
    return zonedDateTimeToIso(local, timeZone);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid local datetime",
      400,
      undefined,
      undefined,
      {
        cause: error,
      },
    );
  }
}

function wallTimeInZone(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const year = values.year ?? "1970";
  const month = values.month ?? "01";
  const day = values.day ?? "01";
  let hour = Number(values.hour ?? "0");
  // Midnight may be reported as 24 in some locales
  if (hour === 24) hour = 0;
  const hourStr = String(hour).padStart(2, "0");
  const minute = (values.minute ?? "00").padStart(2, "0");
  return `${year}-${month}-${day}T${hourStr}:${minute}`;
}

export function zonedDateTimeToIso(local: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (match === null) {
    throw new AppError("VALIDATION_ERROR", "Invalid local datetime", 400);
  }
  const [, y, mo, d, h, mi] = match;
  const utcBase = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
  );
  let timestamp = utcBase;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offsetMinutes = zoneOffsetMinutes(timestamp, timeZone);
    const adjusted = utcBase - offsetMinutes * 60_000;
    if (adjusted === timestamp) break;
    timestamp = adjusted;
  }
  // DST gap detection: if the wall time does not exist, the round-trip
  // will land on a different wall-clock time. Reject instead of silently
  // normalizing to a neighboring valid instant.
  const roundTripped = wallTimeInZone(timestamp, timeZone);
  if (roundTripped !== local) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This local time does not exist in the selected timezone (DST gap)",
      400,
    );
  }
  // Ambiguous fall-back times (e.g. 01:30 occurring twice) intentionally
  // resolve to the earlier occurrence. The round-trip check passes for
  // either occurrence, so we keep the deterministic result from the
  // iteration above.
  return new Date(timestamp).toISOString();
}

function zoneOffsetMinutes(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(
    values.year ?? 1970,
    (values.month ?? 1) - 1,
    values.day ?? 1,
    (values.hour ?? 0) % 24,
    values.minute ?? 0,
  );
  return Math.round((asUtc - timestamp) / 60_000);
}

export class DeadlineService {
  constructor(private readonly connection: DatabaseConnection) {}

  create(user: AuthenticatedUser, input: DeadlineCreateInput): DeadlineView {
    const ownedApplication = this.connection.db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.id, input.applicationId),
          eq(applications.userId, user.id),
        ),
      )
      .get();
    if (ownedApplication === undefined) {
      throw new AppError("NOT_FOUND", "Application not found", 404);
    }

    const dueAt = safeZonedToIso(input.dueLocal, input.timeZone);
    const id = randomUUID();
    this.connection.db
      .insert(applicationDeadlines)
      .values({
        id,
        userId: user.id,
        applicationId: input.applicationId,
        kind: input.kind,
        title: input.title,
        dueAt: new Date(dueAt),
        timezone: input.timeZone,
      })
      .run();
    return this.getOne(user.id, id);
  }

  list(userId: string): DeadlineView[] {
    const rows = this.connection.db
      .select()
      .from(applicationDeadlines)
      .where(eq(applicationDeadlines.userId, userId))
      .all();
    rows.sort((x, y) => x.dueAt.getTime() - y.dueAt.getTime());
    const now = Date.now();
    return rows.map((row) => this.toView(row, now));
  }

  update(
    user: AuthenticatedUser,
    deadlineId: string,
    input: DeadlineUpdateInput,
  ): DeadlineView {
    const row = this.connection.db
      .select()
      .from(applicationDeadlines)
      .where(
        and(
          eq(applicationDeadlines.id, deadlineId),
          eq(applicationDeadlines.userId, user.id),
        ),
      )
      .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Deadline not found", 404);
    }

    if (
      input.timeZone !== undefined &&
      input.timeZone !== row.timezone &&
      input.dueLocal === undefined
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "dueLocal is required when changing time zone",
        400,
      );
    }

    const timeZone = input.timeZone ?? row.timezone;
    const dueLocal = input.dueLocal;
    const dueAt =
      dueLocal !== undefined
        ? new Date(safeZonedToIso(dueLocal, timeZone))
        : row.dueAt;

    this.connection.db
      .update(applicationDeadlines)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        dueAt,
        timezone: timeZone,
        ...(input.completed === undefined
          ? {}
          : { completedAt: input.completed ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(applicationDeadlines.id, deadlineId))
      .run();

    return this.getOne(user.id, deadlineId);
  }

  remove(user: AuthenticatedUser, deadlineId: string): void {
    const result = this.connection.db
      .delete(applicationDeadlines)
      .where(
        and(
          eq(applicationDeadlines.id, deadlineId),
          eq(applicationDeadlines.userId, user.id),
        ),
      )
      .run();
    if (result.changes !== 1) {
      throw new AppError("NOT_FOUND", "Deadline not found", 404);
    }
  }

  private getOne(userId: string, deadlineId: string): DeadlineView {
    const row = this.connection.db
      .select()
      .from(applicationDeadlines)
      .where(
        and(
          eq(applicationDeadlines.id, deadlineId),
          eq(applicationDeadlines.userId, userId),
        ),
      )
      .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Deadline not found", 404);
    }
    return this.toView(row, Date.now());
  }

  private toView(
    row: {
      id: string;
      applicationId: string;
      kind: (typeof deadlineKinds)[number];
      title: string;
      dueAt: Date;
      timezone: string;
      completedAt: Date | null;
      note?: string | null;
    },
    nowEpoch: number,
  ): DeadlineView {
    const dueMs = row.dueAt.getTime();
    const completed = row.completedAt !== null;
    return {
      deadlineId: row.id,
      applicationId: row.applicationId,
      kind: row.kind,
      title: row.title,
      dueAt: row.dueAt.toISOString(),
      timeZone: row.timezone,
      completed,
      overdue: !completed && dueMs < nowEpoch,
      within24Hours:
        !completed && dueMs >= nowEpoch && dueMs - nowEpoch <= 86_400_000,
      ...(row.note === undefined || row.note === null
        ? {}
        : { note: row.note }),
    };
  }
}
