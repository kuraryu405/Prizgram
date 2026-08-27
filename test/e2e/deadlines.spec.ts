import { expect, test, type Page } from "@playwright/test";

const password = "correct horse battery staple";

async function registerAndLogin(page: Page) {
  const loginId = `e2e.deadline.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function seedApplication(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  const post = (url: string, data?: unknown) =>
    page.request.post(url, { data, headers: { origin } });
  const imported = await post("/api/jobs", {
    body:
      "【募集】フロントエンドエンジニアインターン\n" +
      "株式会社締切テストではReactとTypeScriptを使う開発インターンを募集しています。",
  });
  expect(imported.status()).toBe(201);
  const {
    data: { jobId },
  } = (await imported.json()) as { data: { jobId: string } };
  const application = await post("/api/applications", {
    jobId,
    nextAction: "ESを書く",
  });
  expect(application.status()).toBe(201);
  const {
    data: { applicationId },
  } = (await application.json()) as { data: { applicationId: string } };
  return applicationId;
}

test("edits and deletes deadlines from the mobile UI", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await registerAndLogin(page);
  const applicationId = await seedApplication(page);
  const created = await page.request.post("/api/deadlines", {
    data: {
      applicationId,
      kind: "document",
      title: "ES提出（CRUD）",
      dueLocal: "2030-09-01T09:00",
      timeZone: "Asia/Tokyo",
    },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(created.status()).toBe(201);

  await page.goto("/app/deadlines");
  const originalRow = page
    .locator("li.deadline-item")
    .filter({ hasText: "ES提出（CRUD）" });
  await expect(originalRow).toBeVisible();
  await originalRow
    .getByRole("button", { name: "ES提出（CRUD）のその他の操作" })
    .click();
  await originalRow.getByRole("button", { name: "編集" }).click();

  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByLabel("タイトル")).toHaveValue("ES提出（CRUD）");
  await expect(
    editDialog.getByLabel("期限（Asia/Tokyoの現地時刻）"),
  ).toHaveValue("2030-09-01T09:00");
  await editDialog.getByLabel("タイトル").fill("一次面接（CRUD）");
  await editDialog
    .getByLabel("期限（Asia/Tokyoの現地時刻）")
    .fill("2030-09-02T14:30");
  await editDialog.getByLabel("種別").selectOption("interview");
  await editDialog
    .getByLabel("タイムゾーン")
    .selectOption("America/Los_Angeles");
  await editDialog.getByRole("button", { name: "保存", exact: true }).click();

  const updatedRow = page
    .locator("li.deadline-item")
    .filter({ hasText: "一次面接（CRUD）" });
  await expect(updatedRow).toBeVisible();
  await expect(page.getByText("締切を更新しました。")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/app");
  await expect(page.getByText(/一次面接（CRUD）/).first()).toBeVisible();
  await page.goto("/app/deadlines");
  await updatedRow
    .getByRole("button", { name: "一次面接（CRUD）のその他の操作" })
    .click();
  await updatedRow.getByRole("button", { name: "削除" }).click();
  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog).toContainText("一次面接（CRUD）");
  await deleteDialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(updatedRow).toBeVisible();

  await updatedRow
    .getByRole("button", { name: "一次面接（CRUD）のその他の操作" })
    .click();
  await updatedRow.getByRole("button", { name: "削除" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "削除する" })
    .click();
  await expect(updatedRow).toHaveCount(0);
  await page.goto("/app/reminders");
  await expect(page.getByText("一次面接（CRUD）")).toHaveCount(0);
});
