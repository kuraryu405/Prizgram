import { expect, test, type Page } from "@playwright/test";

const password = "correct horse battery staple";

async function registerAndLogin(page: Page): Promise<void> {
  const loginId = `layout.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("imported job detail does not create horizontal page overflow", async ({
  page,
}) => {
  await registerAndLogin(page);

  const sourceUrl = `https://example.test/${"unbroken-provider-path-".repeat(70)}`;
  const response = await page.request.post("/api/jobs", {
    data: {
      body: [
        "【募集】フロントエンドエンジニアインターン",
        "株式会社サンプルではReactとTypeScriptを使うフロントエンド開発インターンを募集しています。",
        "長い求人票の入力も取り込み後の閲覧で横幅を押し広げません。",
      ].join("\n"),
      sourceName: "長大 URL のテスト提供元",
      sourceUrl,
    },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(201);
  const imported = (await response.json()) as { data: { jobId: string } };

  for (const viewport of [
    { width: 2048, height: 1200 },
    { width: 900, height: 1000 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/app/jobs/${imported.data.jobId}`);
    await expect(
      page.getByRole("heading", { name: "株式会社サンプル" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: sourceUrl })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      detailWidth:
        document
          .querySelector<HTMLElement>(".page-job-detail")
          ?.getBoundingClientRect().width ?? 0,
      viewport: window.innerWidth,
    }));
    expect(Math.max(dimensions.body, dimensions.document)).toBe(
      dimensions.viewport,
    );
    if (viewport.width === 2048)
      expect(dimensions.detailWidth).toBeGreaterThan(1000);
  }
});
