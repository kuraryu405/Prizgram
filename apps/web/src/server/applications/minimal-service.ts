import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  applicationStatuses,
  employmentTypes,
  jobSnapshotSchema,
  stageLabelSchema,
  type AuthenticatedUser,
  type JobSnapshot,
} from "@prizgram/shared";
import {
  applications,
  applicationStageEvents,
  jobs,
  jobVersions,
  type DatabaseConnection,
} from "@prizgram/db";

import { jobContentHash } from "../jobs/service";
import { ApplicationService, type ApplicationDetail } from "./service";

export const minimalApplicationCreateSchema = z
  .object({
    company: z.string().trim().min(1).max(200),
    role: z.string().trim().min(1).max(200).optional(),
    employmentType: z.enum(employmentTypes).optional(),
    status: z.enum(applicationStatuses).optional(),
    stageLabel: stageLabelSchema.optional(),
    nextAction: z.string().trim().min(1).max(500).optional(),
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export type MinimalApplicationCreateInput = z.infer<
  typeof minimalApplicationCreateSchema
>;

const ROLE_UNSET_LABEL = "職種未設定";

/**
 * Registers an already-active selection without requiring a persona or a
 * complete job posting. Job + pinned JobVersion + Application + initial
 * history are created atomically.
 */
export class MinimalApplicationService {
  constructor(private readonly connection: DatabaseConnection) {}

  create(
    user: AuthenticatedUser,
    input: MinimalApplicationCreateInput,
  ): ApplicationDetail {
    const applicationId = this.connection.db.transaction((tx) => {
      const now = new Date();
      const jobId = randomUUID();
      const jobVersionId = randomUUID();
      const newApplicationId = randomUUID();
      const role = input.role ?? ROLE_UNSET_LABEL;
      const status = input.status ?? "saved";
      const snapshot: JobSnapshot = jobSnapshotSchema.parse({
        company: input.company,
        role,
        employmentType: input.employmentType ?? "full_time",
        description:
          input.role === undefined
            ? `手動登録: ${input.company}`
            : `手動登録: ${input.company} ${input.role}`,
        requirements: [
          { id: "manual:req:1", text: "求人票の詳細は未登録です" },
        ],
        desiredSkills: [],
        cultureValues: [],
        difficulty: { level: "entry", evidenceRefs: ["manual:req:1"] },
        source: {
          kind: "user_provided",
          name: "手動登録",
          retrievedAt: now.toISOString(),
        },
      });

      tx.insert(jobs).values({ id: jobId, userId: user.id }).run();
      tx.insert(jobVersions)
        .values({
          id: jobVersionId,
          userId: user.id,
          jobId,
          version: 1,
          snapshot,
          contentHash: jobContentHash(snapshot),
          promptVersion: "minimal-v1",
        })
        .run();
      tx.insert(applications)
        .values({
          id: newApplicationId,
          userId: user.id,
          jobId,
          jobVersionId,
          status,
          ...(input.stageLabel === undefined
            ? {}
            : { stageLabel: input.stageLabel }),
          ...(input.nextAction === undefined
            ? {}
            : { nextAction: input.nextAction }),
          ...(input.note === undefined ? {} : { note: input.note }),
        })
        .run();
      tx.insert(applicationStageEvents)
        .values({
          id: randomUUID(),
          applicationId: newApplicationId,
          userId: user.id,
          sequence: 1,
          toStatus: status,
          ...(input.stageLabel === undefined
            ? {}
            : { stageLabel: input.stageLabel }),
          ...(input.note === undefined ? {} : { note: input.note }),
          occurredAt: now,
        })
        .run();

      return newApplicationId;
    });

    return new ApplicationService(this.connection).getApplicationDetail(
      user.id,
      applicationId,
    );
  }
}
