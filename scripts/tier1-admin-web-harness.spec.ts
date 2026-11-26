import { test, expect } from '@playwright/test';

/**
 * Repeatable Tier 1 Admin Web harness for PR #24.
 * Requires: backend on :3000, admin-web on :5173, disposable DB fixture seeded
 * as documented in docs/verification/TIER1-ADMIN-WEB-BROWSER-HARNESS.md.
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@monienaija.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'MonieNaijaAdmin123!';
const CUSTOMER_ID = process.env.TIER1_CUSTOMER_ID || '804207c1-75cc-4127-be1d-29b6c4fa4d69';
const CUSTOMER_REF = process.env.TIER1_CUSTOMER_REF || 't1-804207c1';

test('Tier 1 registration review shows verified tier, class, fees/limits, ready-to-claim', async ({ page }) => {
  await page.goto('/');
  // Local admin sign-in (adjust selectors to current Admin Web login form).
  await page.getByLabel(/email|identifier/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Navigate to customer directory and open probe customer.
  await page.getByRole('link', { name: /customers/i }).click();
  await page.getByText(CUSTOMER_REF).first().click();

  // Open registration review / effective configuration. Selectors may need adjustment.
  await page.getByText(/registration review|effective configuration/i).first().click();

  await expect(page.getByText(/LEVEL_1/)).toBeVisible();
  await expect(page.getByText(/STANDARD/)).toBeVisible();
  await expect(page.getByText(/WALLET_TRANSFER/)).toBeVisible();
  await expect(page.getByText(/5,000,000|5000000/)).toBeVisible();
  await expect(page.getByText(/ready|activatable|wallet/i)).toBeVisible();

  await page.screenshot({ path: 'test-results/tier1-registration-review.png', fullPage: true });
});
