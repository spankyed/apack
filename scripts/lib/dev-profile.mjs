import { hash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { primaryWorktree } from './worktrees.mjs';
import { tsImport } from 'tsx/esm/api';

/** Linked worktrees get stable, separate storage; the main checkout keeps its development profile. */
/** @param {string} root */
export function checkoutProfile(root) {
  const canonical = realpathSync(root);
  if (canonical === primaryWorktree(canonical)) return 'development';
  return `worktree-${hash('sha256', canonical, 'hex').slice(0, 16)}`;
}

/** Explicit profiles, fresh runs and storage overrides still take precedence. */
/** @param {string} root @param {string[]} args @param {NodeJS.ProcessEnv} env */
export function withCheckoutProfile(root, args, env = process.env) {
  const delimiter = args.indexOf('--');
  const options = delimiter < 0 ? args : args.slice(0, delimiter);
  if (env.APACK_USER_DATA_DIR || options.some(arg => /^--(?:profile|fresh|data-dir)(?:=|$)/.test(arg))) return args;
  const profile = ['--profile', checkoutProfile(root)];
  return delimiter < 0 ? [...args, ...profile] : [...options, ...profile, ...args.slice(delimiter)];
}

/** The watch loop and repository driver use the CLI's same named-profile storage. */
/** @param {string} root */
export async function prepareCheckoutProfile(root) {
  if (process.env.APACK_USER_DATA_DIR) return;
  const name = checkoutProfile(root);
  if (name === 'development') return;
  const { openProfile } = await tsImport('../../packages/apack-cli/src/app/profiles.ts', import.meta.url);
  const { cliDirs } = await tsImport('../../packages/apack-cli/src/app/pack-host.ts', import.meta.url);
  const { dir } = openProfile(cliDirs(), name);
  process.env.APACK_USER_DATA_DIR = dir;
  process.env.APACK_SECRETS_VAULT = 'file';
  console.log(`[dev] profile ${name}: ${dir}`);
}
