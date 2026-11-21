// The trailers at the end of the message the commit panel commits, driven through the code system as a window drives
// it, over a real repository: what the window is told they are, one taken out when asked, and the ones the code
// settings name (`trailersRemovedOnCommit`) left out of what is committed or amended.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';
import { answered } from './_support/asks.ts';

const asWindow = { client: 'c-main' };
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]) =>
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();

/** The code system over a repository with one commit and a change to it staged */
async function staged() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-trailers-')));
  dirs.push(directory);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'two\n');
  await git(directory, 'add', '.');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { app, directory, lastMessage: () => git(directory, 'log', '-1', '--format=%B') };
}

const MESSAGE = 'feat: a thing\n\nWhy it is done.\n\nCo-authored-by: Agent <agent@example.com>\nSigned-off-by: Test <test@example.com>';

it('commits without the trailers the settings name, Co-authored-by unless they say otherwise, and says what it committed', async () => {
  const { app, lastMessage } = await staged();

  const committed = app.ask('code', { type: 'commit.COMMIT', message: MESSAGE }, asWindow);

  const kept = 'feat: a thing\n\nWhy it is done.\n\nSigned-off-by: Test <test@example.com>';
  expect((await answered(committed)).message).toBe(kept);
  expect(await lastMessage()).toBe(kept);
});

it('commits every trailer when the settings name none', async () => {
  const { app, lastMessage } = await staged();
  featureSettings.forFeature('code').set({ path: ['trailersRemovedOnCommit'], value: [] });

  const committed = app.ask('code', { type: 'commit.COMMIT', message: MESSAGE }, asWindow);

  await answered(committed);
  expect(await lastMessage()).toBe(MESSAGE);
});

it('amends with a message without the trailers the settings name, whatever the case of their keys', async () => {
  const { app, lastMessage } = await staged();
  featureSettings.forFeature('code').set({ path: ['trailersRemovedOnCommit'], value: ['SIGNED-OFF-BY'] });

  const amended = app.ask('code', { type: 'commit.AMEND', message: MESSAGE }, asWindow);

  await answered(amended);
  expect(await lastMessage()).toBe('feat: a thing\n\nWhy it is done.\n\nCo-authored-by: Agent <agent@example.com>');
});

it('tells the window the trailers of the message it names, and takes the one it names out of that message', async () => {
  const { app } = await staged();
  const message = 'feat: a thing\n\nCo-authored-by: A <a@example.com>\nCo-authored-by: B <b@example.com>';

  const read = app.ask('code', { type: 'commit.READ_TRAILERS', message }, asWindow);
  expect(await answered(read)).toEqual({
    message,
    trailers: [{ key: 'Co-authored-by', value: 'A <a@example.com>' }, { key: 'Co-authored-by', value: 'B <b@example.com>' }],
  });

  const removed = app.ask('code', { type: 'commit.REMOVE_TRAILER', message, trailer: { key: 'Co-authored-by', value: 'A <a@example.com>' } }, asWindow);
  expect(await answered(removed)).toEqual({
    message,
    without: 'feat: a thing\n\nCo-authored-by: B <b@example.com>',
  });
});
