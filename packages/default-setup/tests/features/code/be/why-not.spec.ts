// The panel says why a commit cannot be made: one reason is that git has no name and email to write it with, which
// the status answers. Driven through the code system as a window drives it, over a real repository.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const dirs: string[] = [];
const kept = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const [key, value] of Object.entries(kept)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { sender: CODE, client: 'c-main' };

async function statusOf(directory: string) {
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  const asked = await app.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  return (await app.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: asked })).data as { hasIdentity?: boolean };
}

it('says whether git has a name and an email to commit with', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-why-not-')));
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-why-not-home-')));
  dirs.push(directory, home);
  fs.writeFileSync(path.join(home, 'gitconfig'), '');
  process.env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await execFileWhileWorking('git', ['init', '--quiet', directory], {});

  expect((await statusOf(directory)).hasIdentity).toBe(false);
  await app?.stop();
  app = undefined;

  await execFileWhileWorking('git', ['-C', directory, 'config', 'user.name', 'Someone'], {});
  await execFileWhileWorking('git', ['-C', directory, 'config', 'user.email', 'someone@example.com'], {});
  expect((await statusOf(directory)).hasIdentity).toBe(true);
});
