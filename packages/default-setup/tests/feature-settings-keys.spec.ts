// Generated handles resolve local names; raw settings targets require qualified owner identities.
import { describe, expect, it, onTestFinished } from 'vitest';
import { type EARS } from '@apackdev/sdk';
import { untypedQuery } from '@apackdev/sdk/ears';
import { getTestSettings, registerPack, startApp, takeSystemErrors, unregisterPack } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';
import { services } from '#generated/services.ts';
import { ref } from '#generated/ref.ts';

const stored = () => untypedQuery.ids('Settings-app' as EARS.EntityId).pickOne(['data'])?.data;

describe('feature settings identities', () => {
  it('resolves local and qualified handles to the same owner', () => {
    featureSettings.forFeature('threads').set({ path: ['recentThreadsSortOrder'], value: 'created' });

    expect(stored()).toEqual({ features: { 'default-setup/threads': { recentThreadsSortOrder: 'created' } } });
    expect(featureSettings.forFeature('default-setup/threads').get().recentThreadsSortOrder).toBe('created');
  });

  it('refuses malformed or unavailable raw targets without writing', () => {
    expect(() => services.settings.get({ kind: 'feature', featureRef: 'threads' as `${string}/${string}` }))
      .toThrow('settings target');
    expect(() => services.settings.get({ kind: 'feature', featureRef: 'default-setup/thread' }))
      .toThrow('settings definition is unavailable');
    expect(() => services.settings.set({ kind: 'feature', featureRef: 'threads' as `${string}/${string}` }, ['sort'], 'oldest'))
      .toThrow('settings target');
    expect(stored()).toBeUndefined();
  });

  it('refuses a client update with an unqualified feature identity', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    const call = await app.send('host/settings', {
      type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'threads' }, path: ['sort'], value: 'oldest',
    }, { settingsAccess: { kind: 'host', service: getTestSettings() }, sender: 'host/settings', client: 'c-window' });

    expect(await app.nextEmit('host/settings', 'ASK_FAILED', { answering: call }))
      .toMatchObject({ failure: { kind: 'refused', problems: [expect.stringContaining('settings target')] } });
    expect(takeSystemErrors()).toEqual([]);
    expect(stored()).toBeUndefined();
  });

  it('does not grant access merely because another pack is registered', () => {
    registerPack({ id: 'memo-pack', features: { memos: { settings: { defaults: {}, schema: { type: 'object' } } } } });
    onTestFinished(() => unregisterPack('memo-pack'));
    const target = { kind: 'feature', featureRef: 'memo-pack/memos' } as const;

    expect(() => services.settings.get(target)).toThrow('does not depend on settings owner "memo-pack"');
    expect(() => services.settings.set(target, ['sort'], 'oldest')).toThrow('does not depend on settings owner "memo-pack"');
    expect(() => services.settings.reset(target)).toThrow('does not depend on settings owner "memo-pack"');
    expect(stored()).toBeUndefined();
  });
});

it('rejects misspelled generated feature handles at compile time', () => {
  const typed = (): void => {
    // @ts-expect-error no settings definition has this name
    featureSettings.forFeature('nots');
    // @ts-expect-error a raw target requires a qualified feature identity
    services.settings.get({ kind: 'feature', featureRef: 'threads' });
  };
  expect(ref('notes')).toBe('default-setup/notes');
  expect(typeof typed).toBe('function');
});
