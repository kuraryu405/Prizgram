import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated WCAG regression guard for the main flows (#90). Every scan
 * asserts that no critical or serious axe violation is present; moderate
 * findings are surfaced in the report without failing the run so they can
 * be triaged deliberately.
 */

const password = "correct horse battery staple";

async function registerAndLogin(page: Page): Promise<void> {
  const loginId = `a11y.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function expectNoSeriousViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  const deferred = results.violations.filter(
    (violation) =>
      violation.impact !== "critical" && violation.impact !== "serious",
  );
  if (deferred.length > 0) {
    console.log(
      `[a11y:${label}] deferred violations:`,
      JSON.stringify(
        deferred.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.length,
        })),
      ),
    );
  }
  expect(
    blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

test.describe("accessibility regression guard", () => {
  for (const path of ["/login", "/register"]) {
    test(`unauthenticated ${path} has no serious axe violations`, async ({
      page,
    }) => {
      await page.goto(path);
      await expectNoSeriousViolations(page, path);
    });
  }

  test("app shell pages have no serious axe violations", async ({ page }) => {
    await registerAndLogin(page);

    // Fresh user: the dashboard renders the onboarding flow.
    await expect(page.getByText(/はじめましょう/)).toBeVisible();
    await expectNoSeriousViolations(page, "/app");

    const authenticatedPaths = [
      "/app/persona",
      "/app/jobs",
      "/app/applications",
      "/app/deadlines",
      "/app/reminders",
    ];
    for (const path of authenticatedPaths) {
      await page.goto(path);
      await expectNoSeriousViolations(page, path);
    }
  });
});
