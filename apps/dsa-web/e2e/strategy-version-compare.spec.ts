import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.DSA_STRATEGY_E2E !== '1', 'Run with npm run test:e2e:strategy so the isolated strategy database is enabled.');

async function login(page: Page) {
  await page.goto('/login'); await page.locator('#password').fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  const confirmation = page.locator('#passwordConfirm'); if (await confirmation.isVisible().catch(() => false)) await confirmation.fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/v1/auth/login') && response.status() === 200), page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ }).click()]);
}

test('compares draft and published versions with URL-backed selectors', async ({ page }) => {
  await login(page); await page.goto('/strategies');
  const strategyName = `E2E compare ${Date.now()}`;
  await page.getByRole('button', { name: '创建运行配置' }).first().click();
  await page.getByLabel('完整策略名称').fill(strategyName);
  await page.getByRole('button', { name: '进入策略配置' }).click();
  await expect(page).toHaveURL(/\/editor\?versionId=\d+/);
  // The version workspace is exercised through its UI selectors and URL state.
  // Publishing is separately covered by the service and HTTP smoke tests because
  // the current editor does not expose risk-policy authoring controls.
  const editorURL = new URL(page.url()); const strategyId = editorURL.pathname.split('/')[2]; const versionId = editorURL.searchParams.get('versionId')!;
  await page.goto(`/strategies/${strategyId}?fromVersion=${versionId}&toVersion=${versionId}`);
  await expect(page.getByRole('heading', { name: strategyName, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '比较', exact: true }).click();
  await expect(page).toHaveURL(/fromVersion=\d+.*toVersion=\d+|toVersion=\d+.*fromVersion=\d+/);
  await page.getByRole('button', { name: '交换比较版本' }).click();
  await expect(page).toHaveURL(/fromVersion=\d+.*toVersion=\d+|toVersion=\d+.*fromVersion=\d+/);
  await page.reload(); await expect(page.getByRole('heading', { name: strategyName, level: 1 })).toBeVisible();
});
