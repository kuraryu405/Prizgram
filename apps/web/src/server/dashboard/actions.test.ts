import { describe, expect, it } from "vitest";

import { buildNextActions, type NextActionInput } from "./actions";

const emptyInput: NextActionInput = {
  hasPersona: false,
  jobs: [],
  scoredJobIds: new Set<string>(),
  applicationCount: 0,
  urgentReminderCount: 0,
  overdueDeadlines: [],
};

describe("buildNextActions", () => {
  it("guides brand-new users to persona creation first", () => {
    const actions = buildNextActions(emptyInput);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.href).toBe("/app/persona/intake");
    expect(actions[0]?.tone).toBe("normal");
  });

  it("orders urgent reminders and overdue deadlines before onboarding steps", () => {
    const actions = buildNextActions({
      ...emptyInput,
      urgentReminderCount: 2,
      overdueDeadlines: [{ title: "ES提出", dueAt: "2026-01-01T00:00:00Z" }],
    });
    expect(actions.map((action) => action.tone)).toEqual([
      "urgent",
      "urgent",
      "normal",
    ]);
    expect(actions[0]?.label).toContain("緊急リマインダー");
    expect(actions[1]?.label).toContain("期限超過: ES提出");
  });

  it("moves users with a persona toward job import and scoring", () => {
    const actions = buildNextActions({
      ...emptyInput,
      hasPersona: true,
      jobs: [{ jobId: "job-1" }],
    });
    const labels = actions.map((action) => action.label);
    expect(labels.some((label) => label.includes("求人票を取り込む"))).toBe(
      false,
    );
    expect(labels[0]).toContain("未評価の求人");
    expect(labels).toContain("応募を登録する");
  });

  it("points at the first unscored job and reports the remaining count", () => {
    const actions = buildNextActions({
      ...emptyInput,
      hasPersona: true,
      jobs: [
        { jobId: "scored-1" },
        { jobId: "unscored-1" },
        { jobId: "unscored-2" },
      ],
      scoredJobIds: new Set(["scored-1"]),
    });
    const scoring = actions.find((action) =>
      action.label.includes("未評価の求人"),
    );
    expect(scoring?.href).toBe("/app/jobs/unscored-1");
    expect(scoring?.label).toContain("2");
  });

  it("returns no onboarding steps for fully engaged users", () => {
    const actions = buildNextActions({
      ...emptyInput,
      hasPersona: true,
      jobs: [{ jobId: "job-1" }],
      scoredJobIds: new Set(["job-1"]),
      applicationCount: 3,
    });
    expect(actions).toHaveLength(0);
  });
});
