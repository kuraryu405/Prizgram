import { z } from "zod";

import {
  createScoringLlmOutputSchema,
  evidenceSourceTypes,
  skillLevels,
  type PersonaSnapshot,
  type ScoringOutput,
  personaSnapshotSchema,
} from "./domain";

export type StructuredOutputContract<ProviderOutput, DomainOutput> = Readonly<{
  providerSchema: z.ZodType<ProviderOutput>;
  domainSchema: z.ZodType<DomainOutput>;
  normalize: (value: ProviderOutput) => unknown;
}>;

const providerString = z.string();
const providerId = z.string();
const providerDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const personaProviderOutputSchema = z
  .object({
    skills: z.array(
      z
        .object({
          name: providerString,
          level: z.enum(skillLevels),
          evidenceRefs: z.array(providerId),
        })
        .strict(),
    ),
    strengths: z.array(providerString),
    weaknesses: z.array(providerString),
    values: z.array(providerString),
    preferences: z
      .object({
        roles: z.array(providerString),
        industries: z.array(providerString),
        workStyles: z.array(providerString),
        locations: z.array(providerString),
      })
      .strict(),
    experiences: z.array(
      z
        .object({
          title: providerString,
          description: providerString,
          startedOn: providerDate.nullable(),
          endedOn: providerDate.nullable(),
          evidenceRefs: z.array(providerId),
        })
        .strict(),
    ),
    evidence: z.array(
      z
        .object({
          id: providerId,
          sourceType: z.enum(evidenceSourceTypes),
          sourceId: providerId.nullable(),
          summary: providerString,
        })
        .strict(),
    ),
    confidence: z.number().min(0).max(1),
  })
  .strict();

type PersonaProviderOutput = z.infer<typeof personaProviderOutputSchema>;

function normalizePersona(value: PersonaProviderOutput): unknown {
  return {
    ...value,
    experiences: value.experiences.map(
      ({ endedOn, startedOn, ...experience }) => ({
        ...experience,
        ...(startedOn === null ? {} : { startedOn }),
        ...(endedOn === null ? {} : { endedOn }),
      }),
    ),
    evidence: value.evidence.map(({ sourceId, ...evidence }) => ({
      ...evidence,
      ...(sourceId === null ? {} : { sourceId }),
    })),
  };
}

export const personaStructuredOutput: StructuredOutputContract<
  PersonaProviderOutput,
  PersonaSnapshot
> = {
  providerSchema: personaProviderOutputSchema,
  domainSchema: personaSnapshotSchema,
  normalize: normalizePersona,
};

const providerScoreDimensionSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    reasons: z.array(providerString).min(1).max(20),
    evidenceRefs: z.array(providerId).min(1).max(100),
  })
  .strict();

export const scoringProviderOutputSchema = z
  .object({
    skillFit: providerScoreDimensionSchema,
    cultureValueFit: providerScoreDimensionSchema,
    difficultyGap: providerScoreDimensionSchema,
  })
  .strict();

export function createScoringStructuredOutput(
  allowedEvidenceRefs: ReadonlySet<string>,
): StructuredOutputContract<ScoringOutput, ScoringOutput> {
  return {
    providerSchema: scoringProviderOutputSchema,
    domainSchema: createScoringLlmOutputSchema(allowedEvidenceRefs),
    normalize: (value) => value,
  };
}
