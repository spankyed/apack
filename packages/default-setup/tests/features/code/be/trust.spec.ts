// A repository whose own configuration names a program for git to run is not asked anything until the window
// trusts it: the window is told what it would run, and trusting it is remembered in the code settings. The
// repository and the program are real ones, driven through the code system as a window drives it.
import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';
import { featureSettings } from '#generated/settings.ts';

const CODE = 'default-setup/code';
const dirs: string[] = [];
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
const asWindow = { sender: CODE, client: 'c-main' };

/** The code system over a repository whose configuration names a file monitor, which says it ran by making a file */
async function codeOverARepositoryThatRunsAProgram() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-trust-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-trust-program-')));
  dirs.push(directory, outside);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'two\n');
  const program = path.join(outside, 'monitor.sh');
  const ran = path.join(outside, 'ran');
  fs.writeFileSync(program, `#!/bin/sh\necho ran >> '${ran}'\nexit 0\n`);
  fs.chmodSync(program, 0o755);
  await git(directory, 'config', 'core.fsmonitor', program);
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { directory, program, ran: () => fs.existsSync(ran), repository: path.join(directory, '.git') };
}
const askForStatus = () => app!.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);

it('tells the window what the repository would have git run, having run none of it', async () => {
  const { directory, program, ran, repository } = await codeOverARepositoryThatRunsAProgram();

  const asked = await askForStatus();

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: asked })).data).toMatchObject({
    code: 'untrusted',
    trust: { repository, asks: [{ kind: 'setting', key: 'core.fsmonitor', value: program, file: path.join(directory, '.git', 'config') }] },
  });
  expect(ran()).toBe(false);
});

it('reads the repository once the window trusts it, and remembers that in the code settings', async () => {
  const { ran, repository } = await codeOverARepositoryThatRunsAProgram();
  await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: await askForStatus() });

  const trusted = await app!.send('code', { type: 'commit.TRUST_REPOSITORY', repository }, asWindow);
  expect((await app!.nextEmit('code', 'commit.REPOSITORY_TRUSTED', { answering: trusted })).data).toEqual({ repository });

  const status = (await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: await askForStatus() })).data as { files: { path: string }[] };
  expect(status.files.map(file => file.path)).toEqual(['a.txt']);
  expect(ran(), 'git runs what the repository names, as it does in a terminal').toBe(true);
  expect(featureSettings.forFeature('code').get().trustedRepositories).toEqual([repository]);
});

// The path arrives from a window: trust is given to the repository the panel is over, and to no other by name
it('does not trust a repository other than the one it is showing', async () => {
  const { ran } = await codeOverARepositoryThatRunsAProgram();

  const trusted = await app!.send('code', { type: 'commit.TRUST_REPOSITORY', repository: '/somewhere/else/.git' }, asWindow);

  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: trusted })).data).toMatchObject({
    message: 'That is not the repository this panel is showing',
  });
  expect(featureSettings.forFeature('code').get().trustedRepositories).toEqual([]);
  expect((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: await askForStatus() })).data).toMatchObject({ code: 'untrusted' });
  expect(ran()).toBe(false);
});
