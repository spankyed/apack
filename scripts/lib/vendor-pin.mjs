// What a vendored checkout and the commit it is pinned to disagree about.
//
// **A pin is a committed file and the link beside it is not, so nothing ties the two together.** Two things
// follow, and neither is visible where it is caused:
//
//   - The checkout can sit at another commit. A local run then builds the checkout while CI clones the pin,
//     so the two are not testing the same code, and a full local chain can pass against a broker the pin
//     does not name.
//   - The pinned commit can be one no remote holds. CI clones each vendored checkout at its pin, so an
//     unpushed one fails there and nowhere else.
//
// Both are **reported, not refused.** Being ahead of a pin is ordinary while the next bump is being prepared,
// and a linker that refused it would stop the very work about to fix it. The ancestry check in each linker
// stays a refusal, because a checkout that does not hold the pin at all cannot build it.
//
// Plain Node with no dependencies, like the linkers that call it: they run before anything is installed.
import { execFileSync } from 'node:child_process';

/**
 * Runs git in a checkout and answers its output. Throws as git does, which every caller here catches.
 * @param {string} checkout
 */
export function gitIn(checkout) {
  return (/** @type {string[]} */ args) =>
    execFileSync('git', ['-C', checkout, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // **Bounded, and never asking.** One of these commands reaches the network, and git asks for
      // credentials on `/dev/tty` rather than stdin, writing the prompt to the stderr discarded here — so a
      // remote that wants auth, or a connect that stalls, left `npm run link:elmdb` hanging with nothing on
      // screen, in the command a new checkout runs before anything is installed. Both turn into the
      // "could not reach the remote" warning this file already words.
      timeout: FETCH_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
}

/** How long a git command here may take; it is a bound on a hang, not a measurement of a fetch */
const FETCH_MS = 20_000;

/**
 * The remote-tracking branches of `remote` that hold `rev`.
 *
 * `->` filters the symbolic `origin/HEAD` line, which names another branch rather than holding anything.
 * @param {(args: string[]) => string} run @param {string} rev @param {string} remote
 */
function branchesHolding(run, rev, remote) {
  try {
    return run(['branch', '-r', '--contains', rev])
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${remote}/`) && !line.includes('->'));
  } catch {
    // git refuses for a commit this checkout does not have, which each linker's ancestry check already
    // refused with a better message
    return [];
  }
}

const short = (/** @type {string} */ rev) => rev.slice(0, 12);

/**
 * What is worth saying about a vendored checkout's pin, as lines to warn with. Empty when the checkout sits
 * at the pin and the pin is pushed.
 * @param {{ name: string, rev: string, checkout: string, remote?: string, run: (args: string[]) => string }} options
 * @returns {string[]}
 */
export function pinWarnings({ name, rev, checkout, remote = 'origin', run }) {
  /** @type {string[]} */
  const warnings = [];
  const revFile = `vendor/${name}.rev`;

  let head;
  try { head = run(['rev-parse', 'HEAD']).trim(); } catch { head = undefined; }
  if (head !== undefined && head !== rev) {
    let ahead = '';
    try { ahead = run(['rev-list', '--count', `${rev}..HEAD`]).trim(); } catch { /* histories that do not meet */ }
    const past = ahead && ahead !== '0' ? `${ahead} commit${ahead === '1' ? '' : 's'} past` : 'not at';
    warnings.push(
      `${checkout} is at ${short(head)}, ${past} the pinned ${short(rev)} (${revFile}).\n`
      + `  A local run builds the checkout; CI clones the pin, so they are not testing the same code.\n`
      + `  git -C ${checkout} checkout ${short(rev)}   to match it, or bump ${revFile}.`,
    );
  }

  // Asked without the network first, because the usual answer is already here in the remote-tracking refs
  if (branchesHolding(run, rev, remote).length > 0) return warnings;

  let reached = true;
  try { run(['fetch', remote, '--quiet']); } catch { reached = false; }
  if (!reached) {
    warnings.push(
      `Could not reach ${remote}, so whether the pinned ${short(rev)} is pushed is unknown — this says neither.\n`
      + `  CI clones ${name} at the pin, so an unpushed one fails there and nowhere else.`,
    );
    return warnings;
  }
  if (branchesHolding(run, rev, remote).length === 0) {
    warnings.push(
      `The pinned ${short(rev)} (${revFile}) is on no branch of ${remote}.\n`
      + `  CI clones ${name} at the pin, so no run on this pin can fetch it: push that commit, or pin one that is.`,
    );
  }
  return warnings;
}
