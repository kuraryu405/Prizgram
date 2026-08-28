import "server-only";

import { z } from "zod";

const evidenceRef = z.string().trim().min(1).max(128);
const providerText = z.string();
const providerOptionalText = z.string().nullable();

const MAX_QUESTION_COUNT = 10;
const MAX_QUESTION_TEXT_LENGTH = 500;
const MAX_EVIDENCE_REF_COUNT = 20;
const MAX_EVIDENCE_REF_LENGTH = 128;
const MAX_OUTLINE_TEXT_LENGTH = 1_000;
const MAX_OUTLINE_ACTION_LENGTH = 2_000;
const MAX_OUTLINE_POINT_COUNT = 10;
const MAX_OUTLINE_POINT_LENGTH = 500;
const MAX_WARNING_COUNT = 10;

const expectedQuestionProviderSchema = z
  .object({
    question: providerText,
    intent: providerText,
    basis: providerText,
    materialRefs: z.array(providerText).max(MAX_QUESTION_COUNT),
  })
  .strict();

export const expectedQuestionsProviderSchema = z
  .object({
    questions: z
      .array(expectedQuestionProviderSchema)
      .min(1)
      .max(MAX_QUESTION_COUNT),
    insufficientContext: z.boolean(),
  })
  .strict();

export const expectedQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    basis: z.string().trim().min(1).max(500),
    materialRefs: z.array(evidenceRef).max(MAX_QUESTION_COUNT),
  })
  .strict();

export const expectedQuestionsDomainSchema = z
  .object({
    questions: z.array(expectedQuestionSchema).min(1).max(MAX_QUESTION_COUNT),
    insufficientContext: z.boolean(),
  })
  .strict();

const answerOutlineProviderFields = {
  situation: providerOptionalText,
  task: providerOptionalText,
  action: providerOptionalText,
  result: providerOptionalText,
  points: z.array(providerText).min(1).max(MAX_OUTLINE_POINT_COUNT),
};

export const answerOutlineProviderSchema = z
  .object({
    outline: z.object(answerOutlineProviderFields).strict(),
    evidenceRefs: z.array(providerText).max(MAX_EVIDENCE_REF_COUNT),
    warnings: z.array(providerText).max(MAX_WARNING_COUNT),
    insufficientContext: z.boolean(),
  })
  .strict();

export const answerOutlineDomainSchema = z
  .object({
    outline: z
      .object({
        situation: z
          .string()
          .trim()
          .min(1)
          .max(MAX_OUTLINE_TEXT_LENGTH)
          .optional(),
        task: z.string().trim().min(1).max(MAX_OUTLINE_TEXT_LENGTH).optional(),
        action: z
          .string()
          .trim()
          .min(1)
          .max(MAX_OUTLINE_ACTION_LENGTH)
          .optional(),
        result: z
          .string()
          .trim()
          .min(1)
          .max(MAX_OUTLINE_ACTION_LENGTH)
          .optional(),
        points: z
          .array(z.string().trim().min(1).max(MAX_OUTLINE_POINT_LENGTH))
          .min(1)
          .max(MAX_OUTLINE_POINT_COUNT),
      })
      .strict(),
    evidenceRefs: z.array(evidenceRef).max(MAX_EVIDENCE_REF_COUNT),
    warnings: z
      .array(z.string().trim().min(1).max(MAX_OUTLINE_POINT_LENGTH))
      .max(MAX_WARNING_COUNT),
    insufficientContext: z.boolean(),
  })
  .strict();

export const followupProviderSchema = z
  .object({
    questions: z.array(providerText).min(1).max(MAX_QUESTION_COUNT),
  })
  .strict();

export const followupDomainSchema = z
  .object({
    questions: z
      .array(z.string().trim().min(1).max(MAX_QUESTION_TEXT_LENGTH))
      .min(1)
      .max(MAX_QUESTION_COUNT),
  })
  .strict();

export function normalizeExpectedQuestions(
  value: z.infer<typeof expectedQuestionsProviderSchema>,
): z.infer<typeof expectedQuestionsDomainSchema> {
  return {
    questions: value.questions
      .map((question) => ({
        question: normalizeText(question.question, MAX_QUESTION_TEXT_LENGTH),
        intent: normalizeText(question.intent, MAX_QUESTION_TEXT_LENGTH),
        basis: normalizeText(question.basis, MAX_QUESTION_TEXT_LENGTH),
        materialRefs: normalizeTextList(
          question.materialRefs,
          MAX_EVIDENCE_REF_LENGTH,
          MAX_QUESTION_COUNT,
        ),
      }))
      .filter(
        (question) =>
          question.question !== "" &&
          question.intent !== "" &&
          question.basis !== "",
      ),
    insufficientContext: value.insufficientContext,
  };
}

export function normalizeAnswerOutline(
  value: z.infer<typeof answerOutlineProviderSchema>,
): z.infer<typeof answerOutlineDomainSchema> {
  const { outline, ...rest } = value;
  const situation = normalizeOptionalText(
    outline.situation,
    MAX_OUTLINE_TEXT_LENGTH,
  );
  const task = normalizeOptionalText(outline.task, MAX_OUTLINE_TEXT_LENGTH);
  const action = normalizeOptionalText(
    outline.action,
    MAX_OUTLINE_ACTION_LENGTH,
  );
  const result = normalizeOptionalText(
    outline.result,
    MAX_OUTLINE_ACTION_LENGTH,
  );
  return {
    ...rest,
    evidenceRefs: normalizeTextList(
      value.evidenceRefs,
      MAX_EVIDENCE_REF_LENGTH,
      MAX_EVIDENCE_REF_COUNT,
    ),
    warnings: normalizeTextList(
      value.warnings,
      MAX_OUTLINE_POINT_LENGTH,
      MAX_WARNING_COUNT,
    ),
    outline: {
      points: normalizeTextList(
        outline.points,
        MAX_OUTLINE_POINT_LENGTH,
        MAX_OUTLINE_POINT_COUNT,
      ),
      ...(situation === undefined ? {} : { situation }),
      ...(task === undefined ? {} : { task }),
      ...(action === undefined ? {} : { action }),
      ...(result === undefined ? {} : { result }),
    },
  };
}

export function normalizeFollowup(
  value: z.infer<typeof followupProviderSchema>,
): z.infer<typeof followupDomainSchema> {
  return {
    questions: normalizeTextList(
      value.questions,
      MAX_QUESTION_TEXT_LENGTH,
      MAX_QUESTION_COUNT,
    ),
  };
}

function normalizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function normalizeOptionalText(
  value: string | null,
  maxLength: number,
): string | undefined {
  if (value === null) return undefined;
  const normalized = normalizeText(value, maxLength);
  return normalized === "" ? undefined : normalized;
}

function normalizeTextList(
  values: readonly string[],
  maxLength: number,
  maxItems: number,
): string[] {
  return values
    .map((value) => normalizeText(value, maxLength))
    .filter((value) => value !== "")
    .slice(0, maxItems);
}

export const materialCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1_000),
    evidenceRefs: z.array(evidenceRef).min(1).max(10),
    relevance: z.string().trim().min(1).max(500),
  })
  .strict();
