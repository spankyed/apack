import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { parseManifest, type PackManifest } from '@apackdev/sdk/build';
import { settingsDeclarationDiagnostics } from '@apackdev/host/packs';
import { cliDirs } from './app/pack-host';
import { resolveStoredProfile } from './app/profiles';
import { APP_ENVS, parseAppEnv, resolveAppEnvironment, type AppEnv, type AppChannel } from '@apackdev/sdk/env';

/** Data commands may default to the bundled CLI's channel; installed-app commands select production explicitly. */
export const defaultDataEnv = (): AppEnv => parseAppEnv(process.env.APACK_CLI_CHANNEL) ?? 'production';

/** Installed/published app selection never takes a storage or host default. */
export function parseAppChannel(args: string[]): { channel: AppChannel; args: string[] } {
  const allowed = ['production', 'beta', 'preview'] as const;
  const rest: string[] = [];
  let channel: AppChannel | undefined;
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i]!.split(/=(.*)/s, 2);
    if (name !== '--channel') { rest.push(args[i]!); continue; }
    if (channel !== undefined) throw new Error('Specify --channel once.');
    const value = inline ?? args[++i];
    const selected = allowed.find(channel => channel === value);
    if (!selected) throw new Error(`--channel needs one of: ${allowed.join(', ')}`);
    channel = selected;
  }
  return { channel: channel ?? 'production', args: rest };
}

export function parseStorageProfile(args: string[]) {
  const rest: string[] = [];
  let profile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i]!.split(/=(.*)/s, 2);
    if (name === '--data') throw new Error('Use --profile <name> to select stored state.');
    if (name !== '--profile') { rest.push(args[i]!); continue; }
    if (profile !== undefined) throw new Error('Specify --profile once.');
    profile = inline ?? args[++i];
    if (!profile || profile.startsWith('-')) throw new Error('--profile needs a name');
  }
  return { env: APP_ENVS.find(env => env === profile) ?? defaultDataEnv(), profile, args: rest };
}

/** An explicit namespace uses its canonical storage; an unnamed target may honor a caller's data override. */
export function targetDataContext(env: AppEnv, profile?: string) {
  return resolveAppEnvironment({ env, userDataDir: profile === undefined ? undefined : resolveStoredProfile(cliDirs(), profile) });
}

export function profileLabel(env: AppEnv, profile?: string): string {
  if (profile === undefined && env === 'production') return '';
  return ` (profile ${profile ?? env})`;
}

export const TARGET_ENV_USAGE = '--profile <name>  Built-in or custom stored profile; built-ins: ' + APP_ENVS.join(', ');

/**
 * The pack at or above `from`, or undefined.
 *
 * Every command but one wants the throwing form below: they act on a pack, and having none is the end of
 * it. `npm run dev:drive --` is the exception — driving the app with no pack under test is a coherent thing to do,
 * and this is what lets it say so rather than treating it as a failure.
 */
export function findPackRootOrNone(from: string): string | undefined {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'apack.json'))) return dir;
    dir = path.dirname(dir);
  }
  return undefined;
}

export function findPackRoot(from: string): string {
  const root = findPackRootOrNone(from);
  if (root === undefined) throw new Error('No apack.json found. Run this command from inside a pack directory.');
  return root;
}

export function readManifest(root: string): PackManifest {
  return JSON.parse(fs.readFileSync(path.join(root, 'apack.json'), 'utf-8'));
}

/** The pack's manifest, or an error listing why the installer would reject it */
export function readValidManifest(root: string): PackManifest {
  const manifest = readManifest(root);
  const parsed = parseManifest(manifest);
  const diagnostics = parsed.diagnostics.length > 0
    ? parsed.diagnostics
    : settingsDeclarationDiagnostics(manifest);
  if (diagnostics.length > 0) {
    throw new Error(`apack.json is invalid:\n${diagnostics.map(({ message }) => `  - ${message}`).join('\n')}`);
  }
  return manifest;
}

const cliRequire = createRequire(import.meta.url);

/** The @apackdev/sdk package this CLI runs against. */
export function sdkPackageDir(): string {
  return path.dirname(cliRequire.resolve('@apackdev/sdk/package.json'));
}

export function sdkVersion(): string | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(sdkPackageDir(), 'package.json'), 'utf-8')).version;
  } catch {
    return undefined;
  }
}

/** This CLI's bin (from src/ in the workspace, dist/ when published). */
export function cliBin(): string {
  return path.join(import.meta.dirname, '..', 'bin', 'apack.mjs');
}

export function cliVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf-8')).version;
}

/**
 * The vitest CLI the pack resolves. `createRequire` walks up, so this finds a pack's own devDependency and,
 * for a fixture pack inside this monorepo that declares none, the hoisted copy — which is the same binary
 * `tests/scripts/` used to invoke by path.
 */
export function resolveVitestCli(packDir: string): string {
  const from = path.join(packDir, 'package.json');
  let pkgPath: string;
  try {
    pkgPath = createRequire(from).resolve('vitest/package.json');
  } catch {
    throw new Error('vitest is not installed in this pack. Run: npm i -D vitest');
  }
  const bin = (JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { bin?: string | Record<string, string> }).bin;
  const entry = typeof bin === 'string' ? bin : bin?.vitest;
  if (!entry) throw new Error(`The vitest at ${pkgPath} declares no bin`);
  return fs.realpathSync(path.join(path.dirname(pkgPath), entry));
}
