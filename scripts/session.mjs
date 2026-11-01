import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { linkElmdb } from './link-elmdb.mjs';
import { primaryWorktree } from './lib/worktrees.mjs';

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Worktrees live outside the main checkout; dependencies and generated output are never shared. The directory's
 * `.noindex` suffix keeps Spotlight from indexing each fresh `node_modules`: on macOS that indexing slowed a new
 * worktree's runs severalfold and held Electron's shutdown past Playwright's teardown deadline
 * (docs/references/evidence/build-input-snapshot-proof.md, "Electron exit hang in linked worktrees").
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

/** @param {string} dir @param {string[]} args */
async function npm(dir, args) {
  const { boundedSpawn } = await tsImport('./lib/bounded-spawn.ts', import.meta.url);
  const { TIMEOUT_MS } = await tsImport('./lib/step-timeouts.ts', import.meta.url);
  // The full strict chain contains the complete acceptance pools; it is not one install scenario.
  const budget = args.includes('chain') ? TIMEOUT_MS.acceptance.ms : TIMEOUT_MS.suite.ms;
  const result = await boundedSpawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, budget, {
    cwd: dir, stream: true, shell: process.platform === 'win32', env: { ...process.env, NODE_ENV: 'development' },
  });
  if (result.code !== 0) {
    const why = result.timedOut ? 'timed out' : `failed (exit ${result.code})`;
    throw new Error(`npm ${args.join(' ')} ${why}. Checkout retained at ${dir}.`);
  }
}

/** A cold checkout needs API declarations and pack codegen before typechecks or a built app launch. @param {string} dir */
async function setup(dir) {
  // npm resolves @apackdev/ears' elmdb dependency through the link
  try {
    linkElmdb(dir);
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
  Keeps the candidate and validation evidence for review; remove it with git worktree remove.`);
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
    console.log(`Combined validation passed: ${candidate.commit}\nCandidate and chain evidence: ${candidate.dir}\nSource branches are unchanged. Merge these exact inputs, or rerun if they advance.`);
  } else throw new Error('Use session:new -- <name> [base-ref] or session:check -- <branch> [branch...].');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
