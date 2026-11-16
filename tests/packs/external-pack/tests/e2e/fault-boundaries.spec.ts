import { test, expect } from '@apackdev/testing';

test('pack pane and form failures leave other panes and host settings usable', async ({ appPage, app }) => {
  await app.waitForSurface('faults');
  await app.navigate('faults');
  const canvas = appPage.locator('[data-contribution-owner="e2e-fixture/faults"][data-contribution-area="canvas"]');
  const panel = appPage.locator('[data-contribution-owner="e2e-fixture/faults"][data-contribution-area="panel"]');
  await expect(canvas.getByText('Fixture pane is healthy')).toBeVisible();
  await canvas.getByRole('button', { name: 'Break this pane' }).click();
  await expect(canvas.getByRole('alert')).toContainText('e2e-fixture/faults');
  await expect(panel.getByText('Fixture pane is healthy')).toBeVisible();
  await panel.getByRole('button', { name: 'Break this pane' }).click();
  await expect(panel.getByRole('alert')).toContainText('Fixture pane render failed');
  await canvas.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(canvas.getByText('Fixture pane is healthy')).toBeVisible();

  await app.navigate('host/settings');
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'features' });
    settings.send({ type: 'FEATURE.SELECT', featureId: 'e2e-fixture/faults' });
  });
  const form = appPage.locator('[data-contribution-owner="e2e-fixture/faults"][data-contribution-area="settings form"]');
  await expect(form.getByRole('alert')).toContainText('Fixture custom form setup failed');
  await expect(appPage.getByRole('heading', { name: 'Fault fixture', exact: true })).toBeVisible();
  await expect(appPage.getByTitle('Reset to defaults')).toBeEnabled();
  await appPage.evaluate(() => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'general' });
    settings.send({ type: 'GENERAL_NAV.SELECT', item: 'json' });
  });
  await expect(appPage.getByRole('heading', { name: 'Settings JSON', exact: true })).toBeVisible();
  await expect(appPage.locator('.monaco-editor')).toBeVisible();
  const defaults = await appPage.evaluate(async () => {
    const model = (await (window as any).__loadMonaco()).editor.getModels().find((model: any) => model.getLanguageId() === 'json');
    return JSON.parse(model.getValue()).features['e2e-fixture/faults'];
  });
  expect(defaults).toEqual({ message: 'Still here' });
  await appPage.evaluate(() => {
    (window as any).applicationState.system.get('host/settings').send({ type: 'GENERAL_NAV.SELECT', item: 'personal' });
  });
  await expect(appPage.getByLabel('Full Name', { exact: true })).toBeVisible();
});
