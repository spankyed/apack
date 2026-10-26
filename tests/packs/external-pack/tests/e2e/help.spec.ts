import { test, expect } from '@apackdev/testing';
import { frontendUnloaded } from './_support/pack-frontend.ts';

test('installed pack help remains navigable without its runtime', async ({ app, appPage, electronApp }) => {
  await electronApp.evaluate(({ shell }) => {
    const state = globalThis as any;
    state.__helpExternalUrls = [];
    state.__helpOriginalOpenExternal = shell.openExternal;
    shell.openExternal = async (url: string) => { state.__helpExternalUrls.push(url); };
  });
  try {
    await app.navigate('host/settings');
    await appPage.evaluate(() => (window as any).applicationState.system.get('host/settings').send({ type: 'HELP.OPEN', target: { packId: 'e2e-fixture', articleId: 'github-token-permissions' } }));
    await expect(appPage.getByTestId('help-article-title')).toHaveText('Fixture guide');
    await appPage.getByRole('link', { name: 'Next guide' }).click();
    await expect(appPage.getByTestId('help-article-title')).toHaveText('Next fixture guide');
    await appPage.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(appPage.getByTestId('help-article-title')).toHaveText('Fixture guide');
    const toggle = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/packs').send({ type: 'UI.TOGGLE_ENABLED', packId: 'e2e-fixture' }));
    const surfaceIds = () => appPage.evaluate(() => (window as any).applicationState.getSnapshot().context.surfaces.map((surface: { id: string }) => surface.id) as string[]);
    await toggle();
    try {
      await frontendUnloaded(appPage, 'e2e-fixture');
      expect(await surfaceIds()).not.toContain('e2e-fixture/memos');
      await appPage.getByRole('link', { name: 'Next guide' }).click();
      await expect(appPage.getByTestId('help-article-title')).toHaveText('Next fixture guide');
      await expect.poll(surfaceIds).not.toContain('e2e-fixture/memos');
    } finally {
      await toggle();
      await app.waitForSurface('memos');
    }
    expect(await electronApp.evaluate(() => (globalThis as any).__helpExternalUrls)).toEqual([]);
  } finally {
    await electronApp.evaluate(({ shell }) => {
      const state = globalThis as any;
      shell.openExternal = state.__helpOriginalOpenExternal;
      delete state.__helpOriginalOpenExternal;
      delete state.__helpExternalUrls;
    });
  }
});
