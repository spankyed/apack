import { featureSettings } from '#generated/settings.ts';
// Testing a CLI provider belongs to the code feature: `resolve-cli` is its own, and so are the stored paths
// (`features['default-setup/code'].cliPaths`). The Settings view asks for it and is told the result, which is why
// the settings surface declares it in its inbox (`accepts`, beside the surface). It lived in the settings system until settings
// became the app's.
//
// What this covers is the system's part: who is answered, and what is stored. Whether a CLI is installed on this
// machine is not, so the known provider is pointed at a program every test run has — the Node running it, which
// answers `--version` — and nothing of the machine's own is looked for or run.
import { describe, expect, it } from 'vitest';
import { startApp } from '@apackdev/testing/harness';

const cliPaths = () => featureSettings.forFeature('code').get().cliPaths ?? {};

describe('TEST_CLI_PROVIDER', () => {
  // A name no CLI answers to is the user's to fix, so it is answered rather than reported as a system error
  it('answers an unknown provider on the settings surface, and stores nothing', async () => {
    const app = await startApp({ systems: ['code', 'host/settings'] });
    await app.connect();

    await app.send('code', { type: 'TEST_CLI_PROVIDER', provider: 'not-a-cli' });

    expect(await app.nextEmit('host/settings', 'CLI_TEST_RESULT')).toMatchObject({
      type: 'CLI_TEST_RESULT', provider: 'not-a-cli', success: false, error: 'Unknown CLI provider: not-a-cli',
    });
    expect(cliPaths()['not-a-cli']).toBeUndefined();
  });

  // The code system takes the event, and its answer reaches the settings surface rather than its own
  it('tests a known provider at its stored path, answers the settings surface and keeps the path', async () => {
    const app = await startApp({ systems: ['code', 'host/settings'] });
    await app.connect();
    featureSettings.forFeature('code').set({ path: ['cliPaths', 'gh'], value: process.execPath });

    await app.send('code', { type: 'TEST_CLI_PROVIDER', provider: 'gh' });

    expect(await app.nextEmit('host/settings', 'CLI_TEST_RESULT')).toMatchObject({
      type: 'CLI_TEST_RESULT', provider: 'gh', success: true, resolvedPath: process.execPath,
    });
    expect(app.emitted('code').filter((e) => e.type === 'CLI_TEST_RESULT')).toEqual([]);
    expect(cliPaths().gh).toBe(process.execPath);
  });
});
