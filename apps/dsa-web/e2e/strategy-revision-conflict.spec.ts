import { expect, test, type Browser, type Page } from '@playwright/test';

test.skip(process.env.DSA_STRATEGY_E2E !== '1', 'Run with npm run test:e2e:strategy so the isolated strategy database is enabled.');

async function login(page: Page) {
  await page.goto('/login'); await page.locator('#password').fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  const confirmation = page.locator('#passwordConfirm'); if (await confirmation.isVisible().catch(() => false)) await confirmation.fill(process.env.DSA_STRATEGY_E2E_PASSWORD!);
  await Promise.all([page.waitForResponse(response => response.url().includes('/api/v1/auth/login') && response.status() === 200), page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ }).click()]);
}

async function authenticatedContext(browser: Browser) {
  const context = await browser.newContext(); const page = await context.newPage(); await login(page); return { context, page };
}

test('surfaces a real revision conflict in two independent browser contexts', async ({ browser }) => {
  const first = await authenticatedContext(browser); const second = await authenticatedContext(browser);
  await first.page.goto('/strategies');
  await first.page.getByRole('button', { name: '创建运行配置' }).first().click();
  await first.page.getByLabel('完整策略名称').fill(`E2E conflict ${Date.now()}`);
  await first.page.getByRole('button', { name: '进入策略配置' }).click();
  await expect(first.page).toHaveURL(/\/editor\?versionId=\d+/);
  const draftURL = first.page.url(); await second.page.goto(draftURL);
  await expect(second.page.getByTestId('save-status')).toHaveText('未修改');
  await first.page.getByLabel('决策有效期').fill('2d');
  await expect(first.page.getByTestId('save-status')).toHaveText('已保存');
  await second.page.getByLabel('决策有效期').fill('3d');
  await expect(second.page.getByTestId('revision-conflict-dialog')).toBeVisible();
  await second.page.getByRole('button', { name: '查看本地与服务器差异' }).click();
  second.page.once('dialog', dialog => void dialog.accept(`E2E local copy ${Date.now()}`));
  await second.page.getByRole('button', { name: '复制本地内容为新策略' }).click();
  await expect(second.page).toHaveURL(/\/strategies\/\d+\/editor\?versionId=\d+/);
  await first.context.close(); await second.context.close();
});
