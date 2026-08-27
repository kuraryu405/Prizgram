import "server-only";

import { z } from "zod";

const evidenceRef = z.string().trim().min(1).max(128);
const providerText = z.string();
const providerOptionalText = z.string().nullable();

// OpenAI strict JSON Schema requires every object field to be required and
// does not support string min/max constraints. Keep the provider contract
// deliberately permissive, then validate the normalized domain response.
const episodeCandidateProviderSchema = z
  .object({
    title: providerText,
    summary: providerText,
    evidenceRefs: z.array(providerText),
    sourceExperienceTitle: providerOptionalText,
    relevance: providerText,
  })
  .strict();

export const episodeCandidatesProviderSchema = z
  .object({
    candidates: z.array(episodeCandidateProviderSchema),
    insufficientContext: z.boolean(),
  })
  .strict();

export const episodeCandidateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1_000),
    evidenceRefs: z.array(evidenceRef).min(1).max(10),
    sourceExperienceTitle: z.string().trim().min(1).max(200).optional(),
    relevance: z.string().trim().min(1).max(500),
  })
  .strict();

export const episodeCandidatesDomainSchema = z
  .object({
    candidates: z.array(episodeCandidateSchema).max(6),
    insufficientContext: z.boolean(),
  })
  .strict();

export type EpisodeCandidatesProviderOutput = z.infer<
  typeof episodeCandidatesProviderSchema
>;
export type EpisodeCandidate = z.infer<typeof episodeCandidateSchema>;

export function normalizeEpisodeCandidates(
  value: EpisodeCandidatesProviderOutput,
): z.infer<typeof episodeCandidatesDomainSchema> {
  return {
    ...value,
    candidates: value.candidates.map(
      ({ sourceExperienceTitle, ...candidate }) => ({
        ...candidate,
        ...(sourceExperienceTitle === null ? {} : { sourceExperienceTitle }),
      }),
    ),
  };
}

export const esDraftProviderSchema = z
  .object({
    answer: providerText,
    evidenceRefs: z.array(providerText),
    warnings: z.array(providerText),
    insufficientContext: z.boolean(),
  })
  .strict();

export const esDraftDomainSchema = z
  .object({
    answer: z.string().trim().min(1).max(20_000),
    evidenceRefs: z.array(evidenceRef).min(1).max(20),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
    insufficientContext: z.boolean(),
  })
  .strict();

export type EsDraftProviderOutput = z.infer<typeof esDraftProviderSchema>;

const revisionFeedbackItemProviderSchema = z
  .object({
    category: z.enum([
      "relevance",
      "conciseness",
      "specificity",
      "job_connection",
      "length",
      "factual_consistency",
      "other",
    ]),
    comment: providerText,
    suggestion: providerOptionalText,
  })
  .strict();

const revisionFeedbackItemSchema = z
  .object({
    category: z.enum([
      "relevance",
      "conciseness",
      "specificity",
      "job_connection",
      "length",
      "factual_consistency",
      "other",
    ]),
    comment: z.string().trim().min(1).max(1_000),
    suggestion: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const esRevisionProviderSchema = z
  .object({
    revisedAnswer: providerText,
    feedback: z.array(revisionFeedbackItemProviderSchema),
    warnings: z.array(providerText),
  })
  .strict();

export const esRevisionDomainSchema = z
  .object({
    revisedAnswer: z.string().trim().min(1).max(20_000),
    feedback: z.array(revisionFeedbackItemSchema).min(1).max(10),
    warnings: z.array(z.string().trim().min(1).max(500)).max(10),
  })
  .strict();

export type EsRevisionProviderOutput = z.infer<typeof esRevisionProviderSchema>;

export function normalizeEsDraft(
  value: EsDraftProviderOutput,
): z.infer<typeof esDraftDomainSchema> {
  return value;
}

export function normalizeEsRevision(
  value: EsRevisionProviderOutput,
): z.infer<typeof esRevisionDomainSchema> {
  return {
    ...value,
    feedback: value.feedback.map(({ suggestion, ...feedback }) => ({
      ...feedback,
      ...(suggestion === null ? {} : { suggestion }),
    })),
  };
}
