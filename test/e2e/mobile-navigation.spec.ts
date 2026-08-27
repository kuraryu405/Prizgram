import { expect, test, type Page } from "@playwright/test";

const password = "correct horse battery staple";

async function expectNavigationAtViewportBottom(page: Page): Promise<void> {
  const navigation = page.locator(".app-nav");
  await expect(navigation).toBeVisible();
  await expect(navigation).toHaveCSS("position", "fixed");

  const viewport = page.viewportSize();
  const bounds = await navigation.boundingBox();
  expect(viewport).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(
    Math.abs(bounds!.y + bounds!.height - viewport!.height),
  ).toBeLessThanOrEqual(1);
}

test("keeps primary navigation pinned to the mobile viewport bottom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const loginId = `mobile-nav.${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto("/register");
  await page.getByLabel("ログインID").fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByLabel("パスワード（確認）").fill(password);
  await page.getByRole("button", { name: /アカウントを作成/ }).click();
  await expect(page).toHaveURL(/\/app/);

  await expectNavigationAtViewportBottom(page);

  // A browser can retain an older client shell during a rolling deployment.
  // The landing-page scroll class must not pull its tab bar into the header.
  await page
    .locator("header.app-header")
    .evaluate((header) => header.classList.add("is-scrolled"));
  await expectNavigationAtViewportBottom(page);
});
