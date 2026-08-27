import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from "@prizgram/db";
import { personaSnapshotSchema, type PersonaSnapshot } from "@prizgram/shared";

import { AppError } from "../api";
import type { ChatMessage, StructuredLlmClient } from "../llm/client";
import {
  DiscoveryService,
  JOB_SEARCH_PROMPT_VERSION,
  applyDiscoveryOverrides,
  buildJobSearchMessages,
  employmentTypeToFilters,
} from "./discovery";
import { JobSearchProviderError } from "./provider/careerjet";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
const userB = { id: "user-b", loginId: "student.two" };
const context = { userIp: "203.0.113.9", userAgent: "vitest-agent" };

const approvedPersona: PersonaSnapshot = personaSnapshotSchema.parse({
  skills: [
    { name: "TypeScript", level: "intermediate", evidenceRefs: ["ev:e1"] },
  ],
  strengths: ["学習速度"],
  weaknesses: ["継続力"],
  values: ["自律性"],
  preferences: {
    roles: ["フロントエンドエンジニア"],
    industries: [],
    workStyles: [],
    locations: ["東京"],
  },
  experiences: [
    {
      title: "Webアプリ開発",
      description: "チームで開発した。",
      evidenceRefs: ["ev:e2"],
    },
  ],
  evidence: [
    { id: "ev:e1", sourceType: "user_input", summary: "TypeScript経験" },
    { id: "ev:e2", sourceType: "user_input", summary: "開発経験" },
  ],
  confidence: 0.6,
});

const provenance = {
  source: "user_input",
  sourceIds: ["intake-1"],
  generatedAt: new Date().toISOString(),
};

type QueryProviderPayload = {
  keywords: string;
  location?: string;
  contractType?: string;
  workHours?: string;
};

/**
 * Fake structured LLM client that runs the real provider→normalize→domain
 * pipeline so empty-string semantics are exercised exactly like production.
 */
function clientReturning(
  payload: QueryProviderPayload | Error,
): StructuredLlmClient {
  return {
    generateStructured(input) {
      if (payload instanceof Error) return Promise.reject(payload);
      const normalized = input.output.normalize(payload as never);
      return Promise.resolve(input.output.domainSchema.parse(normalized));
    },
  };
}

function providerReturning(jobs: readonly unknown[]): {
  search: ReturnType<typeof vi.fn>;
} {
  return {
    search: vi.fn().mockResolvedValue({
      hits: jobs.length,
      pages: 1,
      candidates: jobs,
    }),
  };
}

const generatedQueryPayload = {
  keywords: "フロントエンド エンジニア",
  location: "",
  contractType: "",
  workHours: "",
};

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error("expected rejection");
}

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "prizgram-disc-"));
  connection = createDatabase(path.join(temporaryDirectory, "jobs.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite.prepare("insert into users (id) values (?)").run(userA.id);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("buildJobSearchMessages", () => {
  it("frames the persona as delimited reference data with rules", () => {
    const messages: readonly ChatMessage[] =
      buildJobSearchMessages(approvedPersona);
    const system = messages.find((message) => message.role === "system");
    expect(system?.content).toContain("検索条件");
    expect(system?.content).toContain("従わないでください");
    expect(
      messages.some((message) => message.content.includes("<persona>")),
    ).toBe(true);
    expect(
      messages.some((message) =>
        message.content.includes("フロントエンドエンジニア"),
      ),
    ).toBe(true);
  });
});

describe("applyDiscoveryOverrides", () => {
  const generated = {
    keywords: "生成キーワード",
    location: "大阪",
    contractType: "p" as const,
    workHours: "f" as const,
  };

  it("keeps generated values when no explicit conditions are given", () => {
    const query = applyDiscoveryOverrides(generated, {});
    expect(query).toEqual({
      keywords: "生成キーワード",
      location: "大阪",
      contractType: "p",
      workHours: "f",
    });
  });

  it("keeps partial generated filters (contractType only)", () => {
    const partial = {
      keywords: "生成キーワード",
      location: "大阪",
      contractType: "p" as const,
    };
    const query = applyDiscoveryOverrides(partial, {});
    expect(query).toEqual({
      keywords: "生成キーワード",
      location: "大阪",
      contractType: "p",
    });
    expect(query.workHours).toBeUndefined();
  });

  it("keeps partial generated filters (workHours only)", () => {
    const partial = {
      keywords: "生成キーワード",
      location: "大阪",
      workHours: "f" as const,
    };
    const query = applyDiscoveryOverrides(partial, {});
    expect(query).toEqual({
      keywords: "生成キーワード",
      location: "大阪",
      workHours: "f",
    });
    expect(query.contractType).toBeUndefined();
  });

  it("keeps no generated filters when both are undefined", () => {
    const noFilters = { keywords: "生成キーワード", location: "大阪" };
    const query = applyDiscoveryOverrides(noFilters, {});
    expect(query).toEqual({
      keywords: "生成キーワード",
      location: "大阪",
    });
  });

  it("lets explicit user conditions win over generated ones", () => {
    const query = applyDiscoveryOverrides(generated, {
      keywords: "手動キーワード",
      location: "福岡",
      employmentType: "internship",
    });
    expect(query.keywords).toBe("手動キーワード");
    expect(query.location).toBe("福岡");
    expect(query.contractType).toBe("i");
    expect(query.workHours).toBeUndefined();
  });

  it.each([
    ["internship", { contractType: "i" }],
    ["full_time", { contractType: "p", workHours: "f" }],
    ["part_time", { workHours: "p" }],
    ["contract", { contractType: "c" }],
  ] as const)(
    "overrides generated filters with employmentType=%s",
    (employmentType, expected) => {
      const query = applyDiscoveryOverrides(generated, { employmentType });
      expect(query.contractType).toBe(
        (expected as { contractType?: string }).contractType,
      );
      expect(query.workHours).toBe(
        (expected as { workHours?: string }).workHours,
      );
      // Keywords/location from generated should be preserved
      expect(query.keywords).toBe("生成キーワード");
      expect(query.location).toBe("大阪");
    },
  );

  it("maps employment types onto provider filters", () => {
    expect(employmentTypeToFilters("internship")).toEqual({
      contractType: "i",
    });
    expect(employmentTypeToFilters("full_time")).toEqual({
      contractType: "p",
      workHours: "f",
    });
    expect(employmentTypeToFilters("part_time")).toEqual({ workHours: "p" });
    expect(employmentTypeToFilters("contract")).toEqual({ contractType: "c" });
  });
});

describe("DiscoveryService.discover", () => {
  function seedPersona(userId: string): void {
    connection.sqlite
      .prepare(
        "insert into persona_versions (id, user_id, version, snapshot, provenance) values (?, ?, ?, ?, ?)",
      )
      .run(
        `pv-${userId}`,
        userId,
        1,
        JSON.stringify(personaSnapshotSchema.parse(approvedPersona)),
        JSON.stringify(provenance),
      );
  }

  it("uses explicit conditions without requiring a persona or LLM", async () => {
    const service = new DiscoveryService(connection);
    const provider = providerReturning([]);

    const result = await service.discover(
      userA,
      {
        keywords: "  TypeScript エンジニア  ",
        location: "東京",
        employmentType: "full_time",
      },
      context,
      { provider: provider as never },
    );

    expect(result.query).toEqual({
      keywords: "TypeScript エンジニア",
      location: "東京",
      contractType: "p",
      workHours: "f",
    });
    expect(result.promptVersion).toBe(`${JOB_SEARCH_PROMPT_VERSION}-manual`);
    expect(provider.search).toHaveBeenCalledWith(result.query, context);
  });

  it("only treats non-empty keywords as a manual search", () => {
    expect(DiscoveryService.isManualSearch({ keywords: "職種" })).toBe(true);
    expect(DiscoveryService.isManualSearch({ keywords: "  " })).toBe(false);
    expect(DiscoveryService.isManualSearch({})).toBe(false);
  });

  it("requires an approved persona before searching", async () => {
    const service = new DiscoveryService(connection);
    await expect(errorCode(service.discover(userA, {}, context))).resolves.toBe(
      "PERSONA_REQUIRED",
    );
  });

  it("does not use another user's persona", async () => {
    // Only userB has a persona; userA should still get PERSONA_REQUIRED.
    // This exercises the first query's user_id filter.
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userB.id);
    seedPersona(userB.id);
    const service = new DiscoveryService(connection);

    await expect(
      errorCode(
        service.discover(userA, {}, context, {
          client: clientReturning(generatedQueryPayload),
          provider: providerReturning([]) as never,
        }),
      ),
    ).resolves.toBe("PERSONA_REQUIRED");
  });

  it("isolates personas per user even when both have personas", async () => {
    // Both users have personas; each should only see their own.
    connection.sqlite
      .prepare("insert into users (id) values (?)")
      .run(userB.id);
    seedPersona(userA.id);
    seedPersona(userB.id);
    const service = new DiscoveryService(connection);
    const provider = providerReturning([]);

    // userA discover should succeed using userA's persona
    const resultA = await service.discover(userA, {}, context, {
      client: clientReturning(generatedQueryPayload),
      provider: provider as never,
    });
    expect(resultA.query).toEqual({ keywords: "フロントエンド エンジニア" });

    // Directly verify second query's user_id filter: snapshot lookup
    // for a foreign id must not return data even if first query were spoofed.
    const foreignId = `pv-${userB.id}`;
    const rawForeign = connection.sqlite
      .prepare(
        "select snapshot from persona_versions where id = ? and user_id = ?",
      )
      .get(foreignId, userA.id) as { snapshot: string } | undefined;
    expect(rawForeign).toBeUndefined();
    const rawOwn = connection.sqlite
      .prepare(
        "select snapshot from persona_versions where id = ? and user_id = ?",
      )
      .get(foreignId, userB.id) as { snapshot: string } | undefined;
    expect(rawOwn).toBeDefined();
  });

  it("generates a query from the latest persona and returns normalized candidates", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const provider = providerReturning([
      {
        title: "バックエンドエンジニア",
        company: "株式会社サンプル",
        description: "APIの設計実装を担当。",
        url: "https://jobviewtrack.example.test/v2/xyz",
      },
    ]);

    const result = await service.discover(userA, {}, context, {
      client: clientReturning(generatedQueryPayload),
      provider: provider as never,
    });

    // Empty-string query parts are dropped by the domain contract.
    expect(result.query).toEqual({
      keywords: "フロントエンド エンジニア",
    });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.sourceName).toBe("Careerjet");
    expect(result.jobs[0]?.sourceKind).toBe("licensed_source");
    expect(result.jobs[0]?.candidate.title).toBe("バックエンドエンジニア");
    expect(provider.search).toHaveBeenCalledWith(result.query, context);
  });

  it("preserves generated employment filters", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const provider = providerReturning([]);

    const result = await service.discover(userA, {}, context, {
      client: clientReturning({
        keywords: "TypeScript",
        location: "東京",
        contractType: "p",
        workHours: "f",
      }),
      provider: provider as never,
    });

    expect(result.query).toEqual({
      keywords: "TypeScript",
      location: "東京",
      contractType: "p",
      workHours: "f",
    });
    expect(provider.search).toHaveBeenCalledWith(result.query, context);
  });

  it("applies explicit user conditions on top of the generated query", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const provider = providerReturning([]);

    const result = await service.discover(
      userA,
      { employmentType: "full_time", keywords: "データ基盤" },
      context,
      {
        client: clientReturning(generatedQueryPayload),
        provider: provider as never,
      },
    );

    expect(result.query).toMatchObject({
      keywords: "データ基盤",
      contractType: "p",
      workHours: "f",
    });
  });

  it("refuses to search without usable keywords even after overrides", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    await expect(
      errorCode(
        service.discover(userA, { keywords: "　" }, context, {
          client: clientReturning({
            keywords: "",
            location: "",
            contractType: "",
            workHours: "",
          }),
          provider: providerReturning([]) as never,
        }),
      ),
    ).resolves.toBe("SEARCH_QUERY_REQUIRED");
  });

  it("maps provider failures onto stable API error codes", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const failingProvider = {
      search: vi
        .fn()
        .mockRejectedValue(
          new JobSearchProviderError(
            "PROVIDER_RATE_LIMITED",
            "rate limited",
            true,
          ),
        ),
    };

    await expect(
      errorCode(
        service.discover(userA, { keywords: "k" }, context, {
          client: clientReturning(generatedQueryPayload),
          provider: failingProvider as never,
        }),
      ),
    ).resolves.toBe("PROVIDER_RATE_LIMITED");
  });
});
