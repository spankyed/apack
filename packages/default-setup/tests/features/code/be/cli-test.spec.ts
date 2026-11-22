import { featureSettings } from '#generated/settings.ts';
import { describe, expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';

const cliPaths = () => featureSettings.forFeature('code').get().cliPaths;

describe('TEST_CLI_PROVIDER', () => {
  it('answers an unknown provider and stores nothing', async () => {
    const app = await startApp({ systems: ['code'] });
    await app.connect();
    const answer = await app.ask('code', { type: 'TEST_CLI_PROVIDER', provider: 'not-a-cli' }, { client: 'c-main' });

    expect(answer).toEqual({
      ok: true, value: { success: false, error: 'Unknown CLI provider: not-a-cli' },
    });
    expect(cliPaths()['not-a-cli']).toBeUndefined();
  });

  it('tests the requested path without replacing a different saved value', async () => {
    const app = await startApp({ systems: ['code'] });
    await app.connect();
    const settings = featureSettings.forFeature('code');
    settings.set({ path: ['cliPaths', 'codex'], value: '/old/location' });
    settings.set({ path: ['cliPaths', 'git'], value: '/another/provider' });

    // Node answers --version, so the test never probes a machine-installed provider.
    const answer = await app.ask('code', {
      type: 'TEST_CLI_PROVIDER', provider: 'codex', path: process.execPath,
    }, { client: 'c-main' });

    expect(answer).toEqual({ ok: true, value: { success: true, resolvedPath: process.execPath } });
    expect(cliPaths()).toMatchObject({ codex: '/old/location', git: '/another/provider' });

    settings.set({ path: ['cliPaths', 'codex'], value: process.execPath });
    await expect(app.ask('code', {
      type: 'TEST_CLI_PROVIDER', provider: 'codex', path: process.execPath,
    }, { client: 'c-main' })).resolves.toEqual(answer);
    expect(cliPaths()).toMatchObject({ codex: process.execPath, git: '/another/provider' });
  });
});
