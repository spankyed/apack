// Scoped resets remove one owner's overrides; resetting everything is a separate host operation.
import { describe, expect, it } from 'vitest';
import { type EARS } from '@apackdev/sdk';
import { untypedQuery } from '@apackdev/sdk/ears';
import { getTestSettings, startApp } from '@apackdev/testing/harness';
import { featureSettings, packSettings } from '#generated/settings.ts';
import { services } from '#generated/services.ts';
import { ref } from '#generated/ref.ts';

const SETTINGS = 'host/settings';
const WINDOW = 'c-window';
const stored = () => untypedQuery.ids('Settings-app' as EARS.EntityId).pickOne(['data'])?.data;

async function reset(target: unknown) {
  const app = await startApp({ systems: [SETTINGS] });
  await app.connect();
  const call = await app.send(SETTINGS, { type: 'RESET_SETTINGS', target }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: SETTINGS, client: WINDOW });
  return app.nextEmit(SETTINGS, 'ASK_ANSWERED', { answering: call });
}

describe('settings reset ownership', () => {
  it('resets one feature and keeps the others', async () => {
    featureSettings.forFeature('threads').set({ path: ['recentThreadsSortOrder'], value: 'created' });
    featureSettings.forFeature('notes').set({ path: ['tasklistPanelPosition'], value: 'right' });

    await reset({ kind: 'feature', featureRef: ref('threads') });

    expect(featureSettings.forFeature('threads').get().recentThreadsSortOrder).not.toBe('created');
    expect(featureSettings.forFeature('notes').get().tasklistPanelPosition).toBe('right');
  });

  it('resets app preferences without resetting feature or pack preferences', async () => {
    services.settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada');
    featureSettings.forFeature('threads').set({ path: ['recentThreadsSortOrder'], value: 'created' });
    packSettings.forGroup('assistant').set({ path: ['name'], value: 'Ada' });

    await reset({ kind: 'app' });

    expect(stored()).not.toHaveProperty('app');
    expect(featureSettings.forFeature('threads').get().recentThreadsSortOrder).toBe('created');
    expect(packSettings.forGroup('assistant').get().name).toBe('Ada');
  });

  it('resets a pack group without resetting app or feature preferences', async () => {
    services.settings.set({ kind: 'app' }, ['personal', 'name'], 'Ada');
    featureSettings.forFeature('notes').set({ path: ['tasklistPanelPosition'], value: 'right' });
    packSettings.forGroup('assistant').set({ path: ['name'], value: 'Assistant' });

    await reset({ kind: 'pack', packId: 'default-setup', groupId: 'assistant' });

    expect(packSettings.forGroup('assistant').get()).toEqual({ name: '' });
    expect(services.settings.get({ kind: 'app' })).toMatchObject({ personal: { name: 'Ada' } });
    expect(featureSettings.forFeature('notes').get().tasklistPanelPosition).toBe('right');
  });

  it('requires an explicit whole-document reset', async () => {
    const app = await startApp({ systems: [SETTINGS] });
    await app.connect();
    featureSettings.forFeature('threads').set({ path: ['recentThreadsSortOrder'], value: 'created' });
    packSettings.forGroup('assistant').set({ path: ['name'], value: 'Assistant' });

    const call = await app.send(SETTINGS, { type: 'RESET_ALL_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: SETTINGS, client: WINDOW });
    await app.nextEmit(SETTINGS, 'ASK_ANSWERED', { answering: call });

    expect(stored()).toEqual({});
  });

  it('refuses a missing target without clearing any preferences', async () => {
    const app = await startApp({ systems: [SETTINGS] });
    await app.connect();
    featureSettings.forFeature('notes').set({ path: ['tasklistPanelPosition'], value: 'right' });
    const before = structuredClone(stored());

    const call = await app.send(SETTINGS, { type: 'RESET_SETTINGS' }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: SETTINGS, client: WINDOW });
    await app.nextEmit(SETTINGS, 'ASK_FAILED', { answering: call });

    expect(stored()).toEqual(before);
  });
});
