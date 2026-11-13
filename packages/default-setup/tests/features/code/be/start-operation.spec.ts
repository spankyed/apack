// A merge, a rebase and a cherry-pick begun from the window: each runs clean and can be undone, or stops on a
// conflict, which the status describes and the window can carry on or give up; and the history the window is
// shown holds another branch's commits, to pick from. The repositories are real ones, driven through the code
// system as a window drives it.
import { afterEach, describe, expect, it } from 'vitest';
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
  (await execFileWhileWorking('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd })).stdout.trim();

/**
 * The code system over `main`, with `side` branched from their base: each has a commit of its own, which change
 * `m.txt` both (to conflict) or different files (to go clean)
 */
async function codeOverTwoBranches({ conflicting }: { conflicting: boolean }) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-start-')));
  dirs.push(directory);
  const write = (file: string, content: string) => fs.writeFileSync(path.join(directory, file), content);
  await git(directory, 'init', '--quiet', '--initial-branch=main');
  await git(directory, 'config', 'user.name', 'Test');
  await git(directory, 'config', 'user.email', 'test@example.com');
  write('m.txt', 'base\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'base');
  await git(directory, 'checkout', '--quiet', '-b', 'side');
  write(conflicting ? 'm.txt' : 's.txt', 'side\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'side');
  await git(directory, 'checkout', '--quiet', 'main');
  write('m.txt', 'main\n');
  await git(directory, 'commit', '--quiet', '-am', 'main');
  app = await startApp({ systems: ['code'] });
  await app.connect();
  await app.send('code', { type: 'SET_BASE_DIRECTORY', path: directory });
  await app.settle();
  return { directory, head: () => git(directory, 'rev-parse', 'HEAD'), side: await git(directory, 'rev-parse', 'side') };
}

async function operationNow(): Promise<{ kind: string } | undefined> {
  const call = await app!.send('code', { type: 'commit.GET_GIT_STATUS' }, asWindow);
  return ((await app!.nextEmit('code', 'commit.STATUS_RECEIVED', { answering: call })).data as { operation?: { kind: string } }).operation;
}

const KINDS = ['merge', 'rebase', 'cherry-pick'] as const;
const targetOf = (kind: (typeof KINDS)[number], side: string) => (kind === 'cherry-pick' ? side : 'side');

describe.each(KINDS)('a %s', (kind) => {
  it('runs clean, brings in what the other branch changed, and can be undone', async () => {
    const { directory, head, side } = await codeOverTwoBranches({ conflicting: false });
    const before = await head();

    const call = await app!.send('code', { type: 'commit.START_OPERATION', kind, target: targetOf(kind, side) }, asWindow);

    expect((await app!.nextEmit('code', 'commit.OPERATION_STARTED', { answering: call })).data).toEqual({ kind, target: targetOf(kind, side), stopped: false });
    expect(fs.readFileSync(path.join(directory, 's.txt'), 'utf8')).toBe('side\n');
    expect((await app!.nextEmit('code', 'commit.UNDOABLE_RECEIVED', { answering: call })).data).not.toBeNull();

    const undo = await app!.send('code', { type: 'commit.UNDO_LAST' }, asWindow);
    await app!.nextEmit('code', 'commit.UNDONE', { answering: undo });
    expect(await head(), 'and undoing it puts the branch back').toBe(before);
  });

  it('stops on a conflict, which is in progress until the window gives it up', async () => {
    const { directory, head, side } = await codeOverTwoBranches({ conflicting: true });
    const before = await head();

    const call = await app!.send('code', { type: 'commit.START_OPERATION', kind, target: targetOf(kind, side) }, asWindow);

    expect((await app!.nextEmit('code', 'commit.OPERATION_STARTED', { answering: call })).data).toMatchObject({ kind, stopped: true });
    expect(await operationNow()).toMatchObject({ kind });

    const abort = await app!.send('code', { type: 'commit.MOVE_OPERATION', move: 'abort' }, asWindow);
    await app!.nextEmit('code', 'commit.OPERATION_MOVED', { answering: abort });
    expect(await operationNow()).toBeUndefined();
    expect(await head()).toBe(before);
    expect(fs.readFileSync(path.join(directory, 'm.txt'), 'utf8')).toBe('main\n');
  });
});

it('begins none while another is in progress, and says which', async () => {
  await codeOverTwoBranches({ conflicting: true });
  const first = await app!.send('code', { type: 'commit.START_OPERATION', kind: 'merge', target: 'side' }, asWindow);
  await app!.nextEmit('code', 'commit.OPERATION_STARTED', { answering: first });

  const second = await app!.send('code', { type: 'commit.START_OPERATION', kind: 'rebase', target: 'side' }, asWindow);

  expect(((await app!.nextEmit('code', 'commit.ERROR_RECEIVED', { answering: second })).data as { message: string }).message).toMatch(/merge of side is in progress/);
});

it('says what a merge would do before it is done', async () => {
  await codeOverTwoBranches({ conflicting: true });

  const call = await app!.send('code', { type: 'commit.PREVIEW_MERGE', target: 'side' }, asWindow);

  expect((await app!.nextEmit('code', 'commit.MERGE_PREVIEWED', { answering: call })).data).toEqual({ target: 'side', preview: { kind: 'conflicts', files: ['m.txt'] } });
});

it('shows the window the commits of every local branch, to pick from', async () => {
  const { directory, side } = await codeOverTwoBranches({ conflicting: false });
  // A remote's branch is not among them: a commit only it holds is not shown
  await git(directory, 'checkout', '--quiet', '-b', 'elsewhere', 'main~1');
  fs.writeFileSync(path.join(directory, 'e.txt'), 'e\n');
  await git(directory, 'add', '.');
  await git(directory, 'commit', '--quiet', '-m', 'elsewhere');
  await git(directory, 'update-ref', 'refs/remotes/origin/elsewhere', 'HEAD');
  await git(directory, 'checkout', '--quiet', 'main');
  await git(directory, 'branch', '--quiet', '-D', 'elsewhere');

  const call = await app!.send('code', { type: 'commit.LOG_LIST' }, asWindow);
  const { commits } = (await app!.nextEmit('code', 'commit.LOG_LIST_RECEIVED', { answering: call })).data as { commits: { hash: string; subject: string }[] };

  expect(commits.map(commit => commit.subject).sort()).toEqual(['base', 'main', 'side']);
  expect(commits.map(commit => commit.hash)).toContain(side);
});
