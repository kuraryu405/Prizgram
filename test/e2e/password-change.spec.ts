import { expect, test } from "@playwright/test";

const oldPassword = "correct horse battery staple";
const newPassword = "correct horse battery staple updated";

test("changes a password from the login page and invalidates the old password", async ({
  page,
}) => {
  const loginId = `e2e.password.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(oldPassword);
  await page.getByLabel("パスワード（確認）").fill(oldPassword);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);

  const origin = new URL(page.url()).origin;
  const logout = await page.request.post("/api/auth/logout", {
    headers: { origin },
  });
  expect(logout.ok()).toBeTruthy();

  await page.goto("/login");
  await page.getByRole("link", { name: "パスワードを変更する" }).click();
  await expect(page).toHaveURL(/\/password-change/);

  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("現在のパスワード").fill(oldPassword);
  await page.getByLabel("新しいパスワード", { exact: true }).fill(newPassword);
  await page.getByLabel("新しいパスワード（確認）").fill(newPassword);
  await page.getByRole("button", { name: "パスワードを変更" }).click();
  await expect(page).toHaveURL(/\/login\?passwordChanged=1/);

  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード").fill(oldPassword);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByLabel("パスワード").fill(newPassword);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/app/);
});
