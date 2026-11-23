import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '@apackdev/testing';

/**
 * Waits for the Packs surface to report a pack's ownership, by **subscribing** to its actor.
 *
 * A replace or a restore finishes when the backend broadcasts the new pack list, and the surface records
 * it in context — the machine has one `idle` state and tracks progress in `installing`, so there is no
 * transition to await. That left the test sampling, and sampling is where it went wrong: `expect.poll`'s
 * 5s default gave up 28.4s into a run while the app was still working correctly, so the failure was the
 * interval's and not the app's.
 *
 * Subscribing removes the interval rather than tuning it. The actor says when it changed, the predicate
 * is checked on that transition, and the deadline here exists only to name what never arrived — it is
 * not the thing being waited on. Playwright cannot pass a function into the page, so the predicate is
 * written in the evaluated body and parameterised by the value it expects.
 */
async function ownershipBecomes(appPage: Page, expected: string): Promise<void> {
  await appPage.evaluate(([want, ms]) => new Promise<void>((resolve, reject) => {
    const actor = (window as unknown as { applicationState: { system: { get(ref: string): {
      getSnapshot(): { context: { packs: { id: string; updatesWith?: string }[] } };
      subscribe(listener: () => void): { unsubscribe(): void };
    } } } }).applicationState.system.get('host/packs');
    const reading = (): string | undefined =>
      actor.getSnapshot().context.packs.find((pack) => pack.id === 'default-setup')?.updatesWith;
    if (reading() === want) return resolve();
    const timer = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error(`default-setup's updatesWith stayed ${String(reading())} after ${ms}ms, wanted ${want}`));
    }, ms as number);
    const subscription = actor.subscribe(() => {
      if (reading() !== want) return;
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve();
    });
  }), [expected, 20_000] as [string, number]);
}

test('an app default can be disabled, removed and restored while host settings remain usable', async ({ app, appPage }) => {
  await app.navigate('host/packs');
  await expect.poll(() => appPage.evaluate(() => (window as any).applicationState.system
    .get('host/packs').getSnapshot().context.appPackSources.find((source: any) => source.id === 'default-setup')?.sourceRevision)).toBeTruthy();
  const source = await appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
    .getSnapshot().context.appPackSources.find((source: any) => source.id === 'default-setup'));
  let needsRestore = false;
  try {
    await appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
      .send({ type: 'UI.SELECT_PACK', packId: 'default-setup' }));
    await expect(appPage.getByTestId('pack-replacement')).toBeVisible();
    needsRestore = true;
    await appPage.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(appPage.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
    await expect(appPage.getByTestId('pack-replacement')).toBeVisible();
    await appPage.getByRole('button', { name: 'Remove', exact: true }).click();
    await appPage.getByTestId('pack-remove-confirmation').getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(appPage.getByTestId('missing-app-defaults')).toBeVisible();
    await app.navigate('host/settings');
    await expect(appPage.getByRole('button', { name: 'General', exact: true })).toBeVisible();
    await app.navigate('host/packs');
    // The same verified bytes can be deliberately user-owned; ownership is never inferred by equality.
    await appPage.getByRole('combobox', { name: 'Pack operation' }).selectOption('replace');
    await appPage.getByRole('textbox', { name: 'Replacement pack ID' }).fill('default-setup');
    await appPage.getByPlaceholder('owner/repo, owner/repo@tag, or local path')
      .fill(path.join(fileURLToPath(new URL('../../../../..', import.meta.url)), '.temp/shipped-distribution/shipped-packs/default-setup'));
    await appPage.getByRole('button', { name: 'Replace', exact: true }).click();
    await app.waitForSurface('default-setup/threads');
    await ownershipBecomes(appPage, 'user');
    await appPage.getByTestId('pack-restore').click();
    await appPage.getByTestId('pack-confirm-restore').click();
    await app.waitForSurface('default-setup/threads');
    await ownershipBecomes(appPage, 'app');
    expect(await appPage.evaluate(() => (window as any).applicationState.system.get('host/packs')
      .getSnapshot().context.packs.find((pack: any) => pack.id === 'default-setup')?.enabled)).toBe(true);
    needsRestore = false;
  } finally {
    if (needsRestore) {
      await appPage.evaluate(source => (window as any).applicationState.system.get('host/packs')
        .send({ type: 'UI.RESTORE', packId: source.id, sourceRevision: source.sourceRevision }), source);
      await app.waitForSurface('default-setup/threads');
    }
  }
});
