import { test, expect } from '@apackdev/testing';

// A surface popped out into its own window: main accepts the surface's ref as its id, and the popout renders the
// surface's canvas as part of that surface (useSurface() in its components)
test('pops a built-in surface out into its own window, which renders it', async ({ appPage, electronApp }) => {
  const opened = electronApp.waitForEvent('window');
  await appPage.evaluate(() => (window as any).electronAPI.surfaces.popout('default-setup/notes', 'Notes'));
  const popout = await opened;

  const errors: string[] = [];
  popout.on('pageerror', (error) => errors.push(error.message));
  popout.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  expect(new URL(popout.url()).searchParams.get('surfaceId')).toBe('default-setup/notes');
  await popout.waitForLoadState('domcontentloaded');
  await expect(popout.getByTestId('notes-canvas')).toBeVisible();
  expect(await popout.evaluate(() => (window as any).__errorPageShown ?? false)).toBe(false);
  expect(errors).toEqual([]);
});
