// Which checkout a new session links for a vendored pin, over real repositories made per case.
//
// Real git rather than a table, because what is being asked is git's own: whether a HEAD descends from a commit,
// what `worktree list` reports, and that `worktree add` leaves the checkout someone works in where it was.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutAtPin } from '../../../scripts/lib/pinned-checkout.mjs';

let root: string;
let checkout: string;
const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (message: string): string => {
  fs.writeFileSync(path.join(checkout, 'file'), message);
  git(checkout, 'add', 'file');
  git(checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message);
  return git(checkout, 'rev-parse', 'HEAD');
};

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pinned-checkout-')));
  checkout = path.join(root, 'elmdb');
  fs.mkdirSync(checkout);
  git(checkout, 'init', '-q', '-b', 'main');
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('the checkout linked for a pin', () => {
  it('is the checkout itself when its HEAD holds the pin, ahead of it or not', () => {
    const pin = commit('pinned');
    commit('the next bump, being prepared');

    expect(checkoutAtPin({ checkout, rev: pin })).toEqual({ dir: checkout, made: false });
  });

  /**
   * The case that failed every new session: the checkout someone works in is on a branch of their own, which the
   * pin is not in. A worktree at the pin is made beside it, and the checkout is left where it was.
   */
  it('is a worktree made at the pin when the checkout is on a branch without it, which stays where it was', () => {
    const pin = commit('pinned');
    git(checkout, 'checkout', '-q', '--orphan', 'own-work');
    const own = commit('someone else\'s work, not descended from the pin');

    const { dir, made } = checkoutAtPin({ checkout, rev: pin });

    expect(made).toBe(true);
    expect(dir).toBe(path.join(root, 'elmdb-worktrees.noindex', `for-apack-${pin.slice(0, 7)}`));
    expect(git(dir, 'rev-parse', 'HEAD'), 'the worktree is at the pin').toBe(pin);
    expect(git(checkout, 'rev-parse', 'HEAD'), 'the checkout someone works in did not move').toBe(own);
    expect(git(checkout, 'branch', '--show-current')).toBe('own-work');
  });

  it('is the worktree already at the pin, wherever it is, rather than a second one', () => {
    const pin = commit('pinned');
    const existing = path.join(root, 'made-by-hand');
    git(checkout, 'worktree', 'add', '-q', '--detach', existing, pin);
    git(checkout, 'checkout', '-q', '--orphan', 'own-work');
    commit('own work');

    expect(checkoutAtPin({ checkout, rev: pin })).toEqual({ dir: existing, made: false });
    expect(checkoutAtPin({ checkout, rev: pin.slice(0, 12) }).dir, 'a short pin names it too').toBe(existing);
  });

  it('refuses a commit the checkout cannot get, saying what to do', () => {
    commit('something');
    git(checkout, 'checkout', '-q', '--orphan', 'own-work');
    commit('own work');

    expect(() => checkoutAtPin({ checkout, rev: 'f'.repeat(40) })).toThrow(/has no commit f{40}.*push the pin/);
  });
});
