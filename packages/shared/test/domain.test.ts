import { describe, expect, it } from "vitest";

import {
  applicationDeadlineInputSchema,
  createScoringLlmOutputSchema,
  decodeJsonColumn,
  encodeJsonColumn,
  jobSnapshotSchema,
  JsonColumnValidationError,
  personaSnapshotSchema,
  scoringOutputSchema,
} from "../src";

const validPersona = {
  skills: [{ name: "TypeScript", level: "advanced", evidenceRefs: ["e1"] }],
  strengths: ["曖昧な課題を分解できる"],
  weaknesses: ["大人数での発表経験が少ない"],
  values: ["利用者への透明性"],
  preferences: {
    roles: ["Software Engineer"],
    industries: [],
    workStyles: ["team"],
    locations: ["Tokyo"],
  },
  experiences: [],
  evidence: [
    { id: "e1", sourceType: "user_input", summary: "授業でWebアプリを開発" },
  ],
  confidence: 0.8,
} as const;

const validScoring = {
  skillFit: { score: 80, reasons: ["主要要件を満たす"], evidenceRefs: ["e1"] },
  cultureValueFit: {
    score: 70,
    reasons: ["透明性を重視"],
    evidenceRefs: ["e2"],
  },
  difficultyGap: { score: 25, reasons: ["実務経験の差"], evidenceRefs: ["e3"] },
};

describe("domain schemas", () => {
  it("accepts a structured persona", () => {
    expect(personaSnapshotSchema.parse(validPersona)).toEqual(validPersona);
  });

  it("rejects unknown persona keys and non-finite confidence", () => {
    expect(
      personaSnapshotSchema.safeParse({ ...validPersona, ignored: true })
        .success,
    ).toBe(false);
    expect(
      personaSnapshotSchema.safeParse({
        ...validPersona,
        confidence: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      personaSnapshotSchema.safeParse({
        ...validPersona,
        skills: [
          { name: "TypeScript", level: "advanced", evidenceRefs: ["missing"] },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires all three score axes, bounded scores, reasons, and evidence", () => {
    expect(scoringOutputSchema.parse(validScoring)).toEqual(validScoring);
    expect(
      scoringOutputSchema.safeParse({
        ...validScoring,
        difficultyGap: { ...validScoring.difficultyGap, score: 101 },
      }).success,
    ).toBe(false);
    expect(
      scoringOutputSchema.safeParse({
        ...validScoring,
        skillFit: { score: 80, reasons: [], evidenceRefs: ["e1"] },
      }).success,
    ).toBe(false);
    expect(
      scoringOutputSchema.safeParse({
        ...validScoring,
        cultureValueFit: { score: 70, reasons: ["x"], evidenceRefs: [] },
      }).success,
    ).toBe(false);
    expect(
      scoringOutputSchema.safeParse({ ...validScoring, overall: 75 }).success,
    ).toBe(false);

    const contextualSchema = createScoringLlmOutputSchema(
      new Set(["e1", "e2", "e3"]),
    );
    expect(contextualSchema.safeParse(validScoring).success).toBe(true);
    expect(
      createScoringLlmOutputSchema(new Set(["e1"])).safeParse(validScoring)
        .success,
    ).toBe(false);

    const axisAwareSchema = createScoringLlmOutputSchema({
      skillFit: new Set(["e1"]),
      cultureValueFit: new Set(["e2"]),
      difficultyGap: new Set(["e3"]),
    });
    expect(axisAwareSchema.safeParse(validScoring).success).toBe(true);
    expect(
      axisAwareSchema.safeParse({
        ...validScoring,
        skillFit: { ...validScoring.skillFit, evidenceRefs: ["e2"] },
      }).success,
    ).toBe(false);
  });

  it("provides stable job evidence ids and validates deadline time zones", () => {
    const job = {
      company: "Example",
      role: "Engineer",
      employmentType: "internship",
      description: "Product engineering internship",
      requirements: [{ id: "job:req:1", text: "TypeScript" }],
      desiredSkills: [],
      cultureValues: [{ id: "job:value:1", text: "Transparency" }],
      difficulty: { level: "competitive", evidenceRefs: ["job:req:1"] },
      source: {
        kind: "user_provided",
        name: "User",
        retrievedAt: "2026-08-25T00:00:00Z",
      },
    } as const;
    expect(jobSnapshotSchema.safeParse(job).success).toBe(true);
    expect(
      jobSnapshotSchema.safeParse({
        ...job,
        difficulty: { level: "competitive", evidenceRefs: ["missing"] },
      }).success,
    ).toBe(false);

    expect(
      applicationDeadlineInputSchema.safeParse({
        kind: "interview",
        title: "一次面接",
        dueAt: "2026-09-01T10:00:00+09:00",
        timezone: "Asia/Tokyo",
      }).success,
    ).toBe(true);
    expect(
      applicationDeadlineInputSchema.safeParse({
        kind: "interview",
        title: "一次面接",
        dueAt: "2026-09-01T10:00:00+09:00",
        timezone: "Invalid/Zone",
      }).success,
    ).toBe(false);
  });

  it("reports duplicate job signal ids against their own signal group", () => {
    const job = {
      company: "Example",
      role: "Engineer",
      employmentType: "internship",
      description: "Product engineering internship",
      requirements: [
        { id: "job:req:1", text: "TypeScript" },
        { id: "job:req:2", text: "Testing" },
      ],
      desiredSkills: [{ id: "job:req:2", text: "Testing" }],
      cultureValues: [],
      difficulty: { level: "competitive", evidenceRefs: ["job:req:1"] },
      source: {
        kind: "user_provided",
        name: "User",
        retrievedAt: "2026-08-25T00:00:00Z",
      },
    } as const;

    const result = jobSnapshotSchema.safeParse(job);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        ({ message }) => message === "job signal ids must be unique",
      );
      expect(issue?.path).toEqual(["desiredSkills", 0]);
    }

    const inFieldDuplicate = jobSnapshotSchema.safeParse({
      ...job,
      requirements: [
        { id: "job:req:1", text: "TypeScript" },
        { id: "job:req:1", text: "TypeScript again" },
      ],
      desiredSkills: [],
    });
    expect(inFieldDuplicate.success).toBe(false);
    if (!inFieldDuplicate.success) {
      const issue = inFieldDuplicate.error.issues.find(
        ({ message }) => message === "job signal ids must be unique",
      );
      expect(issue?.path).toEqual(["requirements", 1]);
    }
  });
});

describe("JSON column codec", () => {
  it("validates on write and read", () => {
    const encoded = encodeJsonColumn(
      "persona_versions.snapshot",
      personaSnapshotSchema,
      validPersona,
    );
    expect(
      decodeJsonColumn(
        "persona_versions.snapshot",
        personaSnapshotSchema,
        encoded,
      ),
    ).toEqual(validPersona);
  });

  it("does not expose malformed stored data as a domain object", () => {
    expect(() =>
      decodeJsonColumn(
        "persona_versions.snapshot",
        personaSnapshotSchema,
        "not-json",
      ),
    ).toThrow(JsonColumnValidationError);
    expect(() =>
      encodeJsonColumn("persona_versions.snapshot", personaSnapshotSchema, {}),
    ).toThrow(JsonColumnValidationError);
  });
});
