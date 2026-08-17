import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.DSA_STRATEGY_E2E !== '1', 'Run with npm run test:e2e:strategy so the isolated strategy database is enabled.');

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#password').fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  const confirmation = page.locator('#passwordConfirm');
  if (await confirmation.isVisible().catch(() => false)) await confirmation.fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/api/v1/auth/login') && response.status() === 200),
    page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ }).click(),
  ]);
}

test('creates a strategy configuration from a kernel, validates it, and publishes a read-only version', async ({ page }) => {
  await login(page);
  await page.goto('/strategies');
  await page.getByRole('button', { name: '创建运行配置' }).first().click();
  await page.getByLabel('完整策略名称').fill(`E2E workflow ${Date.now()}`);
  await page.getByRole('button', { name: '进入策略配置' }).click();
  await expect(page).toHaveURL(/\/editor\?versionId=\d+/);

  await expect(page.getByRole('group', { name: '1. 输出契约' })).toBeVisible();
  await expect(page.getByRole('group', { name: '5. 策略内核' })).toContainText(/Python 函数入口|内核/);
  await page.getByRole('button', { name: '检查策略', exact: true }).click();
  await expect(page.getByText(/策略检查已通过/)).toBeVisible();
  await page.getByRole('button', { name: '正式发布', exact: true }).click();
  await page.getByPlaceholder('填写版本变更说明').fill('E2E 发布闭环');
  await page.getByRole('dialog', { name: '发布策略版本' })
    .getByRole('button', { name: '正式发布', exact: true })
    .click();
  await expect(page.getByTestId('save-status')).toHaveText('正式版本只读');
  await expect(page.getByRole('link', { name: /运行回测|打开验证中心/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '基于此版本创建配置草稿' })).toBeVisible();
});
