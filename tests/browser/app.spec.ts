import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('local workflow, evidence, editing, completion, mobile and honest missing configuration', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /A little less admin/ })).toBeVisible();
  await expect(page.getByText('LOCAL DEMO', { exact: true })).toBeVisible();
  if (await page.getByRole('button', { name: 'Confirm timezone' }).isVisible()) {
    await page.getByLabel('Your timezone', { exact: true }).fill('Africa/Lagos');
    await page.getByRole('button', { name: 'Confirm timezone' }).click();
  }
  if (await page.getByRole('button', { name: 'Try synthetic examples' }).isVisible())
    await page.getByRole('button', { name: 'Try synthetic examples' }).click();
  await expect(
    page.locator('.task-title').filter({ hasText: 'Pay the electricity bill' }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/today-desktop.png', fullPage: true });
  await page
    .getByRole('button', { name: 'View source for Pay the electricity bill', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('blockquote')).toContainText('USD 184.50');
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Pay the electricity bill — checked');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(
    page.locator('.task-title').filter({ hasText: 'Pay the electricity bill — checked' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Complete Pay the electricity bill — checked', exact: true })
    .click();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All taken care of' })).toBeVisible();
  await page
    .getByRole('button', { name: 'Reopen Pay the electricity bill — checked', exact: true })
    .click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'View source for Pay the electricity bill — checked',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Pay the electricity bill');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByText('Setup needed').first()).toBeVisible();
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not configured');
  await page.getByRole('button', { name: /Document inbox/ }).click();
  await page.getByRole('button', { name: 'Add a document', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Choose your document', exact: false }),
  ).toBeDisabled();
  await page.getByLabel('I understand how my document is processed.').check();
  await page.locator('input[type=file]').setInputFiles('public/demo/synthetic-bill.pdf');
  await page.getByRole('button', { name: 'Upload & find tasks' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 30000 });
  await expect(
    page.locator('.document-card').filter({ hasText: 'synthetic-bill.pdf' }),
  ).toContainText('failed', { timeout: 30000 });
  await page
    .locator('.document-card')
    .filter({ hasText: 'synthetic-bill.pdf' })
    .getByRole('button', { name: 'synthetic-bill.pdf', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('OpenAI is not configured');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete document', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (await page.getByRole('button', { name: 'Dismiss message' }).isVisible())
    await page.getByRole('button', { name: 'Dismiss message' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/today-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your preferences' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('notification permission denial is explicit and never creates a subscription', async ({
  page,
}) => {
  let posts = 0;
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'requestPermission', { value: async () => 'denied' });
  });
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: { ...config, pushConfigured: true, vapidPublicKey: 'TEST-ONLY-NOT-A-REAL-VAPID-KEY' },
    });
  });
  page.on('request', (req) => {
    if (req.url().endsWith('/api/push-subscriptions') && req.method() === 'POST') posts++;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('permission was not granted');
  expect(posts).toBe(0);
});
test('accessible names, keyboard dialogs, mobile layout and color contrast', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /A little less admin/ })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  await testInfo.attach('accessibility.json', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Add a document', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Preferences', exact: true }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: /Document inbox/ }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
});
