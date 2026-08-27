import "server-only";

import { z } from "zod";

const evidenceRef = z.string().trim().min(1).max(128);
const providerText = z.string();
const providerOptionalText = z.string().nullable();

const expectedQuestionProviderSchema = z
  .object({
    question: providerText,
    intent: providerText,
    basis: providerText,
    materialRefs: z.array(providerText),
  })
  .strict();

export const expectedQuestionsProviderSchema = z
  .object({
    questions: z.array(expectedQuestionProviderSchema),
    insufficientContext: z.boolean(),
  })
  .strict();

export const expectedQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    intent: z.string().trim().min(1).max(500),
    basis: z.string().trim().min(1).max(500),
    materialRefs: z.array(evidenceRef).max(10),
  })
  .strict();

export const expectedQuestionsDomainSchema = z
  .object({
    questions: z.array(expectedQuestionSchema).min(1).max(10),
    insufficientContext: z.boolean(),
  })
  .strict();

const answerOutlineProviderFields = {
  situation: providerOptionalText,
  task: providerOptionalText,
  action: providerOptionalText,
  result: providerOptionalText,
  points: z.array(providerText),
};

export const answerOutlineProviderSchema = z
  .object({
    outline: z.object(answerOutlineProviderFields).strict(),
    evidenceRefs: z.array(providerText),
    warnings: z.array(providerText),
    insufficientContext: z.boolean(),
  })
  .strict();

export const answerOutlineDomainSchema = z
  .object({
    outline: z
      .object({
        situation: z.string().trim().min(1).max(1_000).optional(),
        task: z.string().trim().min(1).max(1_000).optional(),
        action: z.string().trim().min(1).max(2_000).optional(),
        result: z.string().trim().min(1).max(2_000).optional(),
        points: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
      })
      .strict(),
    evidenceRefs: z.array(evidenceRef).max(20),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
    insufficientContext: z.boolean(),
  })
  .strict();

export const followupProviderSchema = z
  .object({
    questions: z.array(providerText),
  })
  .strict();

export const followupDomainSchema = z
  .object({
    questions: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  })
  .strict();

export function normalizeExpectedQuestions(
  value: z.infer<typeof expectedQuestionsProviderSchema>,
): z.infer<typeof expectedQuestionsDomainSchema> {
  return value;
}

export function normalizeAnswerOutline(
  value: z.infer<typeof answerOutlineProviderSchema>,
): z.infer<typeof answerOutlineDomainSchema> {
  const { outline, ...rest } = value;
  return {
    ...rest,
    outline: {
      points: outline.points,
      ...(outline.situation === null ? {} : { situation: outline.situation }),
      ...(outline.task === null ? {} : { task: outline.task }),
      ...(outline.action === null ? {} : { action: outline.action }),
      ...(outline.result === null ? {} : { result: outline.result }),
    },
  };
}

export function normalizeFollowup(
  value: z.infer<typeof followupProviderSchema>,
): z.infer<typeof followupDomainSchema> {
  return value;
}

export const materialCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1_000),
    evidenceRefs: z.array(evidenceRef).min(1).max(10),
    relevance: z.string().trim().min(1).max(500),
  })
  .strict();
