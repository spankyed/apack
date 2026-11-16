import { test, expect } from '@apackdev/testing';

// default-setup's `help/github-sign-in.md`, and a word in its body that no other bundled article's text holds
const ARTICLE = 'How do I sign in to GitHub?';
const BODY_ONLY_TERM = 'OAuth';

test('Settings Help searches bundled articles and opens feature help', async ({ app, appPage }) => {
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'Help', exact: true }).click();
  const reader = appPage.getByTestId('help-reader');
  await expect(reader.getByRole('button', { name: ARTICLE })).toBeVisible();
  await reader.getByRole('textbox', { name: 'Search help' }).fill(BODY_ONLY_TERM);
  await expect(reader.getByRole('button', { name: ARTICLE })).toBeVisible();
  await expect(reader.getByRole('button', { name: 'How do I enable TTS?' })).toHaveCount(0);
  await reader.getByRole('button', { name: ARTICLE }).click();
  await expect(reader.getByTestId('help-article-title')).toContainText('sign in to GitHub');
  await reader.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(reader.getByRole('textbox', { name: 'Search help' })).toHaveValue(BODY_ONLY_TERM);
  await app.navigate('host/settings');
  await appPage.evaluate(() => (window as any).applicationState.system.get('host/settings').send({ type: 'FEATURE.SELECT', featureId: 'default-setup/code' }));
  await appPage.evaluate(() => (window as any).applicationState.system.get('host/settings').send({ type: 'TAB.SELECT', tab: 'features' }));
  await appPage.getByTestId('feature-help').click();
  await expect(reader.getByRole('combobox', { name: 'Filter help by feature' })).toHaveValue('default-setup/code');
});

test('unavailable help targets explain the problem and return to the index', async ({ app, appPage }) => {
  await app.navigate('host/settings');
  await appPage.getByRole('button', { name: 'Help', exact: true }).click();
  await appPage.evaluate(() => (window as any).applicationState.system.get('host/settings').send({ type: 'HELP.OPEN', target: { packId: 'missing-pack', articleId: 'missing' } }));
  await expect(appPage.getByRole('heading', { name: 'Article unavailable' })).toBeVisible();
  await appPage.getByRole('button', { name: 'Browse all help' }).click();
  await expect(appPage.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
});
