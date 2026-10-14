import { expect, test, type Page } from '@playwright/test';

const SHOTS = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Fails the test on unexpected console errors. Expected 4xx/5xx API responses are allowed. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

async function signInAs(page: Page, label: RegExp) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: label }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('a visitor can browse communities and see plain-language requirements', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Learning your community can verify.' })).toBeVisible();
  await shot(page, '01-landing');
  await page.getByRole('link', { name: 'Explore communities' }).first().click();
  await expect(page.getByRole('heading', { name: 'Ileri Security Guild' })).toBeVisible();
  await expect(page.getByText('Hold an NFT from Guild Pass on Base')).toBeVisible();
  await page.getByRole('heading', { name: 'Ileri Security Guild' }).click();
  await expect(page.getByRole('button', { name: 'Sign in to join' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Staying Safe Online' })).toBeVisible();
  await shot(page, '02-community-visitor');
  expect(errors).toEqual([]);
});

test('a member without a pass sees exactly why the guild is locked', async ({ page }) => {
  const errors = watchConsole(page);
  await signInAs(page, /Dele/);
  await page.goto('/c/ileri-security-guild');
  await expect(page.getByText('Not met:', { exact: false })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Join community' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Link that wallet' })).toBeVisible();
  await shot(page, '03-locked');
  expect(errors).toEqual([]);
});

test('an instructor reviews the pending submission against the rubric', async ({ page }) => {
  const errors = watchConsole(page);
  await signInAs(page, /Bayo/);
  await page.goto('/manage/ileri-security-guild/reviews');
  await expect(page.getByRole('cell', { name: 'Chioma Eze' })).toBeVisible();
  await shot(page, '04-review-queue');
  await page.getByRole('row', { name: /Chioma Eze/ }).getByRole('link', { name: 'Review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chioma Eze' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as under review' }).click();
  for (const name of ['Identifies at least three red flags', 'Describes a safe verification routine', 'Clear warning note']) {
    await page.getByRole('group', { name: new RegExp(name) }).getByLabel('Met', { exact: true }).check();
  }
  await page.getByLabel('Comment to the learner').fill('Clear red flags and a solid verification routine.');
  await shot(page, '05-review-detail');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved\. The learner completed the course\./)).toBeVisible();
  expect(errors).toEqual([]);
});

test('the learner sees the completion, verifies the credential and spends earned credits', async ({ page }) => {
  const errors = watchConsole(page);
  await signInAs(page, /Chioma/);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Welcome back, Chioma/ })).toBeVisible();
  await expect(page.getByText(/ready to claim/)).toBeVisible();
  await shot(page, '06-dashboard');

  await page.getByRole('link', { name: 'Claim now' }).click();
  await expect(page.getByText('40 course credits')).toBeVisible();
  await page.getByRole('button', { name: 'Claim' }).first().click();
  await expect(page.getByText('Reward added to your balance.')).toBeVisible();
  await shot(page, '07-rewards');

  await page.goto('/credentials');
  await page.getByRole('link', { name: 'Open' }).first().click();
  await expect(page.getByText('This credential is valid')).toBeVisible();
  await expect(page.getByRole('main').getByText('Chioma Eze')).toBeVisible();
  await shot(page, '08-verify');

  await page.goto('/c/ileri-security-guild');
  await page.getByRole('heading', { name: 'Incident Response: First Hour' }).click();
  await expect(page.getByText('Costs')).toBeVisible();
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByRole('heading', { name: 'Incident Response: First Hour' }).first()).toBeVisible();
  await page.getByRole('link', { name: /Start: Contain, then investigate/ }).click();
  await page.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText('Course complete. Your credential is ready.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /You finished Incident Response/ })).toBeVisible();
  await shot(page, '09-completed');

  await page.goto('/rewards');
  await expect(page.getByText('10', { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('the owner can use the builder, access rules and analytics', async ({ page }) => {
  const errors = watchConsole(page);
  await signInAs(page, /Ada/);
  await page.goto('/manage/ileri-security-guild');
  await expect(page.getByText('Verified completions').first()).toBeVisible();
  await shot(page, '10-manage-overview');

  await page.getByRole('link', { name: 'Courses', exact: true }).click();
  await page.getByRole('row', { name: /^Staying Safe Online/ }).getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByText(/is live and locked/)).toBeVisible();
  await page.getByRole('button', { name: 'Start a new draft' }).click();
  await page.getByRole('tab', { name: 'Quiz' }).click();
  await expect(page.getByLabel('Pass mark (%)')).toHaveValue('75');
  await page.getByLabel('Pass mark (%)').fill('80');
  await page.getByRole('tab', { name: 'Versions' }).click();
  await page.getByLabel('What changed in this draft').fill('Raise pass mark to 80%');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Version 2 is live.')).toBeVisible();
  await shot(page, '11-builder');

  await page.goto('/manage/ileri-security-guild/settings');
  await expect(page.getByText('Members will see:')).toBeVisible();
  await expect(page.getByText('Hold an NFT from Guild Pass on Base').first()).toBeVisible();
  await shot(page, '12-settings');

  await page.goto('/manage/ileri-security-guild/analytics');
  await expect(page.getByRole('heading', { name: 'By course' })).toBeVisible();
  await shot(page, '13-analytics');

  await page.goto('/manage/ileri-security-guild/audit');
  await expect(page.getByText('course.publish').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a provider outage shows a retry message instead of revoking access', async ({ page }) => {
  const errors = watchConsole(page);
  await signInAs(page, /Chioma/);
  await page.goto('/settings');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/dev/chain') && r.request().method() === 'POST'),
    page.getByLabel(/Simulate a blockchain provider outage/).check(),
  ]);
  await page.goto('/c/ileri-security-guild');
  await page.getByRole('heading', { name: 'Phishing Defense in Practice' }).click();
  await expect(page.getByText(/couldn't check your access/i)).toBeVisible();
  await shot(page, '14-outage');
  await page.goto('/settings');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/dev/chain') && r.request().method() === 'POST'),
    page.getByLabel(/Simulate a blockchain provider outage/).uncheck(),
  ]);
  expect(errors).toEqual([]);
});

test('the course player works on a phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = watchConsole(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Chioma/ }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await page.goto('/c/ileri-security-guild');
  await page.getByRole('link', { name: /^Completed Credential Staying Safe Online/ }).click();
  await expect(page.getByText('Course outline')).toBeVisible();
  await page.getByText('Course outline').click();
  await expect(page.getByRole('link', { name: /Passwords, managers and passkeys/ }).last()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, '15-mobile-player');
  await context.close();
  expect(errors).toEqual([]);
});
