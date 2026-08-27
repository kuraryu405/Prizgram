import { describe, expect, it } from "vitest";

import { createJobStructuredOutput, jobProviderOutputSchema } from "../src/llm";

const source = {
  kind: "user_provided" as const,
  name: "テスト出典",
  retrievedAt: "2026-08-26T00:00:00Z",
};

function providerPayload(
  overrides: Partial<Record<string, unknown>> = {},
): unknown {
  return {
    company: "株式会社サンプル",
    role: "フロントエンドエンジニア",
    employmentType: "internship",
    description: "ReactとTypeScriptでの開発を担当します。",
    requirements: [{ text: "TypeScriptの経験" }, { text: "Reactの経験" }],
    desiredSkills: [{ text: "Next.jsの経験" }],
    cultureValues: [],
    difficultyLevel: "competitive",
    difficultyEvidence: [
      { section: "requirements", index: 0 },
      { section: "requirements", index: 0 },
      { section: "desiredSkills", index: 5 },
    ],
    ...overrides,
  };
}

describe("createJobStructuredOutput", () => {
  it("assigns stable positional signal ids and injects the source", () => {
    const contract = createJobStructuredOutput(source);
    const provider = jobProviderOutputSchema.parse(providerPayload());
    const result = contract.domainSchema.safeParse(
      contract.normalize(provider),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    const snapshot = result.data;
    expect(snapshot.requirements).toEqual([
      { id: "job:req:1", text: "TypeScriptの経験" },
      { id: "job:req:2", text: "Reactの経験" },
    ]);
    expect(snapshot.desiredSkills).toEqual([
      { id: "job:skill:1", text: "Next.jsの経験" },
    ]);
    expect(snapshot.source).toEqual({
      kind: "user_provided",
      name: "テスト出典",
      retrievedAt: "2026-08-26T00:00:00Z",
    });
    // Same extraction twice must normalize identically (stable hash input).
    const second = contract.domainSchema.safeParse(
      contract.normalize(jobProviderOutputSchema.parse(providerPayload())),
    );
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(snapshot));
  });

  it("deduplicates evidence and drops out-of-range references", () => {
    const contract = createJobStructuredOutput(source);
    const provider = jobProviderOutputSchema.parse(providerPayload());
    const parsed = contract.domainSchema.safeParse(
      contract.normalize(provider),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    // index 0 appears twice -> single ref; desiredSkills index 5 is out of
    // range and must be dropped.
    expect(parsed.data.difficulty.evidenceRefs).toEqual(["job:req:1"]);
  });

  it("rejects extractions whose difficulty has no usable evidence left", () => {
    const contract = createJobStructuredOutput(source);
    const provider = jobProviderOutputSchema.parse(
      providerPayload({
        difficultyEvidence: [{ section: "requirements", index: 99 }],
      }),
    );
    const parsed = contract.domainSchema.safeParse(
      contract.normalize(provider),
    );
    expect(parsed.success).toBe(false);
  });

  it("can apply import-only fallbacks for omitted company and evidence", () => {
    const contract = createJobStructuredOutput(source, {
      fallbackCompany: "企業名非公開",
      ensureDifficultyEvidence: true,
    });
    const provider = jobProviderOutputSchema.parse(
      providerPayload({
        company: "",
        requirements: [],
        cultureValues: [],
        desiredSkills: [{ text: "AWSの実務経験" }],
        difficultyEvidence: [],
      }),
    );
    const parsed = contract.domainSchema.safeParse(
      contract.normalize(provider),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.company).toBe("企業名非公開");
    expect(parsed.data.difficulty.evidenceRefs).toEqual(["job:skill:1"]);
  });

  it("keeps identical texts in different sections as distinct signals", () => {
    const contract = createJobStructuredOutput(source);
    const provider = jobProviderOutputSchema.parse(
      providerPayload({
        cultureValues: [{ text: "TypeScriptの経験" }],
        difficultyEvidence: [
          { section: "cultureValues", index: 0 },
          { section: "requirements", index: 0 },
        ],
      }),
    );
    const parsed = contract.domainSchema.safeParse(
      contract.normalize(provider),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.cultureValues[0]?.id).toBe("job:value:1");
    expect(parsed.data.difficulty.evidenceRefs).toEqual([
      "job:value:1",
      "job:req:1",
    ]);
  });
});
