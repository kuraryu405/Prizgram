// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { okEnvelope, stubFetch } from "@/test-support/http";

import { JobDiscovery } from "./job-discovery";

const navigationMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigationMocks.refresh }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigationMocks.refresh.mockClear();
});

const discoveredJob = {
  candidate: {
    externalId: "careerjet-1",
    title: "フロントエンドエンジニア",
    company: "Prizgram株式会社",
    description: "求人の説明です。",
    location: "東京",
    url: "https://example.com/jobs/1",
  },
  sourceName: "Careerjet",
  sourceKind: "official_api",
};

const scoreDetail = {
  jobVersionId: "job-version-1",
  axes: {
    skillFit: {
      score: 82,
      reasons: ["TypeScript経験"],
      evidenceRefs: ["requirements[0]"],
    },
    cultureValueFit: {
      score: 64,
      reasons: ["情報が限られています"],
      evidenceRefs: [],
    },
    difficultyGap: {
      score: 38,
      reasons: ["一部準備が必要"],
      evidenceRefs: ["desiredSkills[0]"],
    },
  },
};

describe("JobDiscovery card scoring", () => {
  test("imports a candidate before scoring and renders all three axes", async () => {
    const requests: string[] = [];
    stubFetch((url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/jobs/discover") {
        return okEnvelope({
          query: { keywords: "frontend" },
          promptVersion: "prompt-1",
          hits: 1,
          jobs: [discoveredJob],
        });
      }
      if (url === "/api/jobs" && init?.method === "POST") {
        return okEnvelope({
          jobId: "job-1",
          jobVersionId: "job-version-1",
          version: 1,
          duplicate: false,
        });
      }
      if (url === "/api/jobs/job-1/score" && init?.method === "POST") {
        return okEnvelope({ detail: scoreDetail, duplicate: false });
      }
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();

    render(<JobDiscovery />);
    await user.click(screen.getByRole("button", { name: "求人を探す" }));
    await screen.findByRole("button", { name: "3軸で評価" });
    await user.click(screen.getByRole("button", { name: "3軸で評価" }));

    expect(requests).toEqual([
      "POST /api/jobs/discover",
      "POST /api/jobs",
      "POST /api/jobs/job-1/score",
    ]);
    expect(await screen.findByText("評価完了")).not.toBeNull();
    expect(screen.getByText("82")).not.toBeNull();
    expect(screen.getByText("64")).not.toBeNull();
    expect(screen.getByText("38")).not.toBeNull();

    await user.click(screen.getByText("根拠を見る"));
    expect(
      screen.getByText("情報不足（文化・価値観の根拠がありません）"),
    ).not.toBeNull();
    expect(screen.getByText("根拠ID: requirements[0]")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "詳細へ" }).getAttribute("href"),
    ).toBe("/app/jobs/job-1");
  });

  test("does not score when importing fails and offers card-level retry", async () => {
    const requests: string[] = [];
    stubFetch((url, init) => {
      requests.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/jobs/discover") {
        return okEnvelope({
          query: { keywords: "frontend" },
          promptVersion: "prompt-1",
          hits: 1,
          jobs: [discoveredJob],
        });
      }
      if (url === "/api/jobs" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            ok: false,
            error: { code: "UPSTREAM_UNAVAILABLE", message: "failure" },
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected request to ${url}`);
    });
    const user = userEvent.setup();

    render(<JobDiscovery />);
    await user.click(screen.getByRole("button", { name: "求人を探す" }));
    await user.click(await screen.findByRole("button", { name: "3軸で評価" }));

    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull());
    expect(screen.getByRole("button", { name: "再試行" })).not.toBeNull();
    expect(requests).not.toContain("POST /api/jobs/job-1/score");
  });
});
