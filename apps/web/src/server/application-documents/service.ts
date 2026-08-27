/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AuthenticatedUser } from "@prizgram/shared";
import {
  applicationDocumentEntries,
  applicationDocuments,
  applications,
  type DatabaseConnection,
} from "@prizgram/db";

import { AppError } from "../api";

export const documentTypeSchema = z.enum(["es", "cv", "other"]);
export const documentStatusSchema = z.enum([
  "draft",
  "generated",
  "edited",
  "submitted",
]);
export const provenanceSchema = z.enum(["generated", "edited", "submitted"]);
const editableProvenanceSchema = z.enum(["generated", "edited"]);

export const documentCreateRequestSchema = z
  .object({
    type: documentTypeSchema.optional(),
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const documentUpdateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
  })
  .strict();

export const documentEntryCreateRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    answer: z.string().max(20_000).optional(),
    characterLimit: z.number().int().min(1).max(5_000).nullable().optional(),
    ordering: z.number().int().min(0).max(1_000).optional(),
    provenance: editableProvenanceSchema.optional(),
  })
  .strict();

export const documentEntryUpdateRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(500).optional(),
    answer: z.string().max(20_000).optional(),
    characterLimit: z.number().int().min(1).max(5_000).nullable().optional(),
    ordering: z.number().int().min(0).max(1_000).optional(),
    provenance: editableProvenanceSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.question !== undefined ||
      v.answer !== undefined ||
      v.characterLimit !== undefined ||
      v.ordering !== undefined ||
      v.provenance !== undefined,
    { message: "at least one field must be provided" },
  );

export type DocumentCreateInput = z.infer<typeof documentCreateRequestSchema>;
export type DocumentUpdateInput = z.infer<typeof documentUpdateRequestSchema>;
export type DocumentEntryCreateInput = z.infer<
  typeof documentEntryCreateRequestSchema
>;
export type DocumentEntryUpdateInput = z.infer<
  typeof documentEntryUpdateRequestSchema
>;

export type DocumentEntryView = Readonly<{
  id: string;
  documentId: string;
  question: string;
  answer: string;
  characterLimit?: number | null;
  ordering: number;
  provenance: "generated" | "edited" | "submitted";
  createdAt: string;
  updatedAt: string;
}>;

export type DocumentView = Readonly<{
  id: string;
  applicationId: string;
  type: "es" | "cv" | "other";
  title: string;
  status: "draft" | "generated" | "edited" | "submitted";
  submittedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  entries: readonly DocumentEntryView[];
}>;

export class ApplicationDocumentService {
  constructor(private readonly connection: DatabaseConnection) {}

  private ensureApplicationOwned(userId: string, applicationId: string) {
    const row = this.connection.db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
        ),
      )
      .get();
    if (row === undefined)
      throw new AppError("NOT_FOUND", "Application not found", 404);
  }

  private ensureDocumentOwned(
    userId: string,
    documentId: string,
  ): typeof applicationDocuments.$inferSelect {
    const row = this.connection.db
      .select()
      .from(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.id, documentId),
          eq(applicationDocuments.userId, userId),
        ),
      )
      .get();
    if (row === undefined)
      throw new AppError("NOT_FOUND", "Document not found", 404);
    return row;
  }

  listDocuments(userId: string, applicationId: string): DocumentView[] {
    this.ensureApplicationOwned(userId, applicationId);
    const docs = this.connection.db
      .select()
      .from(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.userId, userId),
          eq(applicationDocuments.applicationId, applicationId),
        ),
      )
      .all();
    docs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return docs.map((doc) => this.toView(userId, doc));
  }

  getDocument(userId: string, documentId: string): DocumentView {
    const doc = this.ensureDocumentOwned(userId, documentId);
    return this.toView(userId, doc);
  }

  createDocument(
    user: AuthenticatedUser,
    applicationId: string,
    input: DocumentCreateInput,
  ): DocumentView {
    this.ensureApplicationOwned(user.id, applicationId);
    const id = randomUUID();
    const now = new Date();
    this.connection.db
      .insert(applicationDocuments)
      .values({
        id,
        userId: user.id,
        applicationId,
        type: input.type ?? "es",
        title: input.title,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = this.ensureDocumentOwned(user.id, id);
    return this.toView(user.id, created);
  }

  updateDocument(
    userId: string,
    documentId: string,
    input: DocumentUpdateInput,
  ): DocumentView {
    const doc = this.ensureDocumentOwned(userId, documentId);
    if (doc.status === "submitted") {
      throw new AppError(
        "DOCUMENT_SUBMITTED",
        "Submitted documents cannot be edited",
        409,
      );
    }
    const now = new Date();
    this.connection.db
      .update(applicationDocuments)
      .set({ title: input.title, updatedAt: now })
      .where(
        and(
          eq(applicationDocuments.id, documentId),
          eq(applicationDocuments.userId, userId),
        ),
      )
      .run();
    const updated = this.ensureDocumentOwned(userId, documentId);
    return this.toView(userId, updated);
  }

  submitDocument(userId: string, documentId: string): DocumentView {
    const doc = this.ensureDocumentOwned(userId, documentId);
    if (doc.status === "submitted") {
      throw new AppError(
        "DOCUMENT_ALREADY_SUBMITTED",
        "Document is already submitted",
        409,
      );
    }
    const now = new Date();
    this.connection.db
      .update(applicationDocuments)
      .set({ status: "submitted", submittedAt: now, updatedAt: now })
      .where(
        and(
          eq(applicationDocuments.id, documentId),
          eq(applicationDocuments.userId, userId),
        ),
      )
      .run();
    const submitted = this.ensureDocumentOwned(userId, documentId);
    return this.toView(userId, submitted);
  }

  deleteDocument(userId: string, documentId: string): void {
    const doc = this.ensureDocumentOwned(userId, documentId);
    if (doc.status === "submitted") {
      throw new AppError(
        "DOCUMENT_SUBMITTED",
        "Submitted documents cannot be deleted",
        409,
      );
    }
    this.connection.db
      .delete(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.id, documentId),
          eq(applicationDocuments.userId, userId),
        ),
      )
      .run();
  }

  listEntries(userId: string, documentId: string): DocumentEntryView[] {
    this.ensureDocumentOwned(userId, documentId);
    const rows = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.userId, userId),
          eq(applicationDocumentEntries.documentId, documentId),
        ),
      )
      .all();
    rows.sort((a, b) => a.ordering - b.ordering);
    return rows.map((row) => this.entryToView(row));
  }

  createEntry(
    userId: string,
    documentId: string,
    input: DocumentEntryCreateInput,
  ): DocumentEntryView {
    const doc = this.ensureDocumentOwned(userId, documentId);
    if (doc.status === "submitted") {
      throw new AppError(
        "DOCUMENT_SUBMITTED",
        "Submitted documents cannot be edited",
        409,
      );
    }
    const id = randomUUID();
    const now = new Date();
    const provenance = input.provenance ?? "edited";
    this.connection.db
      .insert(applicationDocumentEntries)
      .values({
        id,
        userId,
        documentId,
        question: input.question,
        answer: input.answer ?? "",
        ...(input.characterLimit === undefined
          ? {}
          : { characterLimit: input.characterLimit }),
        ordering: input.ordering ?? 0,
        provenance,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (doc.status === "draft" && provenance === "generated") {
      this.connection.db
        .update(applicationDocuments)
        .set({ status: "generated", updatedAt: now })
        .where(
          and(
            eq(applicationDocuments.id, documentId),
            eq(applicationDocuments.userId, userId),
          ),
        )
        .run();
    } else if (
      (doc.status === "draft" || doc.status === "generated") &&
      provenance === "edited"
    ) {
      this.connection.db
        .update(applicationDocuments)
        .set({ status: "edited", updatedAt: now })
        .where(
          and(
            eq(applicationDocuments.id, documentId),
            eq(applicationDocuments.userId, userId),
          ),
        )
        .run();
    }

    const row = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.id, id),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .get();
    if (row === undefined) {
      throw new AppError("INTERNAL_ERROR", "Document entry missing", 500);
    }
    return this.entryToView(row);
  }

  updateEntry(
    userId: string,
    entryId: string,
    input: DocumentEntryUpdateInput,
  ): DocumentEntryView {
    const entry = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.id, entryId),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .get();
    if (entry === undefined)
      throw new AppError("NOT_FOUND", "Entry not found", 404);
    const doc = this.ensureDocumentOwned(userId, entry.documentId);
    if (doc.status === "submitted" || entry.provenance === "submitted") {
      throw new AppError(
        "DOCUMENT_SUBMITTED",
        "Submitted entries cannot be edited",
        409,
      );
    }
    const now = new Date();
    const anyContentChanged =
      input.question !== undefined ||
      input.answer !== undefined ||
      input.characterLimit !== undefined ||
      input.ordering !== undefined;
    const newProvenance =
      input.provenance ?? (anyContentChanged ? "edited" : entry.provenance);
    this.connection.db
      .update(applicationDocumentEntries)
      .set({
        ...(input.question !== undefined ? { question: input.question } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.characterLimit !== undefined
          ? { characterLimit: input.characterLimit }
          : {}),
        ...(input.ordering !== undefined ? { ordering: input.ordering } : {}),
        provenance: newProvenance,
        updatedAt: now,
      })
      .where(
        and(
          eq(applicationDocumentEntries.id, entryId),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .run();
    if (newProvenance === "edited" && doc.status !== "edited") {
      this.connection.db
        .update(applicationDocuments)
        .set({ status: "edited", updatedAt: now })
        .where(
          and(
            eq(applicationDocuments.id, doc.id),
            eq(applicationDocuments.userId, userId),
          ),
        )
        .run();
    }
    const updated = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.id, entryId),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .get();
    if (updated === undefined) {
      throw new AppError("INTERNAL_ERROR", "Document entry missing", 500);
    }
    return this.entryToView(updated);
  }

  deleteEntry(userId: string, entryId: string): void {
    const entry = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.id, entryId),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .get();
    if (entry === undefined)
      throw new AppError("NOT_FOUND", "Entry not found", 404);
    const doc = this.ensureDocumentOwned(userId, entry.documentId);
    if (doc.status === "submitted" || entry.provenance === "submitted") {
      throw new AppError(
        "DOCUMENT_SUBMITTED",
        "Submitted entries cannot be deleted",
        409,
      );
    }
    this.connection.db
      .delete(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.id, entryId),
          eq(applicationDocumentEntries.userId, userId),
        ),
      )
      .run();
  }

  private toView(
    userId: string,
    doc: typeof applicationDocuments.$inferSelect,
  ): DocumentView {
    const entries = this.connection.db
      .select()
      .from(applicationDocumentEntries)
      .where(
        and(
          eq(applicationDocumentEntries.userId, userId),
          eq(applicationDocumentEntries.documentId, doc.id),
        ),
      )
      .all();
    entries.sort((a, b) => a.ordering - b.ordering);
    return {
      id: doc.id,
      applicationId: doc.applicationId,
      type: doc.type as DocumentView["type"],
      title: doc.title,
      status: doc.status as DocumentView["status"],
      submittedAt: doc.submittedAt?.toISOString() ?? null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
      entries: entries.map((entry) => this.entryToView(entry)),
    };
  }

  private entryToView(
    row: typeof applicationDocumentEntries.$inferSelect,
  ): DocumentEntryView {
    return {
      id: row.id,
      documentId: row.documentId,
      question: row.question,
      answer: row.answer,
      characterLimit: row.characterLimit,
      ordering: row.ordering,
      provenance: row.provenance as DocumentEntryView["provenance"],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
