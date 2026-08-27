import { describe, expect, it, vi } from "vitest";

import type { StructuredLlmClient } from "../llm/client";
import {
  adaptQueryForProvider,
  buildCompanyExtractionMessages,
  enrichMissingCompanies,
  internationalizeJobKeywords,
} from "./discovery-enrichment";

const baseJob = {
  candidate: {
    externalId: "job-1",
    title: "Webエンジニア",
    description: "株式会社サンプルではWebサービスの開発者を募集しています。",
    url: "https://example.test/jobs/1",
  },
  sourceName: "Careerjet",
  sourceKind: "licensed_source" as const,
  fetchedAt: "2026-08-28T00:00:00.000Z",
};

describe("provider query localization", () => {
  it("translates common Japanese role terms for international providers", () => {
    expect(internationalizeJobKeywords("Web エンジニア")).toBe("web engineer");
    expect(internationalizeJobKeywords("TypeScript フロントエンド エンジニア")).toBe(
      "TypeScript frontend engineer",
    );
  });

  it("keeps Careerjet domestic query semantics unchanged", () => {
    const query = { keywords: "Web エンジニア", location: "東京" };
    expect(adaptQueryForProvider("Careerjet", query)).toEqual(query);
  });

  it("maps Japanese locations onto each remote provider's geography", () => {
    const query = { keywords: "Web エンジニア", location: "東京" };
    expect(adaptQueryForProvider("Himalayas", query)).toEqual({
      keywords: "web engineer",
      location: "Japan",
    });
    expect(adaptQueryForProvider("Jobicy", query)).toEqual({
      keywords: "web engineer",
      location: "apac",
    });
  });

  it("drops remote as a geographic restriction on remote-only providers", () => {
    const query = { keywords: "React エンジニア", location: "フルリモート" };
    expect(adaptQueryForProvider("Himalayas", query)).toEqual({
      keywords: "React engineer",
    });
    expect(adaptQueryForProvider("Jobicy", query)).toEqual({
      keywords: "React engineer",
    });
  });
});

describe("company-name enrichment", () => {
  it("frames provider text as data and asks for evidence-only extraction", () => {
    const messages = buildCompanyExtractionMessages([baseJob]);
    expect(messages[0]?.content).toContain("推測しない");
    expect(messages[1]?.content).toContain("株式会社サンプル");
  });

  it("fills a missing company from one structured batch response", async () => {
    const client: StructuredLlmClient = {
      generateStructured: vi.fn(async (input) => {
        const normalized = input.output.normalize({
          companies: [{ key: "0", company: "株式会社サンプル" }],
        } as never);
        return input.output.domainSchema.parse(normalized);
      }),
    };

    const enriched = await enrichMissingCompanies([baseJob], client);
    expect(enriched[0]?.candidate.company).toBe("株式会社サンプル");
    expect(client.generateStructured).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider name returned as the employer", async () => {
    const client: StructuredLlmClient = {
      generateStructured: vi.fn(async (input) => {
        const normalized = input.output.normalize({
          companies: [{ key: "0", company: "Careerjet" }],
        } as never);
        return input.output.domainSchema.parse(normalized);
      }),
    };

    const enriched = await enrichMissingCompanies([baseJob], client);
    expect(enriched[0]?.candidate.company).toBeUndefined();
  });
});
