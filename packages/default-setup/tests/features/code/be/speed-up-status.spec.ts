// Turning git's speed-ups for a status on, which the window asks for when a status was slow: the repository's own
// settings say afterwards what was turned on, the file monitor only where git has one of its own. The repository is
// a real one, driven through the code system as a window drives it.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { answered } from './_support/asks.ts';

const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;

// **Every git this file's process runs is told the file monitor is off, on its command line**, which outranks the
// repository's own settings, so no status ever starts git's monitor daemon. Once a repository's settings turn the
// monitor on, any status starts one, detached from everything here, so no pid of it is ever held; and
// `git fsmonitor--daemon stop` cannot end it either: sent before the daemon listens it does nothing, and it waits,
// without bound, until no daemon listens, so the status the app runs beside it starts another and the stop never
// returns. What this file asks of the repository is its settings, which `--local` reads from its own file,
// beneath the command line.
beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_COUNT', '1');
  vi.stubEnv('GIT_CONFIG_KEY_0', 'core.fsmonitor');
  vi.stubEnv('GIT_CONFIG_VALUE_0', 'false');
});
afterEach(async () => {
  await app?.stop();
  app = undefined;
  vi.unstubAllEnvs();
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const asWindow = { client: 'c-main' };
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

  const call = app.ask('code', { type: 'commit.SPEED_UP_STATUS' }, asWindow);
  const turnedOn = (await answered(call)) as { fileMonitor: boolean; untrackedCache: boolean };

  expect(turnedOn.untrackedCache).toBe(true);
  expect(await git(directory, 'config', '--local', 'core.untrackedCache')).toBe('true');
  expect(await git(directory, 'config', '--local', 'core.fsmonitor')).toBe(turnedOn.fileMonitor ? 'true' : '');
  if (process.platform === 'linux') expect(turnedOn.fileMonitor, 'git has no file monitor of its own on Linux').toBe(false);
});
