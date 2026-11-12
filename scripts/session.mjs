import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { linkElmdb } from './link-elmdb.mjs';
import { linkApackTerminal } from './link-apack-terminal.mjs';
import { linkApackGit } from './link-apack-git.mjs';
import { primaryWorktree } from './lib/worktrees.mjs';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Worktrees live outside the main checkout; dependencies and generated output are never shared. The directory's
 * `.noindex` suffix keeps Spotlight from indexing each fresh `node_modules`: on macOS that indexing slowed a new
 * worktree's runs severalfold and held Electron's shutdown past Playwright's teardown deadline
 * (docs/archive/references/evidence/build-input-snapshot-proof.md, "Electron exit hang in linked worktrees").
 * @param {string} root
 */
function worktreesRoot(root) {
  const main = primaryWorktree(root);
  const dir = path.join(path.dirname(main), `${path.basename(main)}-worktrees.noindex`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** @param {string} root @param {string} name @param {string} base */
export function createSession(root, name, base = 'HEAD') {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('Use a session name containing lowercase letters, numbers and hyphens.');
  const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const dir = path.join(worktreesRoot(root), name);
  git(root, ['worktree', 'add', '-b', `session/${name}`, dir, commit]);
  return dir;
}

/** Pin the exact inputs and merge them in a detached candidate without changing any source branch. @param {string} root @param {string[]} refs */
export function prepareIntegration(root, refs) {
  if (!refs.length) throw new Error('Name at least one committed branch to combine with this checkout’s HEAD.');
  if (git(root, ['status', '--porcelain'])) throw new Error('Commit your changes before checking integration; only committed code is merged.');
  const inputs = ['HEAD', ...refs].map(ref => ({ ref, commit: git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]) }));
  const dir = mkdtempSync(path.join(worktreesRoot(root), 'integration-'));
  git(root, ['worktree', 'add', '--detach', dir, inputs[0].commit]);
  console.log(`Integration checkout: ${dir}`);
  console.log(inputs.map(({ ref, commit }) => `  ${ref}: ${commit}`).join('\n'));
  try {
    for (const { commit } of inputs.slice(1)) git(dir, ['merge', '--no-ff', '--no-edit', commit]);
  } catch (error) {
    throw new Error(`Merge failed. Resolve or inspect it in ${dir}. Source branches are unchanged.`, { cause: error });
  }
  return { dir, inputs, commit: git(dir, ['rev-parse', 'HEAD']) };
}

/**
 * Keeps what a passed check has to show and gives its checkout back: the chain's evidence is copied beside the
 * checkout that asked, and the candidate — a whole install and a built app — is removed.
 *
 * **A candidate that passed has nothing left to inspect, and nothing else ever removed one.** Each is a gigabyte
 * or two, and nine had collected beside the checkouts that made them. What a pass leaves worth keeping is what
 * the chain wrote about its steps, which is megabytes; a candidate that failed is kept whole, since the failure is in it.
 * @param {string} root @param {{ dir: string; commit: string }} candidate @returns {string} where the evidence is
 */
export function settleCandidate(root, candidate) {
  const evidence = path.join(root, '.apack', 'session-check', candidate.commit.slice(0, 12));
  const runs = path.join(candidate.dir, 'node_modules', '.cache', 'apack-chain', 'runs');
  mkdirSync(evidence, { recursive: true });
  if (existsSync(runs)) cpSync(runs, evidence, { recursive: true });
  try {
    git(root, ['worktree', 'remove', '--force', candidate.dir]);
  } catch {
    // Git stops at the first file it cannot remove, and a captured compiler's tree is read-only by design
    makeWritable(candidate.dir);
    rmSync(candidate.dir, { recursive: true, force: true });
    git(root, ['worktree', 'prune']);
  }
  return evidence;
}

/** Lets a tree be removed: every directory under `dir` made writable by its owner. @param {string} dir */
function makeWritable(dir) {
  if (!existsSync(dir) || lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir)) makeWritable(path.join(dir, entry));
}

/** How long a whole strict chain may run on the clock, before any wait for another checkout's */
const CHAIN_WALL_MS = 7_200_000;

/** @param {string} dir @param {string[]} args */
async function npm(dir, args) {
  const { boundedSpawn } = await tsImport('./lib/bounded-spawn.ts', import.meta.url);
  const { BUDGET_MS } = await tsImport('./lib/step-budgets.ts', import.meta.url);
  const { MACHINE_WAIT_MS } = await tsImport('./lib/machine-lock.ts', import.meta.url);
  // The full strict chain contains the complete acceptance pools; it is not one install scenario. It may wait for another
  // checkout's chain on the way, doing nothing for as long, so its own steps' watchdogs are what catch a hang in it
  const chain = args.includes('chain');
  // A whole chain is bounded on the clock (`idleMs: false` below), so by a wall time of its own: two hours of steps
  // and the wait. A class is a budget of CPU, which is what the install below is given
  const budget = chain ? CHAIN_WALL_MS + MACHINE_WAIT_MS : BUDGET_MS.suite.ms;
  const result = await boundedSpawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, budget, {
    cwd: dir, stream: true, ...(chain ? { idleMs: false } : {}), shell: process.platform === 'win32', env: { ...process.env, NODE_ENV: 'development' },
  });
  if (result.code !== 0) {
    const why = result.timedOut ? 'timed out' : `failed (exit ${result.code})`;
    throw new Error(`npm ${args.join(' ')} ${why}. Checkout retained at ${dir}.`);
  }
}

/** A cold checkout needs API declarations and pack codegen before typechecks or a built app launch. @param {string} dir */
async function setup(dir) {
  // **Every vendored checkout, because `npm ci` will not say one is missing.** A `file:` dependency whose
  // target is absent installs as a dangling symlink and exits 0, so a worktree without these links fails
  // later and elsewhere: `apack-terminal` is a declared dependency of `@apackdev/host` and the API, and
  // without it `typecheck:host` cannot resolve the broker's protocol types — which is the first leg of the
  // strict chain `session:check` runs, on every branch. The view the built-in pack draws a terminal with is
  // a package of that same checkout, which its linker builds; without it the pack does not build. The pack's
  // git engine is the third, and its linker builds it for the same reason.
  try {
    linkElmdb(dir);
    linkApackTerminal(dir);
    linkApackGit(dir);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}. Checkout retained at ${dir}.`, { cause: error });
  }
  await npm(dir, ['ci', '--no-audit', '--no-fund']);
  await npm(dir, ['run', 'build:default-setup']);
  await npm(dir, ['run', 'build:runtime']);
}

async function main() {
  const [operation, ...args] = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || !operation) {
    console.log(`npm run session:new -- <name> [base-ref]
  Creates session/<name> in a separate worktree and installs/builds its own dependencies and app.
npm run session:check -- <branch> [branch...]
  Combines this checkout's HEAD with committed branches in a separate worktree.
  Runs the full strict chain. Does not merge, commit or reset your source branches.
  A pass keeps the chain's evidence under .apack/session-check/ and removes the candidate; a failure keeps the
  candidate for inspection, to be removed with git worktree remove.`);
    return;
  }
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (operation === 'new' && args.length >= 1 && args.length <= 2) {
    const dir = createSession(root, args[0], args[1]);
    console.log(`Session checkout: ${dir}`);
    await setup(dir);
    console.log(`Ready. Continue your editing session in ${dir}.\nRun npm run dev there; its app and driver default to this worktree's profile.`);
  } else if (operation === 'check') {
    const candidate = prepareIntegration(root, args);
    await setup(candidate.dir);
    await npm(candidate.dir, ['run', 'chain', '--', '--strict', '--all', '--cores', '2']);
    if (git(candidate.dir, ['rev-parse', 'HEAD']) !== candidate.commit || git(candidate.dir, ['status', '--porcelain'])) {
      throw new Error(`The candidate changed during validation. Inspect ${candidate.dir} and rerun before merging.`);
    }
    for (const { ref, commit } of candidate.inputs) {
      if (git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]) !== commit) {
        throw new Error(`${ref} advanced during validation. Rerun session:check with the new commits.`);
      }
    }
    const evidence = settleCandidate(root, candidate);
    console.log(`Combined validation passed: ${candidate.commit}\nChain evidence: ${evidence}\nThe candidate checkout was removed. Source branches are unchanged. Merge these exact inputs, or rerun if they advance.`);
  } else throw new Error('Use session:new -- <name> [base-ref] or session:check -- <branch> [branch...].');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
