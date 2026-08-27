import { z } from "zod";

const trimmedString = (max: number) => z.string().trim().min(1).max(max);
const idSchema = z.string().trim().min(1).max(128);
export const evidenceIdListSchema = z.array(idSchema).min(1).max(100);
export const scoreReasonListSchema = z
  .array(trimmedString(1_000))
  .min(1)
  .max(20);

export const evidenceSourceTypes = [
  "user_input",
  "llm_inference",
  "application_event",
  "job_source",
] as const;

export const evidenceRefSchema = z
  .object({
    id: idSchema,
    sourceType: z.enum(evidenceSourceTypes),
    sourceId: idSchema.optional(),
    summary: trimmedString(1_000),
  })
  .strict();

export const skillLevels = [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
] as const;

export const skillSchema = z
  .object({
    name: trimmedString(120),
    level: z.enum(skillLevels),
    evidenceRefs: z.array(idSchema).max(50),
  })
  .strict();

export const experienceSchema = z
  .object({
    title: trimmedString(200),
    description: trimmedString(4_000),
    startedOn: z.iso.date().optional(),
    endedOn: z.iso.date().optional(),
    evidenceRefs: z.array(idSchema).max(50),
  })
  .strict()
  .refine(
    ({ endedOn, startedOn }) =>
      endedOn === undefined || startedOn === undefined || endedOn >= startedOn,
    { message: "endedOn must not be before startedOn", path: ["endedOn"] },
  );

export const personaPreferencesSchema = z
  .object({
    roles: z.array(trimmedString(120)).max(50),
    industries: z.array(trimmedString(120)).max(50),
    workStyles: z.array(trimmedString(120)).max(20),
    locations: z.array(trimmedString(120)).max(50),
  })
  .strict();

export const personaSnapshotSchema = z
  .object({
    skills: z.array(skillSchema).max(100),
    strengths: z.array(trimmedString(500)).max(50),
    weaknesses: z.array(trimmedString(500)).max(50),
    values: z.array(trimmedString(500)).max(50),
    preferences: personaPreferencesSchema,
    experiences: z.array(experienceSchema).max(100),
    evidence: z.array(evidenceRefSchema).max(500),
    confidence: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((persona, context) => {
    const evidenceIds = new Set<string>();
    for (const [index, evidence] of persona.evidence.entries()) {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: "custom",
          message: "evidence ids must be unique",
          path: ["evidence", index, "id"],
        });
      }
      evidenceIds.add(evidence.id);
    }

    const references = [
      ...persona.skills.flatMap((skill, index) =>
        skill.evidenceRefs.map((reference, referenceIndex) => ({
          reference,
          path: ["skills", index, "evidenceRefs", referenceIndex],
        })),
      ),
      ...persona.experiences.flatMap((experience, index) =>
        experience.evidenceRefs.map((reference, referenceIndex) => ({
          reference,
          path: ["experiences", index, "evidenceRefs", referenceIndex],
        })),
      ),
    ];
    for (const { path, reference } of references) {
      if (!evidenceIds.has(reference)) {
        context.addIssue({
          code: "custom",
          message: "evidence reference does not exist",
          path,
        });
      }
    }
  });

export const jobDifficultyLevels = [
  "entry",
  "developing",
  "competitive",
  "highly_competitive",
] as const;
export const employmentTypes = [
  "internship",
  "full_time",
  "part_time",
  "contract",
] as const;

export const jobSignalSchema = z
  .object({
    id: idSchema,
    text: trimmedString(1_000),
  })
  .strict();

export const jobSnapshotSchema = z
  .object({
    company: trimmedString(200),
    role: trimmedString(200),
    employmentType: z.enum(employmentTypes),
    description: trimmedString(20_000),
    requirements: z.array(jobSignalSchema).max(100),
    desiredSkills: z.array(jobSignalSchema).max(100),
    cultureValues: z.array(jobSignalSchema).max(50),
    difficulty: z
      .object({
        level: z.enum(jobDifficultyLevels),
        evidenceRefs: z.array(idSchema).min(1).max(100),
      })
      .strict(),
    source: z
      .object({
        kind: z.enum(["user_provided", "official_api", "licensed_source"]),
        name: trimmedString(200),
        externalId: trimmedString(300).optional(),
        url: z.url().max(2_048).optional(),
        retrievedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict()
  .superRefine((job, context) => {
    const signalIds = new Set<string>();
    const signalGroups = [
      { field: "requirements", signals: job.requirements },
      { field: "desiredSkills", signals: job.desiredSkills },
      { field: "cultureValues", signals: job.cultureValues },
    ] as const;
    for (const { field, signals } of signalGroups) {
      for (const [index, signal] of signals.entries()) {
        if (signalIds.has(signal.id)) {
          context.addIssue({
            code: "custom",
            message: "job signal ids must be unique",
            path: [field, index],
          });
        }
        signalIds.add(signal.id);
      }
    }
    for (const [index, reference] of job.difficulty.evidenceRefs.entries()) {
      if (!signalIds.has(reference)) {
        context.addIssue({
          code: "custom",
          message: "difficulty evidence reference does not exist",
          path: ["difficulty", "evidenceRefs", index],
        });
      }
    }
  });

export const scoreDimensionSchema = z
  .object({
    score: z.number().int().finite().min(0).max(100),
    reasons: scoreReasonListSchema,
    evidenceRefs: evidenceIdListSchema,
  })
  .strict();

export const scoringOutputSchema = z
  .object({
    skillFit: scoreDimensionSchema,
    cultureValueFit: scoreDimensionSchema,
    // Zero means no material gap; 100 means a prohibitive readiness gap.
    difficultyGap: scoreDimensionSchema,
  })
  .strict();

export const personaLlmOutputSchema = personaSnapshotSchema;

export function createScoringLlmOutputSchema(
  allowedEvidenceRefs: ReadonlySet<string>,
) {
  return scoringOutputSchema.superRefine((output, context) => {
    for (const [axis, dimension] of Object.entries(output)) {
      for (const [index, reference] of dimension.evidenceRefs.entries()) {
        if (!allowedEvidenceRefs.has(reference)) {
          context.addIssue({
            code: "custom",
            message: "score evidence reference is not present in its inputs",
            path: [axis, "evidenceRefs", index],
          });
        }
      }
    }
  });
}

export const generationProvenanceSchema = z
  .object({
    source: z.enum(["user_input", "llm", "system"]),
    sourceIds: z.array(idSchema).max(500),
    generatedAt: z.iso.datetime({ offset: true }),
    model: trimmedString(200).optional(),
    promptVersion: trimmedString(100).optional(),
  })
  .strict();

export const applicationStatuses = [
  "saved",
  "applying",
  "submitted",
  "screening",
  "interview",
  "offer",
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export const terminalApplicationStatuses = [
  "accepted",
  "rejected",
  "withdrawn",
] as const;

export type TerminalApplicationStatus =
  (typeof terminalApplicationStatuses)[number];

/**
 * Allowed forward transitions between selection statuses. Terminal statuses
 * permit nothing further; `withdrawn` is reachable while still actionable,
 * `rejected` closes the funnel from any active stage.
 */
export const applicationTransitions: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  saved: ["applying", "withdrawn"],
  applying: ["submitted", "withdrawn"],
  submitted: ["screening", "rejected", "withdrawn"],
  screening: ["interview", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["accepted", "rejected", "withdrawn"],
  accepted: [],
  rejected: [],
  withdrawn: [],
};

export function canTransitionApplication(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return from !== to && applicationTransitions[from].includes(to);
}

export const applicationStatusSchema = z.enum(applicationStatuses);
export const deadlineKinds = [
  "application",
  "document",
  "interview",
  "offer_response",
  "other",
] as const;
export const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (timezone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "timezone must be a valid IANA time zone" },
  );
export const applicationDeadlineInputSchema = z
  .object({
    kind: z.enum(deadlineKinds),
    title: trimmedString(300),
    dueAt: z.iso.datetime({ offset: true }),
    timezone: ianaTimezoneSchema,
  })
  .strict();
export const reminderStatuses = [
  "pending",
  "sent",
  "dismissed",
  "failed",
] as const;
export const reminderPriorities = ["low", "medium", "high", "urgent"] as const;

export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type PersonaSnapshot = z.infer<typeof personaSnapshotSchema>;
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>;
export type ScoreDimension = z.infer<typeof scoreDimensionSchema>;
export type ScoringOutput = z.infer<typeof scoringOutputSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type GenerationProvenance = z.infer<typeof generationProvenanceSchema>;
export type ApplicationDeadlineInput = z.infer<
  typeof applicationDeadlineInputSchema
>;
