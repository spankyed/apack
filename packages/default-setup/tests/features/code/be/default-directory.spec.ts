// The code surface's `defaultBaseDirectory` is where the explorer opens. Changing it moves the explorer there at once;
// any other change to the code settings, `baseDirectory` included (which the explorer writes itself as the user
// browses), leaves the explorer where the user took it.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { getTestSettings, startApp } from '@apackdev/testing/harness';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-default-dir-'));
  dirs.push(dir);
  return dir;
};
let app: Awaited<ReturnType<typeof startApp>> | undefined;

afterEach(() => {
  app?.stop();
  app = undefined;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const setCodeSetting = (key: string, value: unknown) =>
  app!.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'default-setup/code' }, path: [key], value }, { settingsAccess: { kind: 'host', service: getTestSettings() } });
const explorerDirectory = () => (app!.system('code').getSnapshot().context as { baseDirectory: string | null }).baseDirectory;

describe("the code explorer's directory", () => {
  it('closes real Git watchers when the Code actor stops', async () => {
    const directory = tempDir();
    await execFileWhileWorking('git', ['init', '--quiet', directory]);
    app = await startApp({ systems: ['code', 'host/settings'] });
    await setCodeSetting('defaultBaseDirectory', directory);
    const watcher = app.system('code').getSnapshot().context.gitWatcher;
    await expect.poll(() => watcher.isActive()).toBe(true);
    app.stop();
    await expect.poll(() => watcher.isActive()).toBe(false);
  });

  it('retains the repository and watcher for repeated selection while remembering an explicit choice', async () => {
    app = await startApp({ systems: ['code', 'host/settings'] });
    await app.connect();
    const directory = tempDir();
    await setCodeSetting('defaultBaseDirectory', directory);
    await app.settle();
    const before = app.system('code').getSnapshot().context;
    const refreshes = () => app!.emitted('code').filter(event => event.type === 'pr.STATUS_CHANGED').length;
    const originalRefreshes = refreshes();
    const revision = getTestSettings().getSnapshot().revision;
    expect(getTestSettings().getOverrides().features?.['default-setup/code']).not.toHaveProperty('baseDirectory');

    for (let i = 0; i < 3; i++) {
      await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory, fromUserNavigation: false });
    }
    await app.settle();
    expect(getTestSettings().getSnapshot().revision).toBe(revision);

    await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
    await app.settle();
    expect(getTestSettings().getOverrides().features?.['default-setup/code']).toHaveProperty('baseDirectory', directory);
    const after = app.system('code').getSnapshot().context;
    expect(after.gitRepository).toBe(before.gitRepository);
    expect(after.gitWatcher).toBe(before.gitWatcher);
    expect(refreshes()).toBe(originalRefreshes);
  });

  it('moves when defaultBaseDirectory changes', async () => {
    app = await startApp({ systems: ['code', 'host/settings'] });
    await app.connect();
    const defaultDir = tempDir();

    await setCodeSetting('defaultBaseDirectory', defaultDir);
    await app.settle();

    expect(explorerDirectory()).toBe(defaultDir);
  });

  it('stays where the user browsed when baseDirectory or another setting changes', async () => {
    app = await startApp({ systems: ['code', 'host/settings'] });
    await app.connect();
    const [defaultDir, browsed, elsewhere] = [tempDir(), tempDir(), tempDir()];
    await setCodeSetting('defaultBaseDirectory', defaultDir);
    await app.settle();

    // Browsing writes baseDirectory, so the code system hears its settings changed, with the same default
    await app.send('code', { type: 'SET_BASE_DIRECTORY', path: browsed });
    await app.settle();
    expect(explorerDirectory()).toBe(browsed);

    await setCodeSetting('baseDirectory', elsewhere);
    await setCodeSetting('autoFetchRemote', true);
    await app.settle();

    expect(explorerDirectory()).toBe(browsed);
  });
});
