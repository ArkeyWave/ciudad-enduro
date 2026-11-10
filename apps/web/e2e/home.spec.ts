import { expect, test } from '@playwright/test';
import { DRAFT, PUBLISHED } from './fixtures.ts';

test('the home page lists published trails and hides drafts', async ({ page }) => {
  await page.goto('/');
  for (const trail of PUBLISHED) {
    await expect(page.getByRole('heading', { name: trail.name })).toBeVisible();
  }
  await expect(page.getByText(DRAFT.name)).toHaveCount(0);
});
