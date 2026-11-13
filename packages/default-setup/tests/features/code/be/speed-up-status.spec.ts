// Turning git's speed-ups for a status on, which the window asks for when a status was slow: the repository's own
// settings say afterwards what was turned on, the file monitor only where git has one of its own. The repository is
// a real one, driven through the code system as a window drives it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const asWindow = { sender: CODE, client: 'c-main' };
const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', args, { cwd }).catch(() => ({ stdout: '' }))).stdout.trim();

it('turns on the untracked cache, and the file monitor where git has one, in the repository\'s own settings', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-speed-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const call = await app.send('code', { type: 'commit.SPEED_UP_STATUS' }, asWindow);
  const turnedOn = (await app.nextEmit('code', 'commit.STATUS_SPED_UP', { answering: call })).data as { fileMonitor: boolean; untrackedCache: boolean };

  expect(turnedOn.untrackedCache).toBe(true);
  expect(await git(directory, 'config', '--local', 'core.untrackedCache')).toBe('true');
  expect(await git(directory, 'config', '--local', 'core.fsmonitor')).toBe(turnedOn.fileMonitor ? 'true' : '');
  if (process.platform === 'linux') expect(turnedOn.fileMonitor, 'git has no file monitor of its own on Linux').toBe(false);
  if (turnedOn.fileMonitor) await git(directory, 'fsmonitor--daemon', 'stop');
});
