// What no file event reported is found by reading again, when something says a change is likely. A directory
// that is not a repository has no watch at all, so whatever these cases see was found by the reconcile.
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { getTestSettings, resetTestData, startApp } from '@apackdev/testing/harness';
import { recordingBroker } from './_support/terminal-broker.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The code system over a directory that is in no repository */
async function codeOverPlainDirectory() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-external-')));
  dirs.push(directory);
  const broker = recordingBroker();
  app = await startApp({ systems: ['code', 'host/settings'] });
  await app.connect();
  await app.send('host/settings', { type: 'UPDATE_SETTINGS', target: { kind: 'feature', featureRef: 'default-setup/code' }, path: ['defaultBaseDirectory'], value: directory }, { settingsAccess: { kind: 'host', service: getTestSettings() } });
  await app.settle();
  await expect.poll(() => app!.system('code').getSnapshot().context.gitWatcher?.isActive()).toBe(true);
  return { directory, broker };
}
const announcements = () => app!.emitted('code').filter(event => event.type === 'commit.REPOSITORY_CHANGED').length;

describe('a change no file event reported', () => {
  it('is announced when the code system is asked to check', async () => {
    const { directory } = await codeOverPlainDirectory();
    await execFileWhileWorking('git', ['init', '--quiet', directory]);
    expect(announcements()).toBe(0);

    await app!.send('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' });
    await expect.poll(announcements).toBe(1);
  });

  it('to a file open in an editor is announced under the path it was opened by', async () => {
    const { directory } = await codeOverPlainDirectory();
    const file = path.join(directory, 'notes.txt');
    fs.writeFileSync(file, 'one\n');
    await app!.send('code', { type: 'explorer.READ_FILE', path: file }, { sender: 'default-setup/code', client: 'c-main' });
    await app!.nextEmit('code', 'explorer.FILE_CONTENT');

    // Each round is a change of its own, so the round the watcher first looked at the file in does not matter
    await expect.poll(async () => {
      fs.appendFileSync(file, 'more\n');
      await app!.send('code', { type: 'CHECK_FOR_EXTERNAL_CHANGES' });
      return app!.emitted('code').filter(event => event.type === 'explorer.FILE_CHANGED_EXTERNALLY')
        .map(event => event.data).at(-1);
    }).toMatchObject({ path: file, changeType: 'change' });
  });

  it('is looked for when a terminal command finishes, and not at every prompt', async () => {
    const { directory, broker } = await codeOverPlainDirectory();
    await app!.send('code', { type: 'terminal.CREATE_TERMINAL', title: 'one' });
    await app!.nextEmit('code', 'terminal.CREATED');
    const session = broker.opened[0]!.id;
    await execFileWhileWorking('git', ['init', '--quiet', directory]);
    const prompt = '\x1b]133;A\x07';

    // A prompt with no command before it: the shell starting, or the user pressing return
    broker.emit(session, prompt);
    await app!.settle();
    expect(announcements()).toBe(0);

    broker.reportsRunning(session, true);
    broker.emit(session, '\x1b]133;C\x07');
    await app!.settle();
    broker.reportsRunning(session, false);
    broker.emit(session, prompt);
    await expect.poll(announcements).toBe(1);
  });
});
