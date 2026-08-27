import { expect, test, type Page } from "@playwright/test";

const password = "correct horse battery staple";

async function registerAndLogin(page: Page): Promise<void> {
  const loginId = `persona-entry.${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createPersona(page: Page): Promise<void> {
  const request = page.request;
  const origin = new URL(page.url()).origin;
  const post = (url: string, data?: unknown) =>
    request.post(url, { data, headers: { origin } });

  const intakeResponse = await post("/api/persona");
  expect(intakeResponse.status()).toBe(200);
  const { intakeId } = (
    (await intakeResponse.json()) as { data: { intakeId: string } }
  ).data;

  const answers: Array<[string, string]> = [
    ["q1_skills", "TypeScriptでのWebアプリ開発経験があります。"],
    ["q2_experiences", "チームでWebアプリを開発しました。"],
    ["q3_strengths", "学習速度が速いことです。"],
    ["q4_weaknesses", "継続的なアウトプットが課題です。"],
    ["q5_values", "自律的に働ける環境を重視します。"],
    ["q6_preferences", "フロントエンドエンジニアを希望します。"],
  ];
  for (const [questionId, answer] of answers) {
    const response = await request.put(
      `/api/persona/intake/${intakeId}/answers`,
      { data: { questionId, answer }, headers: { origin } },
    );
    expect(response.ok()).toBeTruthy();
  }

  const generated = await post("/api/persona/generate", { intakeId });
  expect(generated.status()).toBe(201);
}

test("persona intake remains first-time only after a persona exists", async ({
  page,
}) => {
  await registerAndLogin(page);

  await page.goto("/app/persona");
  await expect(
    page.getByRole("link", { name: "ヒアリングをはじめる" }),
  ).toBeVisible();

  await page.goto("/app/persona/intake");
  await expect(page).toHaveURL(/\/app\/persona\/intake$/);
  await expect(page.locator("#answer-q1_skills")).toBeVisible();

  await createPersona(page);

  await page.goto("/app/persona");
  await expect(
    page.getByRole("link", { name: "選考結果からペルソナを更新する" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "新しいヒアリングで更新する" }),
  ).toHaveCount(0);

  await page.goto("/app/persona/intake");
  await expect(page).toHaveURL(/\/app\/persona$/);
  await expect(page.locator("#answer-q1_skills")).toHaveCount(0);
});
