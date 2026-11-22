/**
 * Which packages a package brings, and what each one is.
 *
 * A workspace package, or one a pack or `npm run deps:local` links, keeps its version while its files change, so a
 * version says nothing about what a package holds. What it holds is what `npm pack` would ship from its directory,
 * and that is the same set of files whether the directory is an install or a linked checkout: an install is that
 * set, unpacked. So a package's identity is its name, its version and a hash of
 * that set, and nothing here guesses which of its folders matter.
 *
 * **An install from a URL already carries that hash**: npm checked the tarball it unpacked against the `integrity` its
 * lockfile records (a registry's, or a release of one of our other repositories), so such a package is identified by
 * that instead of by reading its files
 * again — which is most of the packages and nearly all of the files a pack's scope covers.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Minimatch } from 'minimatch';
import { createRequire } from 'node:module';

export interface PackageManifest {
  readonly name: string;
  readonly version?: string;
  readonly files?: readonly string[];
  readonly main?: string;
  readonly browser?: string | Record<string, unknown>;
  readonly bin?: string | Record<string, string>;
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  readonly bundleDependencies?: readonly string[] | boolean;
  readonly bundledDependencies?: readonly string[] | boolean;
}

export interface ClosurePackage {
  readonly name: string;
  /** The package's real directory: two links to one checkout are one package */
  readonly directory: string;
  readonly manifest: PackageManifest;
}

export function readPackageManifest(directory: string): PackageManifest {
  return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as PackageManifest;
}

/**
 * The directory of the package `name` as Node finds it from `owner`'s `node_modules` lookup, or undefined. A package
 * named like a built-in module (`punycode`, `events`) is looked up the same way: `require.resolve.paths` answers null
 * for a built-in's name, so the lookup asks for `name/`, which is how such a package's own dependents require it.
 */
function findInstalledPackage(owner: string, name: string): string | undefined {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid npm dependency name: ${name}`);
  }
  for (const directory of createRequire(path.join(owner, 'package.json')).resolve.paths(`${name}/`) ?? []) {
    const candidate = path.join(directory, name);
    if (fs.statSync(path.join(candidate, 'package.json'), { throwIfNoEntry: false })?.isFile()) return fs.realpathSync.native(candidate);
  }
  return undefined;
}

/** One or more declared packages that don't resolve, each naming the package that declared it */
export class UnresolvedDependencyError extends Error {
  readonly unresolved: readonly string[];

  constructor(unresolved: readonly string[]) {
    super(`Unresolved dependencies (install them):\n  ${unresolved.join('\n  ')}`);
    this.name = 'UnresolvedDependencyError';
    this.unresolved = unresolved;
  }
}

/**
 * The package `name` as Node resolves it from `fromDir`, and every package it brings, transitively: each one's
 * `dependencies`, `optionalDependencies` and `peerDependencies`, resolved from the directory of the package that
 * declares it, which is Node's own rule. Packages are deduplicated by real directory, the first one found first.
 *
 * **What may be absent**: an optional dependency, and a peer its declarer marks optional
 * (`peerDependenciesMeta.<name>.optional`). Everything else is an error naming who declared it. That includes a peer
 * not marked optional: npm installs those since npm 7, so one that doesn't resolve is an install that isn't complete,
 * and leaving it out of the answer would make the answer the incomplete install's.
 *
 * @throws UnresolvedDependencyError listing every declaration that doesn't resolve
 */
export function dependencyClosure(name: string, fromDir: string): ClosurePackage[] {
  const found = new Map<string, ClosurePackage>();
  const unresolved: string[] = [];
  const visit = (dependency: string, owner: string, declaredBy: string): void => {
    const directory = findInstalledPackage(owner, dependency);
    if (directory === undefined) {
      unresolved.push(`${dependency}, declared by ${declaredBy}, doesn't resolve from ${owner}`);
      return;
    }
    if (found.has(directory)) return;
    const manifest = readPackageManifest(directory);
    found.set(directory, { name: manifest.name, directory, manifest });
    const optional = (dep: string) => Object.hasOwn(manifest.optionalDependencies ?? {}, dep)
      || (manifest.peerDependenciesMeta?.[dep]?.optional === true && !Object.hasOwn(manifest.dependencies ?? {}, dep));
    for (const dep of new Set(Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }))) {
      if (optional(dep) && findInstalledPackage(directory, dep) === undefined) continue;
      visit(dep, directory, manifest.name);
    }
  };
  visit(name, path.resolve(fromDir), path.resolve(fromDir));
  if (unresolved.length > 0) throw new UnresolvedDependencyError(unresolved);
  return [...found.values()];
}

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  /**
   * What the package holds: the `integrity` its lockfile records for a registry install (`sha512-…`), and otherwise the
   * sha256 of the files `npm pack` ships from the package's directory, each path with its bytes
   */
  readonly hash: string;
}

/** The fields of a lockfile entry that say where a package came from and which bytes it is */
interface LockedPackage {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
}

/** Each lockfile read, by path, kept while its size and modification time are the ones it was read at */
const lockfiles = new Map<string, { readonly size: number; readonly mtimeMs: number; readonly packages: Record<string, LockedPackage> }>();

function lockfilePackages(file: string): Record<string, LockedPackage> | undefined {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return undefined;
  const cached = lockfiles.get(file);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.packages;
  const packages = (JSON.parse(fs.readFileSync(file, 'utf8')) as { packages?: Record<string, LockedPackage> }).packages ?? {};
  lockfiles.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, packages });
  return packages;
}

/**
 * The `integrity` npm recorded for the package at `root` when it installed it from the registry, or undefined.
 *
 * `root` is a real directory: one under a `node_modules` is an install, and the lockfile that governs it is the nearest
 * `package-lock.json` above it, whose `packages` key it by its path from there (`node_modules/a/node_modules/b`, or
 * `packages/x/node_modules/b` in a workspace). Anything else has no integrity to give — a link resolves to the
 * checkout it points at, which is under no `node_modules`; a workspace package is keyed by its own path; and a git or
 * `file:` dependency is resolved somewhere other than a registry URL — and is read by its files. So is an entry whose
 * version isn't the installed one: a lockfile that has moved on from what is installed says nothing about it.
 */
function registryIntegrity(root: string, version: string): string | undefined {
  if (!root.split(path.sep).includes('node_modules')) return undefined;
  for (let dir = path.dirname(root); ; dir = path.dirname(dir)) {
    const packages = lockfilePackages(path.join(dir, 'package-lock.json'));
    if (packages) {
      const entry = packages[path.relative(dir, root).split(path.sep).join('/')];
      const fromRegistry = entry !== undefined && /^https?:\/\//.test(entry.resolved ?? '');
      return fromRegistry && entry.version === version && entry.integrity ? entry.integrity : undefined;
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * A package's name, version and what it holds: for a registry install the lockfile's `integrity`, and otherwise the hash
 * of what it ships, which is the same for a linked checkout and an install of the package it would pack
 */
export function packageIdentity(directory: string): PackageIdentity {
  const root = fs.realpathSync.native(directory);
  const manifest = readPackageManifest(root);
  const integrity = registryIntegrity(root, manifest.version ?? '');
  if (integrity !== undefined) return { name: manifest.name, version: manifest.version ?? '', hash: integrity };
  const hash = createHash('sha256');
  for (const file of packedFiles(root)) {
    const bytes = fs.readFileSync(path.join(root, file));
    hash.update(`${file.length}:${file}:${bytes.length}:`);
    hash.update(bytes);
  }
  return { name: manifest.name, version: manifest.version ?? '', hash: hash.digest('hex') };
}

// npm-packlist's rules (npm 11), read from its source: the defaults every directory applies, then the package's
// `files`, then its ignore files, then what is always and never shipped. Its walker is reproduced below, rule for rule,
// since the order the sets are applied in and how a directory is matched are what decide a file.
const DEFAULT_RULES = [
  '.npmignore', '.gitignore', '**/.git', '**/.svn', '**/.hg', '**/CVS', '**/.git/**', '**/.svn/**', '**/.hg/**',
  '**/CVS/**', '/.lock-wscript', '/.wafpickle-*', '/build/config.gypi', 'npm-debug.log', '**/.npmrc', '.*.swp',
  '.DS_Store', '**/.DS_Store/**', '._*', '**/._*/**', '*.orig', '/archived-packages/**',
];
const ALWAYS_SHIPPED = ['!/package.json', '!/readme{,.*[^~$]}', '!/copying{,.*[^~$]}', '!/license{,.*[^~$]}', '!/licence{,.*[^~$]}'];
const NEVER_SHIPPED = ['/.git', '/node_modules', '.npmrc', '/package-lock.json', '/yarn.lock', '/pnpm-lock.yaml', '/bun.lockb'];

const compile = (rules: readonly string[]) => rules.map((rule) => rule.trim()).filter((rule) => rule !== '' && !rule.startsWith('#'))
  .map((rule) => new Minimatch(rule, { matchBase: true, dot: true, flipNegate: true, nocase: true }));

const DEFAULTS = compile(DEFAULT_RULES);

function readIgnoreFile(directory: string): Minimatch[] {
  for (const name of ['.npmignore', '.gitignore']) {
    const file = path.join(directory, name);
    if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return compile(fs.readFileSync(file, 'utf8').split(/\r?\n/));
  }
  return [];
}

interface Walker {
  readonly parent?: Walker;
  readonly basename: string;
  /** Whether the directory itself was named, which lets its own rules include what its parent's left out */
  readonly exact: boolean;
  readonly rules: readonly Minimatch[];
  /** `files` entries that name a file, relative to this directory */
  readonly required: readonly string[];
}

/** ignore-walk's `filterEntry`: the parent's verdict on `entry`, then this directory's rules, the last match winning */
function filterEntry(walker: Walker, entry: string, partial = false, entryBasename?: string): boolean {
  let included = true;
  if (walker.parent) {
    included = filterEntry(walker.parent, `${walker.basename}/${entry}`, partial, entryBasename ?? entry);
    if (!included && !walker.exact) return false;
  }
  for (const rule of walker.rules) {
    if (rule.negate === included) continue;
    const relativeRule = entryBasename !== undefined && rule.globParts.some((part) => part.length <= (part.at(-1) ? 1 : 2));
    const match = rule.match(`/${entry}`) || rule.match(entry) || (partial && (
      rule.match(`/${entry}/`) || rule.match(`${entry}/`)
      || (rule.negate && (rule.match(`/${entry}`, true) || rule.match(entry, true)))
      || (relativeRule && (rule.match(`/${entryBasename}/`) || rule.match(`${entryBasename}/`)
        || (rule.negate && (rule.match(`/${entryBasename}`, true) || rule.match(entryBasename, true)))))));
    if (match) included = rule.negate;
  }
  return included;
}

/** The root's rules: npm-packlist's `processPackage`, which reads `files`, `main`, `browser` and `bin` */
function packageRules(root: string, manifest: PackageManifest): { rules: Minimatch[]; required: string[] } {
  const required: string[] = [];
  const included: string[] = [];
  const strict = ['/.git', ...ALWAYS_SHIPPED, ...NEVER_SHIPPED];
  for (let file of manifest.files ?? []) {
    if (file.startsWith('./')) file = file.slice(1);
    if (file.endsWith('/*')) file += '*';
    const stat = fs.lstatSync(path.join(root, file.replace(/^!+/, '')), { throwIfNoEntry: false });
    if (stat?.isFile()) {
      strict.unshift(`!${file}`);
      required.push(file.startsWith('/') ? file.slice(1) : file);
    } else if (stat?.isDirectory()) {
      included.push(`!${file}`, `!${file}/**`);
    } else if (!stat) {
      included.push(`!${file}`);
    }
  }
  // npm reads these from a normalized manifest, whose `bin` paths are clean (`./bin.mjs` is `bin.mjs`) and whose
  // `main` and `browser` are as written: a `./main.js` matches nothing, and is shipped only if `files` ships it
  if (typeof manifest.browser === 'string') strict.push(`!/${manifest.browser}`);
  if (manifest.main) strict.push(`!/${manifest.main}`);
  for (const bin of typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {})) {
    strict.push(`!${path.posix.normalize(`/${bin}`)}`);
  }
  // `files` replaces the ignore files; without it, `.npmignore` does, and `.gitignore` only where there is none
  const own = manifest.files ? compile(['*', ...included]) : readIgnoreFile(root);
  return { rules: [...DEFAULTS, ...own, ...compile(strict)], required };
}

/**
 * The files `npm pack` ships from `root`, relative and `/`-separated, sorted. A package that bundles its dependencies
 * is refused: what it ships then depends on an install tree, which no package this repository resolves has.
 */
export function packedFiles(root: string): string[] {
  const manifest = readPackageManifest(root);
  const bundled = manifest.bundleDependencies ?? manifest.bundledDependencies;
  if (bundled === true || (Array.isArray(bundled) && bundled.length > 0)) {
    throw new Error(`${manifest.name} (${root}) bundles dependencies, which packedFiles doesn't read`);
  }
  const files: string[] = [];
  const walk = (walker: Walker, directory: string, relative: string): void => {
    for (const entry of fs.readdirSync(directory).sort()) {
      if (entry.includes('*')) continue;
      const passFile = filterEntry(walker, entry);
      const passDir = filterEntry(walker, entry, true);
      if (!passFile && !passDir) continue;
      const stat = fs.lstatSync(path.join(directory, entry));
      if (stat.isFile()) {
        if (passFile) files.push(relative ? `${relative}/${entry}` : entry);
      } else if (stat.isDirectory() && passDir) {
        const child = path.join(directory, entry);
        // npm passes a directory the required files directly inside it, and no deeper ones
        const required = walker.required.flatMap((file) => path.posix.dirname(file) === entry ? [path.posix.basename(file)] : []);
        walk({
          parent: walker, basename: entry, exact: passFile || filterEntry(walker, `${entry}/`), required,
          rules: [...DEFAULTS, ...readIgnoreFile(child), ...compile(['/.git', ...required.map((file) => `!${file}`)])],
        }, child, relative ? `${relative}/${entry}` : entry);
      }
    }
  };
  const { rules, required } = packageRules(root, manifest);
  walk({ basename: '', exact: false, rules, required }, root, '');
  return files.sort();
}
