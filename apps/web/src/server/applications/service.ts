import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  applicationStatuses,
  applicationTransitions,
  stageLabelSchema,
  terminalApplicationStatuses,
  type ApplicationStatus,
  type AuthenticatedUser,
} from "@prizgram/shared";
import {
  applications,
  applicationStageEvents,
  jobs,
  jobVersions,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";

export const applicationCreateRequestSchema = z
  .object({
    jobId: z.string().trim().min(1).max(128),
    status: z.enum(applicationStatuses).optional(),
    stageLabel: stageLabelSchema.optional(),
    nextAction: z.string().trim().min(1).max(500).optional(),
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const applicationUpdateRequestSchema = z
  .object({
    status: z.enum(applicationStatuses).optional(),
    stageLabel: stageLabelSchema.nullable().optional(),
    nextAction: z.string().trim().max(500).nullable().optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.status !== undefined ||
      input.stageLabel !== undefined ||
      input.nextAction !== undefined ||
      input.note !== undefined,
    { message: "at least one field must be provided" },
  );

export type ApplicationCreateInput = z.infer<
  typeof applicationCreateRequestSchema
>;
export type ApplicationUpdateInput = z.infer<
  typeof applicationUpdateRequestSchema
>;

export type StageEventView = Readonly<{
  id: string;
  sequence: number;
  fromStatus?: ApplicationStatus;
  toStatus: ApplicationStatus;
  stageLabel?: string;
  note?: string;
  occurredAt: string;
}>;

type ApplicationCore = Readonly<{
  applicationId: string;
  jobId: string;
  jobVersionId?: string;
  status: ApplicationStatus;
  stageLabel?: string;
  nextAction?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ApplicationSummary = ApplicationCore &
  Readonly<{ company: string; role: string }>;

export type ApplicationDetail = ApplicationCore &
  Readonly<{
    company: string;
    role: string;
    /** Pinned snapshot company/role vs current latest for UI comparison. */
    appliedCompany?: string;
    appliedRole?: string;
    allowedNextStatuses: readonly ApplicationStatus[];
    events: readonly StageEventView[];
  }>;

const terminalApplicationStatusSet = new Set<ApplicationStatus>(
  terminalApplicationStatuses,
);

function allowedNextStatusesFor(
  status: ApplicationStatus,
): readonly ApplicationStatus[] {
  if (terminalApplicationStatusSet.has(status)) return [];

  // A non-terminal broad status is deliberately editable in both directions.
  // This keeps the broad status useful for aggregation while allowing users to
  // correct an imported/current stage without building a workflow engine.
  const corrections = applicationStatuses.filter(
    (candidate) =>
      candidate !== status && !terminalApplicationStatusSet.has(candidate),
  );
  const terminalTransitions = applicationTransitions[status].filter(
    (candidate) => terminalApplicationStatusSet.has(candidate),
  );
  return [...new Set([...corrections, ...terminalTransitions])];
}

export class ApplicationService {
  constructor(private readonly connection: DatabaseConnection) {}

  /** Creates an application from an owned job. Submission is never automated. */
  createFromJob(
    user: AuthenticatedUser,
    input: ApplicationCreateInput,
  ): ApplicationSummary {
    return this.connection.db.transaction((tx) => {
      const ownedJob = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, input.jobId), eq(jobs.userId, user.id)))
        .get();
      if (ownedJob === undefined) {
        throw new AppError("NOT_FOUND", "Job not found", 404);
      }
      const existingForJob = tx
        .select({ id: applications.id, status: applications.status })
        .from(applications)
        .where(
          and(
            eq(applications.userId, user.id),
            eq(applications.jobId, input.jobId),
          ),
        )
        .all();
      const blocked = existingForJob.find((r) => r.status !== "cancelled");
      if (blocked !== undefined) {
        throw new AppError(
          "APPLICATION_EXISTS",
          "This job is already in your applications",
          409,
        );
      }

      const now = new Date();
      const applicationId = randomUUID();
      // Pin the latest job version at creation time (#184)
      const latestVersion = tx
        .select({ id: jobVersions.id })
        .from(jobVersions)
        .where(
          and(
            eq(jobVersions.userId, user.id),
            eq(jobVersions.jobId, input.jobId),
          ),
        )
        .orderBy(sql`${jobVersions.version} desc`)
        .limit(1)
        .get();
      if (latestVersion === undefined) {
        throw new AppError("NOT_FOUND", "Job version not found", 404);
      }
      // Ensure the pinned version belongs to the same user/job (ownership already checked)
      // and store it alongside current note (#159)
      tx.insert(applications)
        .values({
          id: applicationId,
          userId: user.id,
          jobId: input.jobId,
          jobVersionId: latestVersion.id,
          status: input.status ?? "saved",
          ...(input.stageLabel === undefined
            ? {}
            : { stageLabel: input.stageLabel }),
          ...(input.nextAction === undefined
            ? {}
            : { nextAction: input.nextAction }),
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .run();
      this.insertEvent(tx, {
        applicationId,
        userId: user.id,
        sequence: 1,
        fromStatus: null,
        toStatus: input.status ?? "saved",
        ...(input.stageLabel === undefined
          ? {}
          : { stageLabel: input.stageLabel }),
        ...(input.note === undefined ? {} : { note: input.note }),
        occurredAt: now,
      });

      const created = tx
        .select()
        .from(applications)
        .where(eq(applications.id, applicationId))
        .get();
      if (created === undefined) {
        throw new AppError("INTERNAL_ERROR", "Application missing", 500);
      }
      // Prefer pinned snapshot for company/role; fallback to latest for legacy rows
      const pinned = this.companyRoleForApplications(user.id, [
        { jobId: created.jobId, jobVersionId: created.jobVersionId },
      ]);
      const fallback = this.companyRole(user.id, input.jobId);
      const resolved = pinned.get(created.jobId) ?? fallback;
      return {
        ...this.coreFromDrizzle(created),
        company: resolved.company,
        role: resolved.role,
      };
    });
  }

  listApplications(
    userId: string,
    filter: { status?: ApplicationStatus } = {},
  ): ApplicationSummary[] {
    const rows =
      filter.status === undefined
        ? this.connection.db
            .select()
            .from(applications)
            .where(
              and(
                eq(applications.userId, userId),
                sql`${applications.status} != 'cancelled'`,
              ),
            )
            .all()
        : this.connection.db
            .select()
            .from(applications)
            .where(
              and(
                eq(applications.userId, userId),
                eq(applications.status, filter.status),
              ),
            )
            .all();
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    // Prefer pinned jobVersion for company/role; fallback to latest for legacy nulls (#184)
    const pinnedMap = this.companyRoleForApplications(
      userId,
      rows.map((r) => ({ jobId: r.jobId, jobVersionId: r.jobVersionId })),
    );
    const missingJobIds = rows
      .filter((r) => !pinnedMap.has(r.jobId))
      .map((r) => r.jobId);
    const latestFallback =
      missingJobIds.length > 0
        ? this.latestJobVersions(userId, missingJobIds)
        : new Map<string, { company: string; role: string }>();
    return rows.map((row) => {
      const pinned = pinnedMap.get(row.jobId);
      const fallback = latestFallback.get(row.jobId);
      const resolved = pinned ??
        fallback ?? { company: "(不明)", role: "(不明)" };
      return {
        ...this.coreFromDrizzle(row),
        company: resolved.company,
        role: resolved.role,
      };
    });
  }

  getApplicationDetail(
    userId: string,
    applicationId: string,
  ): ApplicationDetail {
    const row = this.loadOwned(userId, applicationId);
    const eventRows = this.connection.db
      .select()
      .from(applicationStageEvents)
      .where(eq(applicationStageEvents.applicationId, applicationId))
      .all();
    eventRows.sort((a, b) => a.sequence - b.sequence);
    // Resolve pinned version if present; keep latest as applied vs current distinction
    const pinned =
      row.jobVersionId === null || row.jobVersionId === undefined
        ? undefined
        : this.companyRoleForApplications(userId, [
            { jobId: row.jobId, jobVersionId: row.jobVersionId },
          ]).get(row.jobId);
    const latest = this.companyRole(userId, row.jobId);
    const resolved = pinned ?? latest;
    const applied = pinned ?? latest;
    return {
      ...this.coreFromDrizzle(row),
      company: resolved.company,
      role: resolved.role,
      appliedCompany: applied.company,
      appliedRole: applied.role,
      allowedNextStatuses: allowedNextStatusesFor(row.status),
      events: eventRows.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        ...(event.fromStatus === null ? {} : { fromStatus: event.fromStatus }),
        toStatus: event.toStatus,
        ...(event.stageLabel === null ? {} : { stageLabel: event.stageLabel }),
        ...(event.note === null ? {} : { note: event.note }),
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }

  /**
   * Broad-status or stage-label changes append exactly one history event inside
   * the same transaction as the update. Sequences are recomputed as max+1 and
   * guarded by the unique (application_id, sequence) index.
   */
  updateApplication(
    user: AuthenticatedUser,
    applicationId: string,
    input: ApplicationUpdateInput,
  ): ApplicationDetail {
    this.connection.db.transaction((tx) => {
      const found = tx
        .select()
        .from(applications)
        .where(
          and(
            eq(applications.id, applicationId),
            eq(applications.userId, user.id),
          ),
        )
        .get();
      if (found === undefined) {
        throw new AppError("NOT_FOUND", "Application not found", 404);
      }

      const statusChanged =
        input.status !== undefined && input.status !== found.status;
      const stageLabelChanged =
        input.stageLabel !== undefined &&
        input.stageLabel !== (found.stageLabel ?? null);
      if (
        input.status !== undefined &&
        statusChanged &&
        !allowedNextStatusesFor(found.status).includes(input.status)
      ) {
        throw new AppError(
          "INVALID_STATUS_TRANSITION",
          `Cannot move from ${found.status} to ${input.status}`,
          409,
        );
      }

      const resultingStageLabel =
        input.stageLabel !== undefined
          ? input.stageLabel
          : (found.stageLabel ?? null);

      tx.update(applications)
        .set({
          ...(statusChanged && input.status !== undefined
            ? { status: input.status }
            : {}),
          ...(input.stageLabel === undefined
            ? {}
            : input.stageLabel === null
              ? { stageLabel: null }
              : { stageLabel: input.stageLabel }),
          ...(input.nextAction === undefined
            ? {}
            : input.nextAction === null
              ? { nextAction: null }
              : { nextAction: input.nextAction }),
          ...(input.note === undefined
            ? {}
            : input.note === null
              ? { note: null }
              : { note: input.note }),
          updatedAt: new Date(),
        })
        .where(eq(applications.id, applicationId))
        .run();

      if (statusChanged || stageLabelChanged) {
        const maxSequence = tx
          .select({
            value: sql<number>`coalesce(max(${applicationStageEvents.sequence}), 0)`,
          })
          .from(applicationStageEvents)
          .where(eq(applicationStageEvents.applicationId, applicationId))
          .get();
        this.insertEvent(tx, {
          applicationId,
          userId: user.id,
          sequence: Number(maxSequence?.value ?? 0) + 1,
          fromStatus: found.status,
          toStatus:
            statusChanged && input.status !== undefined
              ? input.status
              : found.status,
          ...(resultingStageLabel === null
            ? {}
            : { stageLabel: resultingStageLabel }),
          ...(input.note !== undefined && input.note !== null
            ? { note: input.note }
            : {}),
          occurredAt: new Date(),
        });
      }
    });

    // Same connection: the transaction above has committed by the time this runs.
    return this.getApplicationDetail(user.id, applicationId);
  }

  // --- helpers -----------------------------------------------------------

  private insertEvent(
    tx: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
    values: {
      applicationId: string;
      userId: string;
      sequence: number;
      fromStatus: ApplicationStatus | null;
      toStatus: ApplicationStatus;
      stageLabel?: string | null;
      note?: string;
      occurredAt: Date;
    },
  ): void {
    tx.insert(applicationStageEvents)
      .values({
        id: randomUUID(),
        applicationId: values.applicationId,
        userId: values.userId,
        sequence: values.sequence,
        ...(values.fromStatus === null
          ? {}
          : { fromStatus: values.fromStatus }),
        toStatus: values.toStatus,
        ...(values.stageLabel === undefined || values.stageLabel === null
          ? {}
          : { stageLabel: values.stageLabel }),
        ...(values.note === undefined ? {} : { note: values.note }),
        occurredAt: values.occurredAt,
      })
      .run();
  }

  private loadOwned(userId: string, applicationId: string) {
    const row = this.connection.db
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
        ),
      )
      .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Application not found", 404);
    }
    return row;
  }

  private coreFromDrizzle(row: {
    id: string;
    status: ApplicationStatus;
    stageLabel?: string | null;
    nextAction: string | null;
    note?: string | null;
    createdAt: Date;
    updatedAt: Date;
    jobId: string;
    jobVersionId?: string | null;
  }): ApplicationCore {
    return {
      applicationId: row.id,
      jobId: row.jobId,
      ...(row.jobVersionId == null ? {} : { jobVersionId: row.jobVersionId }),
      status: row.status,
      ...(row.stageLabel == null ? {} : { stageLabel: row.stageLabel }),
      ...(row.nextAction === null ? {} : { nextAction: row.nextAction }),
      ...(row.note === undefined || row.note === null
        ? {}
        : { note: row.note }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private companyRole(userId: string, jobId: string) {
    const versions = this.latestJobVersions(userId, [jobId]);
    return versions.get(jobId) ?? { company: "(不明)", role: "(不明)" };
  }

  private companyRoleForApplications(
    userId: string,
    pairs: ReadonlyArray<{ jobId: string; jobVersionId?: string | null }>,
  ): ReadonlyMap<string, { company: string; role: string }> {
    const result = new Map<string, { company: string; role: string }>();
    const pinnedIds = pairs
      .filter((p) => p.jobVersionId != null)
      .map((p) => p.jobVersionId as string);
    if (pinnedIds.length === 0) return result;
    const rows = this.connection.db
      .select({
        jobId: jobVersions.jobId,
        id: jobVersions.id,
        snapshot: jobVersions.snapshot,
      })
      .from(jobVersions)
      .where(
        and(eq(jobVersions.userId, userId), inArray(jobVersions.id, pinnedIds)),
      )
      .all();
    const byId = new Map<string, (typeof rows)[number]>();
    for (const r of rows) byId.set(r.id, r);
    for (const { jobId, jobVersionId } of pairs) {
      if (jobVersionId == null) continue;
      const row = byId.get(jobVersionId);
      if (row === undefined) continue;
      // Ensure the pinned version's jobId matches the application's jobId (ownership already validated at creation)
      if (row.jobId !== jobId) continue;
      result.set(jobId, {
        company: row.snapshot.company,
        role: row.snapshot.role,
      });
    }
    return result;
  }

  private latestJobVersions(userId: string, jobIds: string[]) {
    const result = new Map<string, { company: string; role: string }>();
    if (jobIds.length === 0) return result;
    const versionRows = this.connection.db
      .select({
        jobId: jobVersions.jobId,
        version: jobVersions.version,
        snapshot: jobVersions.snapshot,
      })
      .from(jobVersions)
      .where(
        and(eq(jobVersions.userId, userId), inArray(jobVersions.jobId, jobIds)),
      )
      .all();
    const latestVersionByJob = new Map<string, number>();
    for (const row of versionRows) {
      const current = latestVersionByJob.get(row.jobId) ?? 0;
      if (row.version > current) latestVersionByJob.set(row.jobId, row.version);
    }
    for (const row of versionRows) {
      if (latestVersionByJob.get(row.jobId) !== row.version) continue;
      // Drizzle's validated JSON column already decodes + validates.
      result.set(row.jobId, {
        company: row.snapshot.company,
        role: row.snapshot.role,
      });
    }
    return result;
  }
}
