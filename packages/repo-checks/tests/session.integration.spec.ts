import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { createSession, prepareIntegration } from '../../../scripts/session.mjs';
import { checkoutProfile, withCheckoutProfile } from '../../../scripts/lib/dev-profile.mjs';

let dir: string;
let repo: string;
let elmdb: string;
const execFileAsync = promisify(execFile);
const RUN = { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 } as const;
const git = async (root: string, ...args: string[]) => (await execFileAsync('git', args, { cwd: root, ...RUN })).stdout.trim();
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-session-test-'));
  repo = path.join(dir, 'repo');
  fs.mkdirSync(repo);
  await git(repo, 'init', '-b', 'main');
  await git(repo, 'config', 'user.name', 'Session test');
  await git(repo, 'config', 'user.email', 'session@example.invalid');
  // The elmdb checkout a session links: one commit, a manifest naming elmdb and a built binding
  elmdb = path.join(dir, 'elmdb');
  fs.mkdirSync(path.join(elmdb, 'crates', 'elmdb-node'), { recursive: true });
  fs.writeFileSync(path.join(elmdb, 'crates', 'elmdb-node', 'package.json'), JSON.stringify({ name: 'elmdb' }));
  fs.writeFileSync(path.join(elmdb, 'crates', 'elmdb-node', 'elmdb.node'), '');
  await git(elmdb, 'init', '-b', 'main');
  await git(elmdb, 'add', '.');
  await git(elmdb, '-c', 'user.name=Session test', '-c', 'user.email=session@example.invalid', 'commit', '-m', 'elmdb');
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base');
  fs.mkdirSync(path.join(repo, 'vendor'));
  fs.writeFileSync(path.join(repo, 'vendor', 'elmdb.rev'), `${await git(elmdb, 'rev-parse', 'HEAD')}\n`);
  // As the repo's own does: the link is the checkout's, never a change to it
  fs.writeFileSync(path.join(repo, '.gitignore'), 'vendor/elmdb\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'Base');
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function branch(name: string, file = `${name}.txt`, value = name) {
  await git(repo, 'switch', '-c', name, 'main');
  fs.writeFileSync(path.join(repo, file), value);
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', name);
  await git(repo, 'switch', 'main');
}

/** Real Git and process boundaries, with only the expensive dependency install/chain replaced. */
async function check(mode = '', args = ['check', 'first']): Promise<{ status: number; stdout: string; stderr: string }> {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const npm = path.join(bin, 'npm');
  fs.writeFileSync(npm, `#!${process.execPath}
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
fs.appendFileSync(process.env.SESSION_COMMANDS, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
if (process.env.SESSION_MODE === 'setup-fail') process.exit(9);
if (process.argv[3] === 'chain') {
  if (process.env.SESSION_MODE === 'fail') process.exit(9);
  if (process.env.SESSION_MODE === 'drift') fs.writeFileSync('unexpected.txt', 'changed');
  if (process.env.SESSION_MODE === 'advance') execFileSync('git', ['update-ref', 'refs/heads/first', 'main'], { cwd: process.env.SESSION_SOURCE });
}
`);
  fs.chmodSync(npm, 0o755);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(REPO_ROOT, 'scripts/session.mjs'), ...args], {
      cwd: repo, ...RUN, env: {
        ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        SESSION_MODE: mode, SESSION_COMMANDS: path.join(dir, 'commands'), SESSION_SOURCE: repo, ELMDB_DIR: elmdb,
      },
    });
    return { status: 0, stdout, stderr };
  } catch (err: any) {
    // An exit status is the answer under test; a timeout, a signal or a failed spawn has none
    if (typeof err.code !== 'number') throw err;
    return { status: err.code, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('isolated editing sessions', () => {
  it('separates files, index and profiles while canonical paths share their own identity', async () => {
    const one = createSession(repo, 'one');
    const two = createSession(repo, 'two');
    expect(path.dirname(one)).not.toBe(repo);
    fs.writeFileSync(path.join(one, 'base.txt'), 'one');
    await git(one, 'add', '.');
    expect(await git(repo, 'status', '--porcelain')).toBe('');
    expect(await git(two, 'status', '--porcelain')).toBe('');
    expect(checkoutProfile(repo)).toBe('development');
    expect(checkoutProfile(one)).not.toBe(checkoutProfile(two));
    const alias = path.join(dir, 'alias');
    fs.symlinkSync(one, alias);
    expect(checkoutProfile(alias)).toBe(checkoutProfile(one));
    expect(withCheckoutProfile(one, ['--state'], {})).toEqual(['--state', '--profile', checkoutProfile(one)]);
    for (const flags of [['--profile', 'custom'], ['--profile=custom'], ['--fresh', '--rm'], ['--data-dir', '/custom']]) {
      expect(withCheckoutProfile(one, flags, {})).toEqual(flags);
    }
    expect(withCheckoutProfile(one, ['--state'], { APACK_USER_DATA_DIR: '/custom' })).toEqual(['--state']);
    expect(() => createSession(repo, '../escape')).toThrow('session name');
  });

  it('identifies the primary checkout with separately stored Git metadata', async () => {
    await git(repo, 'init', '--separate-git-dir', path.join(dir, 'metadata'));
    await git(repo, 'config', 'core.worktree', repo);
    expect(checkoutProfile(repo)).toBe('development');
    const session = createSession(repo, 'separate');
    expect(session).toBe(fs.realpathSync(path.join(dir, 'repo-worktrees.noindex', 'separate')));
    expect(checkoutProfile(session)).toMatch(/^worktree-/);
    expect(createSession(session, 'from-linked')).toBe(path.join(path.dirname(session), 'from-linked'));
  });

  it('inserts profile options before the positional delimiter', async () => {
    expect(withCheckoutProfile(repo, ['export', '--', 'backup'], {}))
      .toEqual(['export', '--profile', 'development', '--', 'backup']);
    expect(withCheckoutProfile(repo, ['--', '--profile=filename'], {}))
      .toEqual(['--profile', 'development', '--', '--profile=filename']);
    expect(withCheckoutProfile(repo, ['--profile', 'custom', '--', 'backup'], {}))
      .toEqual(['--profile', 'custom', '--', 'backup']);
  });

  it('merges committed branches in a detached candidate without touching source branches or indexes', async () => {
    await branch('first');
    await branch('second');
    const refs = await git(repo, 'show-ref');
    const { dir: candidate, inputs } = prepareIntegration(repo, ['first', 'second']);
    expect(fs.readFileSync(path.join(candidate, 'first.txt'), 'utf8')).toBe('first');
    expect(fs.readFileSync(path.join(candidate, 'second.txt'), 'utf8')).toBe('second');
    expect(await git(candidate, 'branch', '--show-current')).toBe('');
    expect(inputs.map(input => input.ref)).toEqual(['HEAD', 'first', 'second']);
    expect(await git(repo, 'show-ref')).toBe(refs);
    expect(await git(repo, 'status', '--porcelain')).toBe('');
  });

  it('refuses uncommitted inputs and keeps merge conflicts outside the source checkout', async () => {
    fs.writeFileSync(path.join(repo, 'base.txt'), 'dirty');
    expect(() => prepareIntegration(repo, ['main'])).toThrow('Commit your changes');
    await git(repo, 'restore', 'base.txt');
    await branch('first', 'base.txt', 'one');
    await branch('second', 'base.txt', 'two');
    expect(() => prepareIntegration(repo, ['first', 'second'])).toThrow('Merge failed');
    expect(await git(repo, 'status', '--porcelain')).toBe('');
    expect(fs.readFileSync(path.join(repo, 'base.txt'), 'utf8')).toBe('base');
  });

  it('prepares a new session and retains it when dependency setup fails', async () => {
    const result = await check('setup-fail', ['new', 'review']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Checkout retained');
    expect(result.stdout).not.toContain('Ready.');
    const session = path.join(dir, 'repo-worktrees.noindex', 'review');
    expect(await git(session, 'branch', '--show-current')).toBe('session/review');
    expect(fs.realpathSync(path.join(session, 'vendor', 'elmdb'))).toBe(fs.realpathSync(elmdb));
    expect(await git(repo, 'status', '--porcelain')).toBe('');
  });

  it('retains a new session whose elmdb checkout does not hold the pinned commit, before installing anything', async () => {
    fs.writeFileSync(path.join(repo, 'vendor', 'elmdb.rev'), `${'0'.repeat(40)}\n`);
    await git(repo, 'commit', '-am', 'Pin a commit elmdb lacks');
    const result = await check('', ['new', 'review']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/doesn't hold the pinned commit 0{40}.*Checkout retained/);
    expect(fs.existsSync(path.join(dir, 'commands'))).toBe(false);
    expect(await git(path.join(dir, 'repo-worktrees', 'review'), 'branch', '--show-current')).toBe('session/review');
  });

  it('runs dependency installation and the full strict gate in the candidate', async () => {
    await branch('first');
    const result = await check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Combined validation passed');
    const commands = fs.readFileSync(path.join(dir, 'commands'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(commands.map(command => command.args)).toEqual([
      ['ci', '--no-audit', '--no-fund'], ['run', 'build:default-setup'], ['run', 'build:runtime'],
      ['run', 'chain', '--', '--strict', '--all', '--cores', '2'],
    ]);
    expect(commands.every(command => command.cwd !== repo)).toBe(true);
    expect(await git(repo, 'status', '--porcelain')).toBe('');
  });

  it.each([
    ['fail', 'failed'], ['drift', 'candidate changed'], ['advance', 'advanced during validation'],
  ])('never reports success when validation is invalid: %s', async (mode, message) => {
    await branch('first');
    const result = await check(mode);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stdout).not.toContain('Combined validation passed');
  });
});
