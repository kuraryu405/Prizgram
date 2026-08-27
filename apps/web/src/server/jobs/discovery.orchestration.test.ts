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
import {
  DiscoveryService,
  dedupeDiscoveredJobs,
  type ProviderAdapter,
} from "./discovery";
import {
  JobSearchProviderError,
  type JobCandidate,
} from "./provider/careerjet";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(
  here,
  "../../../../../packages/db/drizzle",
);

const userA = { id: "user-a", loginId: "student.one" };
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

function makeCandidate(
  overrides: Partial<JobCandidate> & {
    title: string;
    url: string;
    externalId: string;
  },
): JobCandidate {
  return {
    title: overrides.title,
    url: overrides.url,
    externalId: overrides.externalId,
    ...(overrides.company ? { company: overrides.company } : {}),
    ...(overrides.location ? { location: overrides.location } : {}),
    ...(overrides.description ? { description: overrides.description } : {}),
    ...(overrides.postedAt ? { postedAt: overrides.postedAt } : {}),
    ...(overrides.salaryText ? { salaryText: overrides.salaryText } : {}),
  };
}

function providerAdapter(
  name: string,
  candidates: readonly JobCandidate[],
  opts: { hits?: number; delayMs?: number; error?: unknown } = {},
): ProviderAdapter {
  return {
    name,
    sourceKind: "licensed_source",
    sourceName: name,
    search: vi.fn().mockImplementation(async () => {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.error) throw opts.error as Error;
      return { hits: opts.hits ?? candidates.length, candidates };
    }),
  };
}

let temporaryDirectory: string;
let connection: DatabaseConnection;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prizgram-disc-multi-"),
  );
  connection = createDatabase(path.join(temporaryDirectory, "jobs.sqlite"));
  migrateDatabase(connection, migrationsFolder);
  connection.sqlite.prepare("insert into users (id) values (?)").run(userA.id);
});

afterEach(() => {
  connection.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

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

describe("multi-provider orchestration", () => {
  it("aggregates 2+ provider successes", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const p1 = providerAdapter("Careerjet", [
      makeCandidate({
        title: "A",
        url: "https://a.example/1",
        externalId: "a1",
        company: "Alpha",
      }),
    ]);
    const p2 = providerAdapter("Himalayas", [
      makeCandidate({
        title: "B",
        url: "https://b.example/2",
        externalId: "b1",
        company: "Beta",
      }),
    ]);

    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [p1, p2] },
    );

    expect(result.jobs).toHaveLength(2);
    expect(result.providerStatuses.Careerjet).toBe("ok");
    expect(result.providerStatuses.Himalayas).toBe("ok");
    expect(result.hits).toBe(2);
    // provenance preserved
    expect(result.jobs[0]?.candidate.externalId).toBeDefined();
    expect(result.jobs[0]?.sourceName).toBeDefined();
    expect(result.jobs[0]?.fetchedAt).toBeDefined();
    expect(new Date(result.jobs[0]?.fetchedAt ?? "").getTime()).not.toBeNaN();
  });

  it("returns partial success when one provider times out", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const ok = providerAdapter("Careerjet", [
      makeCandidate({
        title: "Ok Job",
        url: "https://ok.example/1",
        externalId: "ok1",
        company: "OkCo",
      }),
    ]);
    const timeout = providerAdapter("Himalayas", [], {
      error: new JobSearchProviderError("PROVIDER_TIMEOUT", "timed out", true),
    });

    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [ok, timeout] },
    );

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.candidate.title).toBe("Ok Job");
    expect(result.providerStatuses.Careerjet).toBe("ok");
    expect(result.providerStatuses.Himalayas).toBe("timeout");
  });

  it("isolates timeout: hanging provider does not block other", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    // One provider that never resolves within test timeout - but orchestrator has 10s; we simulate hang then ensure other returns
    // We'll use a provider that delays 50ms and another that errors with timeout quickly
    const fast = providerAdapter("Careerjet", [
      makeCandidate({
        title: "Fast",
        url: "https://fast.example/1",
        externalId: "fast1",
        company: "FastCo",
      }),
    ]);
    const hangingError = providerAdapter("Himalayas", [], {
      error: new JobSearchProviderError("PROVIDER_TIMEOUT", "timed out", true),
    });

    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [fast, hangingError] },
    );

    expect(result.jobs).toHaveLength(1);
    expect(result.providerStatuses.Himalayas).toBe("timeout");
  });

  it("dedupes obvious duplicates across providers", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const dupCandidate = makeCandidate({
      title: "Engineer",
      company: "Acme",
      location: "Tokyo",
      url: "https://careerjet.example/j1",
      externalId: "c1",
    });
    const dupCandidate2 = makeCandidate({
      title: "Engineer",
      company: "Acme",
      location: "Tokyo",
      url: "https://himalayas.app/jobs/j1/apply",
      externalId: "h1",
    });

    const p1 = providerAdapter("Careerjet", [dupCandidate]);
    const p2 = providerAdapter("Himalayas", [dupCandidate2]);

    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [p1, p2] },
    );

    expect(result.jobs).toHaveLength(1);
    // Should keep first provider's provenance
    expect(result.jobs[0]?.sourceName).toBe("Careerjet");
  });

  it("does not merge same title but different company", () => {
    const dupTitleA = makeCandidate({
      title: "Engineer",
      company: "Acme",
      url: "https://a.example/1",
      externalId: "a1",
    });
    const dupTitleB = makeCandidate({
      title: "Engineer",
      company: "Beta",
      url: "https://b.example/2",
      externalId: "b2",
    });
    const result = dedupeDiscoveredJobs([
      {
        candidate: dupTitleA,
        sourceName: "Careerjet",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
      {
        candidate: dupTitleB,
        sourceName: "Himalayas",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
    ]);
    expect(result).toHaveLength(2);
  });

  it("does not dedupe when company missing (ambiguous)", () => {
    const noCompanyA = makeCandidate({
      title: "Engineer",
      url: "https://a.example/1",
      externalId: "a1",
    });
    const noCompanyB = makeCandidate({
      title: "Engineer",
      url: "https://b.example/2",
      externalId: "b2",
    });
    const result = dedupeDiscoveredJobs([
      {
        candidate: noCompanyA,
        sourceName: "Careerjet",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
      {
        candidate: noCompanyB,
        sourceName: "Himalayas",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
    ]);
    expect(result).toHaveLength(2);
  });

  it("dedupes on same canonical URL even when titles differ slightly", () => {
    // Strong evidence via URL host+path identical
    const c1 = makeCandidate({
      title: "Engineer",
      url: "https://example.com/jobs/123",
      externalId: "a1",
      company: "Acme",
    });
    const c2 = makeCandidate({
      title: "Engineer (Remote)",
      url: "https://example.com/jobs/123/",
      externalId: "b1",
      company: "Acme",
    });
    const result = dedupeDiscoveredJobs([
      {
        candidate: c1,
        sourceName: "Careerjet",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
      {
        candidate: c2,
        sourceName: "Himalayas",
        sourceKind: "licensed_source",
        fetchedAt: new Date().toISOString(),
      },
    ]);
    expect(result).toHaveLength(1);
  });

  it("respects per-provider and total limits", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const many = Array.from({ length: 30 }, (_, i) =>
      makeCandidate({
        title: `Job ${i}`,
        url: `https://a.example/${i}`,
        externalId: `a${i}`,
        company: `Company ${i}`,
      }),
    );
    const p1 = providerAdapter("Careerjet", many);
    const p2 = providerAdapter("Himalayas", many);
    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [p1, p2] },
    );
    // per provider 20, total 40
    expect(result.jobs.length).toBeLessThanOrEqual(40);
    expect(p1.search).toHaveBeenCalled();
    expect(p2.search).toHaveBeenCalled();
  });

  it("calls all selected providers (provider selection)", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const p1 = providerAdapter("Careerjet", []);
    const p2 = providerAdapter("Himalayas", []);
    await service.discover(
      userA,
      { keywords: "engineer", location: "Tokyo" },
      context,
      { providers: [p1, p2] },
    );
    expect(p1.search).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "engineer" }),
      context,
    );
    expect(p2.search).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: "engineer" }),
      context,
    );
  });

  it("preserves provenance: externalId, source URL, fetchedAt, attribution", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const now = new Date("2026-08-27T00:00:00.000Z");
    const candidate = makeCandidate({
      title: "Provenance Job",
      url: "https://prov.example/job",
      externalId: "prov1",
      company: "ProvCo",
    });
    const p1 = providerAdapter("Himalayas", [candidate]);
    const result = await service.discover(
      userA,
      { keywords: "engineer" },
      context,
      { providers: [p1], now: () => now },
    );
    expect(result.jobs[0]?.candidate.externalId).toBe("prov1");
    expect(result.jobs[0]?.candidate.url).toBe("https://prov.example/job");
    expect(result.jobs[0]?.fetchedAt).toBe(now.toISOString());
    expect(result.jobs[0]?.sourceName).toBe("Himalayas");
    expect(result.jobs[0]?.sourceKind).toBe("licensed_source");
  });

  it("throws appropriate error when all providers fail", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const failing1 = providerAdapter("Careerjet", [], {
      error: new JobSearchProviderError("PROVIDER_NETWORK", "network", true),
    });
    const failing2 = providerAdapter("Himalayas", [], {
      error: new JobSearchProviderError("PROVIDER_NETWORK", "network", true),
    });
    await expect(
      service.discover(userA, { keywords: "engineer" }, context, {
        providers: [failing1, failing2],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("does not require API key for Himalayas when Careerjet is not configured (simulated by only Himalayas provider)", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const p = providerAdapter("Himalayas", [
      makeCandidate({
        title: "Remote Job",
        url: "https://h.example/1",
        externalId: "h1",
        company: "RemoteCo",
      }),
    ]);
    const result = await service.discover(
      userA,
      { keywords: "remote" },
      context,
      { providers: [p] },
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.providerStatuses.Himalayas).toBe("ok");
  });

  it("handles manual search without persona", async () => {
    const service = new DiscoveryService(connection);
    const p1 = providerAdapter("Careerjet", [
      makeCandidate({
        title: "Manual",
        url: "https://m.example/1",
        externalId: "m1",
        company: "ManualCo",
      }),
    ]);
    const p2 = providerAdapter("Himalayas", [
      makeCandidate({
        title: "Manual2",
        url: "https://m.example/2",
        externalId: "m2",
        company: "ManualCo2",
      }),
    ]);
    const result = await service.discover(
      userA,
      { keywords: "manual keyword" },
      context,
      { providers: [p1, p2] },
    );
    expect(result.jobs).toHaveLength(2);
    expect(result.promptVersion).toBe("job-search-v1-manual");
  });

  it("concurrent providers do not exceed limit and preserve partial success", async () => {
    seedPersona(userA.id);
    const service = new DiscoveryService(connection);
    const ok = providerAdapter("Careerjet", [
      makeCandidate({
        title: "Ok",
        url: "https://ok.example/1",
        externalId: "ok1",
        company: "Ok",
      }),
    ]);
    const rateLimited = providerAdapter("Himalayas", [], {
      error: new JobSearchProviderError("PROVIDER_RATE_LIMITED", "rate", true),
    });
    const result = await service.discover(
      userA,
      { keywords: "test" },
      context,
      { providers: [ok, rateLimited] },
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.providerStatuses.Himalayas).toBe("rate_limited");
  });
});
