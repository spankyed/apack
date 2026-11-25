import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packagesBuiltOrRefuse, publishedTreeDirs, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { packTree } from '@apackdev/host/build/published-manifest';

const execFileAsync = promisify(execFile);

/**
 * Re-exported so a consumer of this fixture needs one import, not two.
 *
 * It comes from `@apackdev/host/build/packages-built`, which derives it from a marker file, rather than by
 * counting `..` from this file. The count was right where this used to live and would have been wrong
 * here; two specs broke exactly that way during `goal-test-placement.md`.
 */
export { REPO_ROOT };

/**
 * Re-exported for the same reason: the file list `npm pack` would produce lives in
 * `@apackdev/host/build/published-manifest`, where the package builds stage a tree from it, so the repo has one
 * dry-run pack call site rather than one per caller. `installPublishedPackages()` below is the other operation —
 * a real pack, producing tarballs to install.
 */
export { workspacePackList } from '@apackdev/host/build/published-manifest';

/**
 * The packages `installPublishedPackages()` npm-packs into a consumer fixture, by the name a
 * consumer installs them as. Each is its *staged* tree (`publishedTreeDirs()`), the one npm publishes, so a
 * consumer fixture reads the derived manifest rather than the workspace one it is derived from.
 *
 * Deliberately not the build-freshness watch list (`BUILD_UNITS`), which covers everything a build reads —
 * `@apackdev/host` and `@apackdev/testing` among it — and must be free to grow without changing what is packed
 * into a fixture. `tests/published-manifest-paths.spec.ts` checks every packed package is one the build builds.
 */
export const PACKED_PACKAGES: Record<string, string> = {
  sdk: publishedTreeDirs()['apack-sdk']!,
  ui: publishedTreeDirs()['apack-ui']!,
};

/** Compilers consumers may use: the workspace TypeScript and the oldest the packages support (their typescript peer) */
export const TSC_VERSIONS = {
  current: path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '5.7': path.join(REPO_ROOT, 'packages', 'internal-typescript-floor', 'node_modules', 'typescript', 'bin', 'tsc'),
} as const;
export type TscVersion = keyof typeof TSC_VERSIONS;
/** Every TypeScript version × moduleResolution a consumer may use */
export const CONSUMER_MATRIX = (Object.keys(TSC_VERSIONS) as TscVersion[])
  .flatMap((tsc) => (['node16', 'bundler'] as const).map((moduleResolution) => ({ tsc, moduleResolution })));

/**
 * Whether the built packages are there. Absent them this refuses, so a suite cannot report green having
 * checked nothing, and `APACK_ALLOW_UNBUILT=1` is the deliberate way to get `false` and skip. It refuses
 * outright when what is there is stale. The rule and its reasoning live in `packagesBuiltOrRefuse`, which
 * `@app/internal-repo-checks` calls too — one rule with two callers, rather than a copy in each suite that reads
 * build output.
 */
export const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @app/internal-publish-checks, which builds them)');

/**
 * elmdb's packages the SDK brings, which no registry has: the tarball of each that this repository's root `overrides`
 * name, elmdb's release's, standing in for the registry through npm's `overrides`, as
 * `test-packaged-authoring-author.sh` does. A consumer names neither: they arrive as the SDK's. While the root points
 * them at a local checkout (`npm run deps:local`), each is packed from it.
 */
const ELMDB_PACKAGES = ['@elmdb/ears', 'elmdb'];
const rootOverrides = (): Record<string, string> =>
  (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as { overrides: Record<string, string> }).overrides;

/** The version of `name` this repository has installed */
function installedVersion(name: string): string {
  return (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
}

/** A published tree's optional peer dependencies, each with the range it names */
function optionalPeers(dir: string): Array<[string, string]> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  };
  return Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => manifest.peerDependenciesMeta?.[name]?.optional === true);
}

/** `npm <args>` in `cwd`, launched as `packTree` launches it: through npm's JS entry on Windows, where npm.cmd needs a shell */
function npm(args: readonly string[], cwd: string): void {
  const windows = process.platform === 'win32';
  const entry = process.env.npm_execpath;
  const npmArgs = windows ? [entry && path.basename(entry) === 'npm-cli.js'
    ? entry : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), ...args] : [...args];
  execFileSync(windows ? process.execPath : 'npm', npmArgs, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * A directory whose node_modules has the npm-packed @apackdev/sdk and @apackdev/ui installed as a pack gets them from
 * the registry, and nothing else: what they declare, installed by npm.
 *
 * **Installed nested (`--install-strategy=nested`)**: each package's dependencies under its own `node_modules`, and only
 * the consumer's dependencies and their peers at the top. That is the strictest layout npm writes, and the one where a
 * published declaration naming a package its own package doesn't declare (or one only a dependency brings, like
 * `@elmdb/ears` behind the SDK) fails to resolve — where a hoisted install, or a tree of links to this repo's
 * `node_modules`, would resolve it by accident. Scripts are skipped (nothing here runs the packages) and the cache is
 * preferred, so a run needs the network only for what this machine hasn't fetched.
 */
export function installPublishedPackages(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-published-'));
  try {
    const tarballs = path.join(root, '.tarballs');
    fs.mkdirSync(tarballs);
    // `packTree` rather than npm by hand: one declaration of this, shared with `packages:check`, which needs the same
    // tarball for `attw` and must not pack it inside the tree it is checking
    const packed = (dir: string) => `file:${packTree(dir, tarballs)}`;
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'consumer', private: true, type: 'module',
      dependencies: {
        // Node's types, which the compiles here name (`types: ['node']`), at the version this repository compiles with
        '@types/node': installedVersion('@types/node'),
        // What `ai`'s `@ai-sdk/provider` declarations import (`json-schema`) and don't declare: a consumer that checks
        // library declarations installs it, as one compiling against the AI SDK has to
        '@types/json-schema': installedVersion('@types/json-schema'),
        // The optional peers too, at the range each package names: declared, so a declaration may name one, and a
        // consumer reaching the types that do has installed it
        ...Object.fromEntries(Object.values(PACKED_PACKAGES).flatMap((dir) => optionalPeers(dir))),
        ...Object.fromEntries(Object.entries(PACKED_PACKAGES).map(([name, dir]) => [`@apackdev/${name}`, packed(dir)])),
      },
      overrides: Object.fromEntries(ELMDB_PACKAGES.map((name) => {
        const spec = rootOverrides()[name]!;
        return [name, spec.startsWith('file:') ? packed(path.resolve(REPO_ROOT, spec.slice('file:'.length))) : spec];
      })),
    }));
    npm(['install', '--install-strategy=nested', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], root);
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Compiles `files` (name → lines) as a consumer package in `dir`, with the chosen compiler and module
 * resolution: tsc's exit code and output.
 */
export async function compileConsumer(
  dir: string,
  tsc: TscVersion,
  moduleResolution: 'node16' | 'bundler',
  files: Record<string, string[]>,
  { skipLibCheck = true, types = [] as string[] } = {},
): Promise<{ code: number; output: string }> {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: moduleResolution === 'node16' ? 'node16' : 'esnext', moduleResolution,
      strict: true, skipLibCheck, noEmit: true, types, lib: ['ES2022', 'DOM'],
    },
    include: Object.keys(files),
  }));
  for (const [name, lines] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), lines.join('\n'));
  try {
    const { stdout } = await execFileAsync(process.execPath, [TSC_VERSIONS[tsc], '-p', dir]);
    return { code: 0, output: stdout };
  } catch (err: any) {
    return { code: err.code ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
