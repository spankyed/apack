import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import envPaths from 'env-paths';
import semver from 'semver';
import { packagedShippedPacksDir } from '@apackdev/host/packs/assets';
import { parseAppEnv, type AppChannel } from '@apackdev/sdk/env';
import { cachedBetaBuilds, ensureBetaApp, type PackagedApp } from './beta-app';
import { checkoutFor } from '../build/checkout-packages';

/** An app to launch a pack in: a built monorepo checkout, or a packaged app build. */
export type PackHost =
  | { kind: 'source'; root: string }
  | { kind: 'packaged'; executable: string; version: string };

/** A human host request, distinct from a resolved executable identity. */
type HostSelection = { path: string } | { beta: true };

export interface CliDirs {
  cache: string;
  /** Machine state the CLI owns and the app does not: today, the profiles `npm run dev:open --` creates */
  data: string;
}

export function cliDirs(): CliDirs {
  const paths = envPaths('apack-cli', { suffix: '' });
  return { cache: paths.cache, data: paths.data };
}

/** `~/apack` → the home directory's apack. */
export function expandHome(input: string): string {
  return input === '~' || input.startsWith('~/') ? path.join(os.homedir(), input.slice(1)) : input;
}

/** Missing pieces of a monorepo checkout needed to launch a pack in it; empty when usable. */
export function sourceAppProblems(root: string): string[] {
  const problems: string[] = [];
  if (!fs.existsSync(path.join(root, 'packages', 'entry-point.mjs'))) return ['not an apack checkout (no packages/entry-point.mjs)'];
  if (!fs.existsSync(path.join(root, 'node_modules', 'electron'))) problems.push('node_modules/electron is missing (run npm install)');
  for (const pkg of ['main', 'renderer']) {
    if (!fs.existsSync(path.join(root, 'packages', pkg, 'dist'))) problems.push(`packages/${pkg}/dist is missing (run npm run build:default-setup && npm run build:runtime)`);
  }
  return problems;
}

export function sourceTarget(root: string, from: string): PackHost & { kind: 'source' } {
  const resolved = path.resolve(expandHome(root));
  const problems = sourceAppProblems(resolved);
  if (problems.length > 0) {
    throw new Error(`${from} (${resolved}) can't be used:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  }
  return { kind: 'source', root: fs.realpathSync(resolved) };
}

/** The app package inside a packaged build, which electron-builder ships unpacked (`asar: false`). */
function packagedAppDir(executable: string): string {
  return path.join(path.dirname(path.dirname(executable)), 'Resources', 'app');
}

/** Offers from the selected executable's own app bundle. */
export function packagedAppPackagesDir(executable: string): string {
  return packagedShippedPacksDir(packagedAppDir(executable));
}

/** What a packaged build says its own version is, beside the packages dir above. */
function packagedAppVersion(executable: string): string | undefined {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(packagedAppDir(executable), 'package.json'), 'utf-8'));
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the packaged app's authoritative channel; release tags and executable names can differ. */
export function packagedHostChannel(executable: string): AppChannel {
  const manifest = path.join(packagedAppDir(executable), 'build-manifest.json');
  const channel = parseAppEnv(JSON.parse(fs.readFileSync(manifest, 'utf-8')).channel);
  if (channel !== 'production' && channel !== 'beta' && channel !== 'preview') throw new Error(`Invalid packaged channel in ${manifest}`);
  return channel;
}

/** Select an explicit .app bundle, or a built source checkout. */
function pathTarget(input: string, from: string): PackHost {
  const root = path.resolve(expandHome(input));
  if (!root.endsWith('.app')) return sourceTarget(root, from);
  const resources = path.join(root, 'Contents', 'Resources', 'app');
  const metadata = JSON.parse(fs.readFileSync(path.join(resources, 'build-manifest.json'), 'utf-8'));
  const executable = path.join(root, 'Contents', 'MacOS', metadata.productName);
  packagedHostChannel(executable);
  fs.accessSync(executable, fs.constants.X_OK);
  return { kind: 'packaged', executable, version: metadata.version };
}

/** Repository entry points supply their own checkout, never a public selection request. */
export function resolveRepositoryHost(root: string): PackHost & { kind: 'source' } {
  const host = sourceTarget(root, 'the repository checkout');
  announceHost(host, 'the repository checkout');
  return host;
}

/** What every lookup here needs: where to look, and how to reach a beta when the answer is one. */
export interface HostLookupOptions {
  dirs?: CliDirs;
  env?: NodeJS.ProcessEnv;
  /** The pack's hostVersion, for choosing or downloading a beta */
  hostVersion?: string;
  /** Injected for tests; defaults to ensureBetaApp. */
  betaApp?: (hostVersion: string, cacheDir: string) => Promise<PackagedApp>;
}

export interface HostPackagesOptions extends HostLookupOptions {
  /** Inspect cached host packages without downloading a beta. */
  readOnly?: boolean;
  /** The pack whose checkout to look for, when nothing names an app. Absent means "do not derive" */
  from?: string;
  /** Injected for tests; defaults to `checkoutFor` */
  checkout?: (from: string) => string | undefined;
}

const betaAppFrom = (options: HostLookupOptions) =>
  options.betaApp ?? ((range: string, cacheDir: string) => ensureBetaApp({ hostVersion: range, cacheDir }));

/** A place an app can be named; `from` is what an error message and `announceHost` call it. */
interface NamedHost {
  choice: HostSelection;
  from: string;
}

function namedHost(flags: HostFlags | undefined, env: NodeJS.ProcessEnv): NamedHost | undefined {
  const selected = flags?.host ?? env.APACK_HOST;
  if (!flags?.host && (env.APACK_APP || env.APACK_CHANNEL || env.APACK_BUILD)) {
    throw new Error('Use APACK_HOST for pack host selection; legacy host selectors are unsupported.');
  }
  if (!selected) return undefined;
  return {
    choice: selected === 'beta' ? { beta: true } : { path: path.resolve(expandHome(selected)) },
    from: flags?.host ? `--host ${selected}` : `APACK_HOST=${selected}`,
  };
}

export async function configuredHostPackagesDir(options: HostPackagesOptions = {}): Promise<{ dir: string; label: string } | null> {
  const { dirs = cliDirs(), env = process.env, hostVersion = '*', from, checkout = checkoutFor } = options;
  const betaApp = betaAppFrom(options);
  const asPackages = (app: PackagedApp) =>
    ({ dir: packagedAppPackagesDir(app.executable), label: `apack Beta ${app.version}` });

  if (env.APACK_HOST_ROOT && env.APACK_HOST_EXECUTABLE) throw new Error('Choose one resolved host identity.');
  if (env.APACK_HOST_ROOT) return { dir: path.join(env.APACK_HOST_ROOT, 'packages'), label: `apack checkout ${env.APACK_HOST_ROOT}` };
  if (env.APACK_HOST_EXECUTABLE) return { dir: packagedAppPackagesDir(env.APACK_HOST_EXECUTABLE), label: `apack bundle ${env.APACK_HOST_EXECUTABLE}` };
  const named = namedHost(undefined, env);
  if (!named) {
    const found = from === undefined ? undefined : checkout(from);
    if (found === undefined) return null;
    return { dir: path.join(found, 'packages'), label: `apack checkout ${found}` };
  }

  if ('path' in named.choice) {
    // Dependency builds only need packages/, not the Electron and runtime outputs a launch requires.
    const root = path.resolve(expandHome(named.choice.path));
    return root.endsWith('.app')
      ? { dir: packagedShippedPacksDir(path.join(root, 'Contents', 'Resources', 'app')), label: `apack bundle ${root}` }
      : { dir: path.join(root, 'packages'), label: `apack checkout ${root}` };
  }

  // Build/test are not upgrade commands: reuse a compatible cached beta before consulting the network.
  const cached = cachedBetaApp(dirs, hostVersion);
  if (!cached && options.readOnly) throw new Error('Selected beta host has no compatible cached build. Fetch the host before validating.');
  return asPackages(cached ?? await betaApp(hostVersion, dirs.cache));
}

/** Source selection for offline mutations; storage/cwd never chooses an app or fetches a beta. */
export async function selectedHostPackages(host?: string, dirs: CliDirs = cliDirs()): Promise<{ dir: string; label: string }> {
  const env = { ...process.env };
  if (host) {
    delete env.APACK_HOST_ROOT;
    delete env.APACK_HOST_EXECUTABLE;
    env.APACK_HOST = host;
  }
  const selected = await configuredHostPackagesDir({ dirs, env, readOnly: true });
  if (!selected) throw new Error('Select the source app with --host <path|beta>. Storage and the current directory do not select a host.');
  if (!fs.existsSync(selected.dir) || !fs.statSync(selected.dir).isDirectory()) {
    throw new Error(`${selected.label} has no packages directory: ${selected.dir}`);
  }
  return selected;
}

function cachedBetaApp(dirs: CliDirs, hostVersion: string): PackagedApp | null {
  for (const { tag, executable } of cachedBetaBuilds(dirs.cache)) {
    const version = packagedAppVersion(executable) ?? tag;
    // `includePrerelease` as pickBetaRelease passes it, and load-bearing rather than tidy: without it a
    // beta satisfies no range at all, `*` included — which is what a pack declaring no hostVersion gets,
    // so omitting it would empty the cache for most packs
    if (semver.satisfies(version, hostVersion, { includePrerelease: true })) return { version: tag, executable };
  }
  return null;
}

export interface HostFlags {
  /** Explicit checkout or .app bundle path. */
  host?: string;
  /** Build the pack as a release before testing it, so the tests run what a release ships */
  release?: boolean;
  args: string[];
  /**
   * The pack is already built and must not be rebuilt. For a caller that built it in an earlier step — the
   * repo's `test:external-pack:contract` before its `:app` half — because a rebuild here destroys the
   * pack's `dist` for the length of the build, and anything else reading that tree meanwhile sees a pack
   * that is not built. The freshness the rebuild bought is checked instead, not dropped.
   */
  prebuilt?: boolean;
}

/** Parse executable selection separately from release channels and pack build options. */
export function parseHostFlags(argv: string[]): HostFlags {
  const flags: HostFlags = { args: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const [name, inline] = arg.split(/=(.*)/s, 2);
    if (name === '--host') {
      if (flags.host !== undefined) throw new Error('Specify --host once.');
      const value = inline ?? argv[++i];
      if (!value || value.startsWith('-')) throw new Error('--host needs a path or beta');
      flags.host = value === 'beta' ? value : path.resolve(expandHome(value));
    } else if (name === '--app' || name === '--channel' || name === '--build') {
      throw new Error(`${name} is not a pack host selector. Use --host <path|beta>.`);
    } else if (name === '--release' || name === '--prebuilt') {
      if (inline !== undefined) throw new Error(`${name} does not take a value.`);
      if (name === '--release') flags.release = true;
      else flags.prebuilt = true;
    } else flags.args.push(arg);
  }
  return flags;
}

export interface HostResolutionOptions extends HostLookupOptions {
  flags: HostFlags;
  hostVersion: string;
  /** The pack being worked on, or the directory a command was run from when there is no pack */
  from?: string;
  policy: 'development' | 'test';
  /** Injected for tests; defaults to `checkoutFor` */
  checkout?: (from: string) => string | undefined;
}

/** The Beta build the pack's `hostVersion` asks for, downloaded if it isn't cached. */
async function packagedTarget(options: HostResolutionOptions): Promise<PackHost> {
  const { hostVersion, dirs = cliDirs() } = options;
  const app = cachedBetaApp(dirs, hostVersion) ?? await betaAppFrom(options)(hostVersion, dirs.cache);
  return { kind: 'packaged', executable: app.executable, version: packagedAppVersion(app.executable) ?? app.version };
}


/** One description of the resolved host for command output. */
export function hostLabel(app: PackHost): string {
  return app.kind === 'source' ? `apack from ${app.root}` : `apack ${packagedHostChannel(app.executable)} ${app.version}`;
}

function announceHost(app: PackHost, from: string): void {
  console.error(`Using ${hostLabel(app)} (${from})`);
}

export async function deriveHost(options: HostResolutionOptions): Promise<{ target: PackHost; from: string }> {
  const { flags, env = process.env, from, checkout = checkoutFor } = options;
  const named = namedHost(flags, env);
  if (named) {
    const target = 'path' in named.choice ? pathTarget(named.choice.path, named.from) : await packagedTarget(options);
    return { from: named.from, target };
  }
  const found = options.policy === 'test' ? undefined : checkout(from ?? process.cwd());
  if (found !== undefined) {
    return { from: 'the checkout this pack is built against', target: sourceTarget(found, 'The apack checkout behind this pack') };
  }
  return { from: `hostVersion ${options.hostVersion}`, target: await packagedTarget(options) };
}

/** The app a command **launches**, derived and validated, and stated so the derivation is never silent. */
export async function resolvePackHost(options: HostResolutionOptions): Promise<PackHost> {
  const { target, from } = await deriveHost(options);
  if (options.hostVersion !== '*') {
    const version = target.kind === 'packaged' ? target.version
      : JSON.parse(fs.readFileSync(path.join(target.root, 'package.json'), 'utf-8')).version;
    if (typeof version !== 'string' || !semver.satisfies(version, options.hostVersion, { includePrerelease: true })) {
      throw new Error(`Host ${version} does not satisfy hostVersion ${options.hostVersion}.`);
    }
  }
  announceHost(target, from);
  return target;
}

/** Pin dependency resolution and execution to one build; discard inherited selection requests. */
export function setHostHandoff(host: PackHost, env: NodeJS.ProcessEnv): void {
  for (const key of ['APACK_HOST', 'APACK_APP', 'APACK_BUILD', 'APACK_CHANNEL', 'APACK_HOST_ROOT', 'APACK_HOST_EXECUTABLE']) delete env[key];
  if (host.kind === 'source') env.APACK_HOST_ROOT = host.root;
  else env.APACK_HOST_EXECUTABLE = host.executable;
}
