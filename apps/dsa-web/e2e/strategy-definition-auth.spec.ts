import { expect, test } from '@playwright/test';

const password = process.env.DSA_STRATEGY_E2E_PASSWORD;

test.skip(process.env.DSA_STRATEGY_E2E !== '1', 'Run with npm run test:e2e:strategy so the isolated strategy database is enabled.');

test.describe('strategy definition isolated authentication', () => {
  test('uses the normal first-login flow against the isolated E2E database', async ({ page }) => {
    // This is deliberately not an auth bypass: Playwright establishes the same
    // signed dsa_session cookie a human receives from the production login route.
    expect(password).toBeTruthy();
    await page.goto('/login');
    const input = page.locator('#password');
    await expect(input).toBeVisible();
    await input.fill(password!);
    const confirmation = page.locator('#passwordConfirm');
    if (await confirmation.isVisible().catch(() => false)) await confirmation.fill(password!);
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/v1/auth/login') && response.status() === 200),
      page.getByRole('button', { name: /授权进入工作台|完成设置并登录/ }).click(),
    ]);
    await expect(page).toHaveURL(/\/overview$/);
    const cookies = await page.context().cookies();
    expect(cookies.some(cookie => cookie.name === 'dsa_session' && cookie.path === '/')).toBe(true);
    const protectedStatus = await page.evaluate(async () => {
      const response = await fetch('/api/v1/simulation/definition/strategies');
      return response.status;
    });
    expect(protectedStatus).toBe(200);
    await page.goto('/strategies');
    await expect(page.getByRole('heading', { name: '策略中心' })).toBeVisible();
  });
});
