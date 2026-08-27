import { expect, test, type Page } from "@playwright/test";

const ORIGIN = `http://localhost:${process.env.PORT ?? 3100}`;
const password = "correct horse battery staple";

async function registerAndLogin(page: Page) {
  const loginId = `e2e.note.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("application note survives create, edit, and reload", async ({ page }) => {
  await registerAndLogin(page);

  const post = (url: string, data?: unknown) =>
    page.request.post(url, {
      data,
      headers: { origin: ORIGIN },
    });

  const imported = await post("/api/jobs", {
    body:
      "【募集】メモ永続化テスト用フロントエンドインターン\n" +
      "株式会社メモテストではReactとTypeScriptを使う開発インターンを募集しています。\n" +
      "週3日以上勤務できる方を歓迎し、コードレビューを受けながら開発します。",
  });
  expect(imported.status()).toBe(201);
  const {
    data: { jobId },
  } = (await imported.json()) as { data: { jobId: string } };

  const application = await post("/api/applications", {
    jobId,
    note: "作成時メモ",
  });
  expect(application.status()).toBe(201);
  const {
    data: { applicationId },
  } = (await application.json()) as { data: { applicationId: string } };

  await page.goto(`/app/applications/${encodeURIComponent(applicationId)}`);
  await expect(page.getByRole("heading", { name: "最新メモ" })).toBeVisible();
  await expect(page.getByText("作成時メモ", { exact: true })).toBeVisible();
  await expect(page.getByLabel("メモ")).toHaveValue("作成時メモ");

  await page.getByLabel("メモ").fill("更新後メモ");
  await page.getByRole("button", { name: "更新する" }).click();
  await expect(page.getByRole("status")).toHaveText("更新しました。");
  await expect(page.getByText("更新後メモ", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("メモ")).toHaveValue("更新後メモ");
  await expect(page.getByText("更新後メモ", { exact: true })).toBeVisible();
});
