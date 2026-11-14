// API keys in default-setup: the settings system refreshes its surface when the host's stored keys change
// (never with values). CLI paths live in
// the code surface.
import { describe, expect, it } from 'vitest';
import { getTestSettings, addTestSecret, startApp, takeSystemErrors } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';

describe('settings and stored API keys', () => {
  it('sends its surface the keys without values when the stored keys change', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    expect(app.emitted('host/settings').filter((e) => e.type === 'SECRETS_UPDATED').at(-1)).toMatchObject({ secrets: [] });

    const work = addTestSecret('anthropic', 'Work');
    await app.send('host/settings', { type: 'SECRETS_CHANGED' }, { settingsAccess: { kind: 'host', service: getTestSettings() } });

    const updated = app.emitted('host/settings').filter((e) => e.type === 'SECRETS_UPDATED').at(-1)!;
    expect(updated).toMatchObject({ secrets: [{ id: work.id, provider: 'anthropic', label: 'Work', selected: true }], status: { protection: 'os-keystore' } });
    expect(JSON.stringify(updated)).not.toContain('value');
  });

  it("stores a CLI path override on the code surface's settings", async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'default-setup/code' }, path: ['cliPaths'], value: { git: '/opt/bin/git' } }, { settingsAccess: { kind: 'host', service: getTestSettings() } });
    expect(featureSettings.forFeature('code').get()).toMatchObject({ cliPaths: { git: '/opt/bin/git' } });
  });

  // A feature settings change reaches the surface identified by its qualified ref
  it('tells the surface whose settings changed', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'default-setup/code' }, path: ['mdEditorDefault'], value: false }, { settingsAccess: { kind: 'host', service: getTestSettings() } });
    const updated = await app.nextEmit('code', 'FEATURE_SETTINGS_UPDATED');
    expect(updated).toMatchObject({ type: 'FEATURE_SETTINGS_UPDATED', settings: { mdEditorDefault: false } });
  });

  // The frontend resolves a feature name before sending; an unqualified ref reaching the system
  // would be written under a key no surface reads, so it is reported and nothing is saved
  it('refuses an unqualified feature target, saving nothing', async () => {
    const app = await startApp({ systems: ['host/settings'] });
    await app.connect();
    await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'code' }, path: ['cliPaths'], value: { git: '/elsewhere/git' } }, { settingsAccess: { kind: 'host', service: getTestSettings() } });
    // The sender's mistake to fix, which its form shows: not a system error
    expect(app.emitted('host/settings')).toContainEqual(expect.objectContaining({
      type: 'SETTINGS_REFUSED',
      problems: [expect.stringContaining('settings target')],
    }));
    expect(takeSystemErrors()).toEqual([]);
    expect(featureSettings.forFeature('code').get()).not.toMatchObject({ cliPaths: { git: '/elsewhere/git' } });
  });
});
