import { describe, expect, it } from "vitest";

import { personaStructuredOutput } from "../src/llm";

describe("provider output schemas", () => {
  it("accepts real calendar dates for experience bounds", () => {
    const result = personaStructuredOutput.providerSchema.safeParse({
      skills: [],
      strengths: [],
      weaknesses: [],
      values: [],
      preferences: { roles: [], industries: [], workStyles: [], locations: [] },
      experiences: [
        {
          title: "Engineer",
          description: "Built things",
          startedOn: "2024-02-29",
          endedOn: null,
          evidenceRefs: [],
        },
      ],
      evidence: [],
      confidence: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    for (const impossibleDate of ["2023-02-29", "2026-02-31", "2026-13-01"]) {
      const result = personaStructuredOutput.providerSchema.safeParse({
        skills: [],
        strengths: [],
        weaknesses: [],
        values: [],
        preferences: {
          roles: [],
          industries: [],
          workStyles: [],
          locations: [],
        },
        experiences: [
          {
            title: "Engineer",
            description: "Built things",
            startedOn: impossibleDate,
            endedOn: null,
            evidenceRefs: [],
          },
        ],
        evidence: [],
        confidence: 0.5,
      });
      expect(result.success).toBe(false);
    }
  });
});
