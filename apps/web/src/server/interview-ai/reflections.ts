import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  applicationInterviewReflections,
  applications,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";

export type InterviewReflectionInput = Readonly<{
  stageLabel?: string | null;
  questionsAsked?: readonly string[];
  answerNotes?: string;
  impression?: string | null;
  feedback?: string | null;
}>;

export type InterviewReflectionView = Readonly<{
  id: string;
  applicationId: string;
  stageLabel?: string | null;
  questionsAsked: readonly string[];
  answerNotes: string;
  impression?: string | null;
  feedback?: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export class InterviewReflectionService {
  constructor(private readonly connection: DatabaseConnection) {}

  private ensureApplicationOwned(userId: string, applicationId: string): void {
    const application = this.connection.db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
        ),
      )
      .get();
    if (application === undefined) {
      throw new AppError("NOT_FOUND", "Application not found", 404);
    }
  }

  list(userId: string, applicationId: string): InterviewReflectionView[] {
    this.ensureApplicationOwned(userId, applicationId);
    const rows = this.connection.db
      .select()
      .from(applicationInterviewReflections)
      .where(
        and(
          eq(applicationInterviewReflections.userId, userId),
          eq(applicationInterviewReflections.applicationId, applicationId),
        ),
      )
      .all();
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return rows.map((row) => this.toView(row));
  }

  create(
    userId: string,
    applicationId: string,
    input: InterviewReflectionInput,
  ): InterviewReflectionView {
    this.ensureApplicationOwned(userId, applicationId);
    const id = randomUUID();
    const now = new Date();
    this.connection.db
      .insert(applicationInterviewReflections)
      .values({
        id,
        userId,
        applicationId,
        ...(input.stageLabel === undefined
          ? {}
          : { stageLabel: input.stageLabel }),
        questionsAsked: JSON.stringify(input.questionsAsked ?? []),
        answerNotes: input.answerNotes ?? "",
        ...(input.impression === undefined
          ? {}
          : { impression: input.impression }),
        ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.getOwned(userId, id);
  }

  update(
    userId: string,
    reflectionId: string,
    input: InterviewReflectionInput,
  ): InterviewReflectionView {
    const existing = this.getOwnedRow(userId, reflectionId);
    this.ensureApplicationOwned(userId, existing.applicationId);
    this.connection.db
      .update(applicationInterviewReflections)
      .set({
        ...(input.stageLabel === undefined
          ? {}
          : { stageLabel: input.stageLabel }),
        ...(input.questionsAsked === undefined
          ? {}
          : { questionsAsked: JSON.stringify(input.questionsAsked) }),
        ...(input.answerNotes === undefined
          ? {}
          : { answerNotes: input.answerNotes }),
        ...(input.impression === undefined
          ? {}
          : { impression: input.impression }),
        ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(applicationInterviewReflections.id, reflectionId),
          eq(applicationInterviewReflections.userId, userId),
        ),
      )
      .run();
    return this.getOwned(userId, reflectionId);
  }

  delete(userId: string, reflectionId: string): void {
    const existing = this.getOwnedRow(userId, reflectionId);
    this.ensureApplicationOwned(userId, existing.applicationId);
    this.connection.db
      .delete(applicationInterviewReflections)
      .where(
        and(
          eq(applicationInterviewReflections.id, reflectionId),
          eq(applicationInterviewReflections.userId, userId),
        ),
      )
      .run();
  }

  private getOwned(
    userId: string,
    reflectionId: string,
  ): InterviewReflectionView {
    return this.toView(this.getOwnedRow(userId, reflectionId));
  }

  private getOwnedRow(userId: string, reflectionId: string) {
    const row = this.connection.db
      .select()
      .from(applicationInterviewReflections)
      .where(
        and(
          eq(applicationInterviewReflections.id, reflectionId),
          eq(applicationInterviewReflections.userId, userId),
        ),
      )
      .get();
    if (row === undefined) {
      throw new AppError("NOT_FOUND", "Reflection not found", 404);
    }
    return row;
  }

  private toView(
    row: typeof applicationInterviewReflections.$inferSelect,
  ): InterviewReflectionView {
    let questionsAsked: string[] = [];
    try {
      const parsed = JSON.parse(row.questionsAsked) as unknown;
      if (Array.isArray(parsed)) {
        questionsAsked = parsed.filter(
          (question): question is string => typeof question === "string",
        );
      }
    } catch {
      questionsAsked = [];
    }
    return {
      id: row.id,
      applicationId: row.applicationId,
      stageLabel: row.stageLabel ?? null,
      questionsAsked,
      answerNotes: row.answerNotes,
      impression: row.impression ?? null,
      feedback: row.feedback ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
