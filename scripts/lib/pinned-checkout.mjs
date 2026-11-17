// A vendored checkout that holds its pin, for the checkouts `session:new` and `session:check` make.
//
// **Each linker refuses a checkout that does not hold its pin**, since it could not build what the pin names. The
// default checkout is the one someone works in, so it is on whatever branch their own work is: one not descended
// from the pin made every new session fail before installing anything, for a reason that had nothing to do with
// the session. A worktree of that checkout at the pin answers instead — one already there, or one made beside the
// checkout as `<checkout>-worktrees.noindex/for-apack-<rev>`, the name such worktrees had been made by hand under.
// The checkout someone works in is never moved.
//
// Plain Node with no dependencies, like the linkers: it runs before anything is installed.
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * git in a checkout, answering its output. Bounded and never asking for credentials, for the reason
 * `vendor-pin.mjs` gives: one of these reaches the network, before anything is installed.
 * @param {string} checkout @param {string[]} args @param {number} [timeout]
 */
function git(checkout, args, timeout = 20_000) {
  return execFileSync('git', ['-C', checkout, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

/** Whether `checkout`'s HEAD descends from `rev`, which is what each linker asks @param {string} checkout @param {string} rev */
function holds(checkout, rev) {
  try {
    git(checkout, ['merge-base', '--is-ancestor', rev, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * A worktree of `checkout` whose HEAD is `rev`, from git's own list, or none. A listed worktree whose directory has
 * gone is passed over: git calls it prunable, and there is nothing there to link.
 * @param {string} checkout @param {string} rev @returns {string | undefined}
 */
export function worktreeAt(checkout, rev) {
  for (const block of git(checkout, ['worktree', 'list', '--porcelain']).split('\n\n')) {
    const lines = block.split('\n');
    const dir = lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    const head = lines.find((line) => line.startsWith('HEAD '))?.slice('HEAD '.length);
    if (dir && head?.startsWith(rev) && fs.existsSync(dir)) return dir;
  }
  return undefined;
}

/**
 * The checkout to link for a pin: `checkout` itself when it holds `rev`, else a worktree of it at `rev`, made when
 * there is none. `made` says the second was made here, so a caller knows nothing has been built in it.
 * @param {{ checkout: string, rev: string }} options @returns {{ dir: string, made: boolean }}
 */
export function checkoutAtPin({ checkout, rev }) {
  if (holds(checkout, rev)) return { dir: checkout, made: false };
  const found = worktreeAt(checkout, rev);
  if (found) return { dir: found, made: false };
  const dir = path.join(path.dirname(checkout), `${path.basename(checkout)}-worktrees.noindex`, `for-apack-${rev.slice(0, 7)}`);
  if (fs.existsSync(dir)) {
    throw new Error(`${dir} is where a worktree of ${checkout} at the pin ${rev.slice(0, 12)} would go, and it is something else: move it away, or point the linker at a checkout yourself`);
  }
  // A pin is usually pushed before anyone links it, and a checkout fetched last week does not have it yet
  const has = () => { try { git(checkout, ['cat-file', '-e', `${rev}^{commit}`]); return true; } catch { return false; } };
  if (!has()) {
    try { git(checkout, ['fetch', 'origin', '--quiet'], 120_000); } catch { /* said below, with what to do */ }
    if (!has()) throw new Error(`${checkout} has no commit ${rev}, and fetching its origin did not bring it: push the pin, or fetch it into that checkout`);
  }
  git(checkout, ['worktree', 'add', '--detach', dir, rev], 120_000);
  return { dir, made: true };
}
