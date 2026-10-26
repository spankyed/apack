import { test, expect } from '@apackdev/testing';
import { acceptedRuntime, frontendAccepted, frontendUnloaded } from './_support/pack-frontend.ts';

/** Installed declarations remain visible while their executable frontend is disabled. */
test('an open flow palette follows external step disable and re-enable', async ({ app, appPage }) => {
  await app.waitForSurface('e2e-fixture/memos');
  await app.navigate('host/packs');
  await app.navigate('default-setup/flows');
  await appPage.getByRole('button', { name: 'New Flow', exact: true }).click();
  const palette = appPage.locator('[data-onboarding-id="flow-node-palette"]');
  await expect(palette).toBeVisible();
  const stamp = palette.getByRole('button', { name: 'Stamp', exact: true });
  const pulse = palette.getByRole('button', { name: 'Pulse', exact: true });
  await expect(stamp).toBeEnabled(); await expect(pulse).toBeEnabled();
  await expect(stamp).toHaveAttribute('draggable', 'true');
  // The canvas ignores palette clicks during its list-to-view transition.
  await expect(async () => {
    await stamp.click();
    expect(await appPage.evaluate(() => (window as any).applicationState.system
      .get('default-setup/flows').getSnapshot().context.graph.nodes
      .some((node: { id: string; nodeType?: string; note?: string }) =>
        !node.id.startsWith('temp-') && node.nodeType === 'stamp' && node.note === 'stamped')))
      .toBe(true);
  }).toPass({ timeout: 5_000 });
  const toggle = () => appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
    .send({ type: 'UI.TOGGLE_ENABLED', packId: 'e2e-fixture' }));
  const runtime = await acceptedRuntime(appPage, 'e2e-fixture');
  let disabled = false;
  try {
    await toggle(); disabled = true;
    await frontendUnloaded(appPage, 'e2e-fixture');
    await expect(stamp).toBeVisible(); await expect(stamp).toBeDisabled();
    await expect(pulse).toBeVisible(); await expect(pulse).toBeDisabled();
    await expect(stamp).toHaveAttribute('draggable', 'false');
    await expect(stamp).toHaveClass(/bg-purple-900/);
    await toggle(); disabled = false;
    await frontendAccepted(appPage, 'e2e-fixture', runtime);
    await expect(stamp).toBeEnabled(); await expect(pulse).toBeEnabled();
    await expect(stamp).toHaveAttribute('draggable', 'true');
  } finally {
    if (disabled) { await toggle(); await app.waitForSurface('e2e-fixture/memos'); }
  }
});
