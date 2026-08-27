import { z } from "zod";

import {
  createScoringLlmOutputSchema,
  evidenceSourceTypes,
  employmentTypes,
  jobDifficultyLevels,
  jobSnapshotSchema,
  skillLevels,
  type ScoringEvidenceAllowList,
  type JobSnapshot,
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
const providerDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });

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
  allowedEvidenceRefs: ScoringEvidenceAllowList,
): StructuredOutputContract<ScoringOutput, ScoringOutput> {
  return {
    providerSchema: scoringProviderOutputSchema,
    domainSchema: createScoringLlmOutputSchema(allowedEvidenceRefs),
    normalize: (value) => value,
  };
}

const providerJobSignal = z.object({ text: providerString }).strict();

export const jobProviderOutputSchema = z
  .object({
    company: providerString,
    role: providerString,
    employmentType: z.enum(employmentTypes),
    description: providerString,
    requirements: z.array(providerJobSignal).max(100),
    desiredSkills: z.array(providerJobSignal).max(100),
    cultureValues: z.array(providerJobSignal).max(50),
    difficultyLevel: z.enum(jobDifficultyLevels),
    // The provider references source signals by section and position;
    // the server assigns stable positional ids so identical extractions
    // keep identical content hashes.
    difficultyEvidence: z
      .array(
        z
          .object({
            section: z.enum(["requirements", "desiredSkills", "cultureValues"]),
            index: z.number().int().min(0),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

type JobProviderOutput = z.infer<typeof jobProviderOutputSchema>;
type JobSignalSection =
  JobProviderOutput["difficultyEvidence"][number]["section"];

/**
 * Builds a structured-output contract for user-provided job postings.
 * Signal ids are assigned deterministically from list positions so that
 * identical extractions produce identical content hashes, and difficulty
 * evidence positions are resolved to those ids. Unknown references are
 * dropped; the domain schema's min(1) then rejects extractions without any
 * usable evidence instead of persisting an unverifiable snapshot.
 */
export function createJobStructuredOutput(source: {
  kind: JobSnapshot["source"]["kind"];
  name: string;
  externalId?: string;
  url?: string;
  retrievedAt: string;
}): StructuredOutputContract<JobProviderOutput, JobSnapshot> {
  const prefixes: Readonly<Record<JobSignalSection, string>> = {
    cultureValues: "job:value:",
    desiredSkills: "job:skill:",
    requirements: "job:req:",
  };

  return {
    providerSchema: jobProviderOutputSchema,
    domainSchema: jobSnapshotSchema,
    normalize: (value) => {
      const sections: Readonly<
        Record<JobSignalSection, Array<{ id: string; text: string }>>
      > = {
        cultureValues: value.cultureValues.map((signal, index) => ({
          id: `${prefixes.cultureValues}${index + 1}`,
          text: signal.text,
        })),
        desiredSkills: value.desiredSkills.map((signal, index) => ({
          id: `${prefixes.desiredSkills}${index + 1}`,
          text: signal.text,
        })),
        requirements: value.requirements.map((signal, index) => ({
          id: `${prefixes.requirements}${index + 1}`,
          text: signal.text,
        })),
      };
      const requirements = sections.requirements;
      const desiredSkills = sections.desiredSkills;
      const cultureValues = sections.cultureValues;

      const signalIds = new Set(
        [...requirements, ...desiredSkills, ...cultureValues].map(
          ({ id }) => id,
        ),
      );
      const evidenceRefs: string[] = [];
      const seen = new Set<string>();
      for (const evidence of value.difficultyEvidence) {
        const id = sections[evidence.section][evidence.index]?.id;
        if (id === undefined || seen.has(id) || !signalIds.has(id)) continue;
        seen.add(id);
        evidenceRefs.push(id);
      }

      return {
        company: value.company,
        role: value.role,
        employmentType: value.employmentType,
        description: value.description,
        requirements,
        desiredSkills,
        cultureValues,
        difficulty: { level: value.difficultyLevel, evidenceRefs },
        source: { ...source },
      };
    },
  };
}
