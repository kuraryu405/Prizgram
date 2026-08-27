import { expect, test } from "@playwright/test";

const password = "correct horse battery staple";

test(
  "registers an active selection without a job posting and continues to its deadline",
  async ({ page }) => {
    await page.setExtraHTTPHeaders({ "cf-connecting-ip": "203.0.113.120" });
    const loginId = `e2e.minimal.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await page.goto("/register");
    await page.getByLabel("ログインID").fill(loginId);
    await page.getByLabel("パスワード", { exact: true }).fill(password);
    await page.getByLabel("パスワード（確認）").fill(password);
    await page.getByRole("button", { name: /アカウントを作成/ }).click();
    await expect(page).toHaveURL(/\/app/);

    await page.goto("/app/applications");
    const minimalForm = page
      .getByRole("heading", { name: "選考中の企業を追加" })
      .locator("..");
    await minimalForm.getByLabel("企業名").fill("E2E株式会社");
    await minimalForm
      .getByLabel("現在のステータス")
      .selectOption("interview");
    await minimalForm.getByLabel("現在の段階（任意）").fill("2次面接");
    await minimalForm.getByRole("button", { name: "応募を追加" }).click();

    const success = await minimalForm.getByRole("status");
    await expect(success).toContainText("応募を追加しました");
    await success.getByRole("link", { name: "締切を追加" }).click();
    await expect(page).toHaveURL(/\/app\/deadlines\?applicationId=/);

    const applicationSelect = page.getByLabel("応募");
    await expect(applicationSelect.locator("option:checked")).toHaveText(
      "E2E株式会社 — 職種未設定",
    );
    await page.getByLabel("タイトル").fill("2次面接");
    await page
      .getByLabel(/期限（Asia\/Tokyoの現地時刻）/)
      .fill("2026-09-30T10:00");
    await page.getByRole("button", { name: "締切を登録" }).click();

    await expect(page.getByText("2次面接", { exact: true })).toBeVisible();
  },
);
