// A push the window stops ends git and the ssh it started, and is answered as stopped rather than as a failure.
// The remote is one that never answers: git's ssh command is a process that waits for as long as its fixture is
// there, and ends by itself when the fixture is deleted. Driven through the code system as a window drives it.
import { afterEach, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileWhileWorking } from '@apackdev/sdk/progress';
import { resetTestData, startApp } from '@apackdev/testing/harness';

const CODE = 'default-setup/code';
const dirs: string[] = [];
const before = process.env.GIT_SSH_COMMAND;
let app: Awaited<ReturnType<typeof startApp>> | undefined;
afterEach(async () => {
  await app?.stop();
  app = undefined;
  resetTestData();
  if (before === undefined) delete process.env.GIT_SSH_COMMAND;
  else process.env.GIT_SSH_COMMAND = before;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const asWindow = { sender: CODE, client: 'c-main' };
const git = (cwd: string, ...args: string[]) =>
  execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** Asks `check` until it holds, for something that happens once another process has done it */
const until = async <T>(check: () => T | undefined): Promise<T> => {
  for (;;) {
    const held = check();
    if (held !== undefined) return held;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
  }
};

it('stops a push that is waiting on the remote, ending git and the ssh it started, and says it was stopped', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-stop-push-')));
  const fixture = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-stop-push-ssh-')));
  dirs.push(directory, fixture);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  fs.writeFileSync(path.join(directory, 'a.txt'), 'one\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'first');
  await git(directory, 'remote', 'add', 'origin', 'ssh://example.invalid/repo.git');
  const pidFile = path.join(fixture, 'pid');
  const helper = path.join(fixture, 'ssh.cjs');
  fs.writeFileSync(helper, `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => { if (!require('fs').existsSync(${JSON.stringify(fixture)})) process.exit(0) }, 100);`);
  const quoted = (file: string) => `"${file.replaceAll('\\', '/')}"`;
  process.env.GIT_SSH_COMMAND = `${quoted(process.execPath)} ${quoted(helper)}`;
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();

  const pushed = await app.send('code', { type: 'commit.PUBLISH_BRANCH' }, asWindow);
  const ssh = await until(() => { const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0; return pid > 0 ? pid : undefined; });
  await app.send('code', { type: 'commit.STOP_PUSH' }, asWindow);

  await app.nextEmit('code', 'commit.PUSH_STOPPED', { answering: pushed });
  await until(() => (alive(ssh) ? undefined : true));
});
