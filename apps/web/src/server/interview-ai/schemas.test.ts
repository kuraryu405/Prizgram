import { describe, expect, it } from "vitest";

import { toOpenAiStrictJsonSchema } from "../llm/client";
import {
  answerOutlineDomainSchema,
  answerOutlineProviderSchema,
  expectedQuestionsDomainSchema,
  expectedQuestionsProviderSchema,
  followupDomainSchema,
  followupProviderSchema,
  normalizeAnswerOutline,
  normalizeExpectedQuestions,
  normalizeFollowup,
} from "./schemas";

describe("interview AI provider-to-domain contracts", () => {
  it("uses OpenAI-compatible cardinality constraints for every provider schema", () => {
    for (const schema of [
      expectedQuestionsProviderSchema,
      answerOutlineProviderSchema,
      followupProviderSchema,
    ]) {
      expect(() => toOpenAiStrictJsonSchema(schema)).not.toThrow();
    }

    const followupJsonSchema = toOpenAiStrictJsonSchema(followupProviderSchema);
    expect(followupJsonSchema).toMatchObject({
      properties: { questions: { minItems: 1, maxItems: 10 } },
    });
  });

  it("normalizes benign text drift before validating expected questions", () => {
    const provider = expectedQuestionsProviderSchema.parse({
      questions: [
        {
          question: "  取り組みで工夫したことは？  ",
          intent: "  再現性の確認  ",
          basis: "  ESのチーム開発経験  ",
          materialRefs: [" ev:web ", "   "],
        },
        {
          question: " ",
          intent: "意図",
          basis: "根拠",
          materialRefs: [],
        },
      ],
      insufficientContext: false,
    });

    expect(
      expectedQuestionsDomainSchema.parse(normalizeExpectedQuestions(provider)),
    ).toEqual({
      questions: [
        {
          question: "取り組みで工夫したことは？",
          intent: "再現性の確認",
          basis: "ESのチーム開発経験",
          materialRefs: ["ev:web"],
        },
      ],
      insufficientContext: false,
    });
  });

  it("normalizes whitespace and caps outline/followup text before domain validation", () => {
    const outline = answerOutlineProviderSchema.parse({
      outline: {
        situation: "  状況  ",
        task: null,
        action: "  行動  ",
        result: " ",
        points: ["  要点  ", "   "],
      },
      evidenceRefs: [" ev:web ", " "],
      warnings: ["  注意  ", " "],
      insufficientContext: false,
    });
    expect(
      answerOutlineDomainSchema.parse(normalizeAnswerOutline(outline)),
    ).toEqual({
      outline: { situation: "状況", action: "行動", points: ["要点"] },
      evidenceRefs: ["ev:web"],
      warnings: ["注意"],
      insufficientContext: false,
    });

    const followup = followupProviderSchema.parse({
      questions: ["  深掘り質問  ", " ", "x".repeat(600)],
    });
    const normalizedFollowup = followupDomainSchema.parse(
      normalizeFollowup(followup),
    );
    expect(normalizedFollowup.questions).toEqual([
      "深掘り質問",
      "x".repeat(500),
    ]);
  });
});
