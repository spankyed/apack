// Pack code names a feature (`'code'`, `'default-setup/logs'`) and the app addresses it (`default-setup/code`).
// Each case here is a path where a name had to become an address and, when it didn't, the app went on running
// with the click or the setting silently lost. Nothing below the running app catches that: these are the tests.
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

/** Selects a declared feature form through the host Settings actor. */
async function selectFeature(page: Page, featureId: string): Promise<void> {
  await page.evaluate((id) => {
    const settings = (window as any).applicationState.system.get('host/settings');
    settings.send({ type: 'TAB.SELECT', tab: 'features' });
    settings.send({ type: 'FEATURE.SELECT', featureId: id });
  }, featureId);
}

/** Records the event types a surface's actor receives from here on */
async function recordEvents(page: Page, surfaceId: string): Promise<() => Promise<string[]>> {
  await page.evaluate((id) => {
    const win = window as any;
    win.__addressingEvents = [];
    win.applicationState.system.inspect((inspection: { type: string; actorRef?: { id: string }; event: { type: string } }) => {
      if (inspection.type === '@xstate.event' && inspection.actorRef?.id === id) win.__addressingEvents.push(inspection.event.type);
    });
  }, surfaceId);
  return () => page.evaluate(() => [...(window as any).__addressingEvents] as string[]);
}

// The settings system tells the feature's system and surface; the harness specs see the system half
test("a surface setting changed in Settings reaches the feature's surface, once", async ({ app, appPage }) => {
  await app.waitForSurface('default-setup/code');
  await app.navigate('host/settings');
  await selectFeature(appPage, 'default-setup/code');
  await expect(appPage.locator('#md-editor-default')).toBeChecked();
  const events = await recordEvents(appPage, 'default-setup/code');
  await appPage.locator('#md-editor-default').uncheck();
  await expect.poll(async () => (await events()).filter((type) => type === 'FEATURE_SETTINGS_UPDATED').length).toBe(1);
  await appPage.waitForTimeout(300);
  expect((await events()).filter((type) => type === 'FEATURE_SETTINGS_UPDATED')).toHaveLength(1);
});

test('the Code settings form saves paths and tests the current draft', async ({ app, appPage }) => {
  const override = `/e2e/addressing/${Date.now()}/claude`;
  await app.waitForSurface('default-setup/code');
  await app.navigate('host/settings');
  await selectFeature(appPage, 'default-setup/code');

  const claude = appPage.getByRole('textbox', { name: 'Claude Code CLI path' });
  const codex = appPage.getByRole('textbox', { name: 'Codex CLI path' });
  await claude.fill(override);
  await codex.fill(process.execPath);
  const codexRow = codex.locator('..');
  await codexRow.getByRole('button', { name: 'Test' }).click();
  await expect(codexRow.getByRole('img', { name: 'CLI available' })).toBeVisible();

  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system
    .get('default-setup/code').getSnapshot().context.settings.cliPaths)).toMatchObject({
    'claude-code': override,
    codex: process.execPath,
  });
  await app.navigate('default-setup/code');
  await app.navigate('host/settings');
  await selectFeature(appPage, 'default-setup/code');
  await expect(claude).toHaveValue(override);
});

// default-setup's link-navigation unit spec covers the navigation itself on the harness's shell; this case keeps what
// only the running app shows: the Logs canvas renders the link once a source is excluded, and clicking it navigates
test('a link to another surface opens it and hands it the events', async ({ app, appPage }) => {
  // The Logs toolbar shows the link once a source is excluded; it opens Settings on the Logs surface
  await app.waitForSurface('default-setup/logs');
  await app.navigate('host/settings');
  await selectFeature(appPage, 'default-setup/logs');
  const pattern = appPage.getByPlaceholder('Add pattern, e.g. debug.*');
  await pattern.fill('e2e-excluded');
  await pattern.press('Enter');
  await expect(appPage.getByText('Settings saved', { exact: true })).toBeVisible();
  await app.navigate('default-setup/logs');
  await appPage.getByTitle('Click to manage excluded sources').click();

  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.activeSurface.id))
    .toBe('host/settings');
  const settings = () => appPage.evaluate(() => {
    const { activeTab, selectedFeatureId } = (window as any).applicationState.system.get('host/settings').getSnapshot().context;
    return { activeTab, selectedFeatureId };
  });
  await expect.poll(settings).toEqual({ activeTab: 'features', selectedFeatureId: 'default-setup/logs' });
});
