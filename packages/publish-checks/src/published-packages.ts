import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packagesBuiltOrRefuse, publishedTreeDirs, REPO_ROOT } from '@apackdev/host/build/packages-built';
import { packTree } from '@apackdev/host/build/published-manifest';
import { findPackageDirectory } from '@apackdev/host/build/package-inputs';

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
  ears: publishedTreeDirs()['apack-ears']!,
  sdk: publishedTreeDirs()['apack-sdk']!,
  ui: publishedTreeDirs()['apack-ui']!,
};

/** Compilers consumers may use: the workspace TypeScript and the oldest the packages support (their typescript peer) */
export const TSC_VERSIONS = {
  current: path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
  '5.7': path.join(REPO_ROOT, 'packages', 'typescript-floor', 'node_modules', 'typescript', 'bin', 'tsc'),
} as const;
export type TscVersion = keyof typeof TSC_VERSIONS;
/** Every TypeScript version × moduleResolution a consumer may use */
export const CONSUMER_MATRIX = (Object.keys(TSC_VERSIONS) as TscVersion[])
  .flatMap((tsc) => (['node16', 'bundler'] as const).map((moduleResolution) => ({ tsc, moduleResolution })));

/**
 * Whether the built packages are there. Absent them this refuses, so a suite cannot report green having
 * checked nothing, and `APACK_ALLOW_UNBUILT=1` is the deliberate way to get `false` and skip. It refuses
 * outright when what is there is stale. The rule and its reasoning live in `packagesBuiltOrRefuse`, which
 * `@app/repo-checks` calls too — one rule with two callers, rather than a copy in each suite that reads
 * build output.
 */
export const PACKAGES_BUILT = packagesBuiltOrRefuse('npm run packages:build (or npm test -w @app/publish-checks, which builds them)');

/** Keep Node's owner-specific external overrides while packed workspace packages stay in the consumer. */
function linkExternalModules(source: string, target: string): void {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (entry === '@apackdev' || entry.startsWith('.')) continue;
    const destination = path.join(target, entry);
    // A dependency actually bundled in a tarball takes precedence over a fixture link.
    if (fs.lstatSync(destination, { throwIfNoEntry: false })) continue;
    fs.symlinkSync(path.join(source, entry), destination, 'dir');
  }
}

/**
 * A directory whose node_modules has the npm-packed @apackdev/ears, @apackdev/sdk and @apackdev/ui installed, as a
 * pack gets them from the registry, and links to the monorepo's copies of everything else.
 */
export function installPublishedPackages(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-published-'));
  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '@apackdev'), { recursive: true });
  linkExternalModules(path.join(REPO_ROOT, 'node_modules'), modules);
  for (const [name, dir] of Object.entries(PACKED_PACKAGES)) {
    // `packTree` rather than npm by hand: one declaration of this, shared with `packages:check`, which needs
    // the same tarball for `attw` and must not pack it inside the tree it is checking
    const tarball = packTree(dir, root);
    const target = path.join(modules, '@apackdev', name);
    fs.mkdirSync(target);
    execFileSync('tar', ['-xzf', tarball, '-C', target, '--strip-components', '1']);
    const workspace = findPackageDirectory(REPO_ROOT, `@apackdev/${name}`);
    if (!workspace) throw new Error(`No installed workspace package for @apackdev/${name}`);
    linkExternalModules(path.join(workspace.directory, 'node_modules'), path.join(target, 'node_modules'));
  }
  return root;
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
