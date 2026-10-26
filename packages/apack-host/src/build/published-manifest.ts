/**
 * The manifest a published tarball carries, derived from the workspace one, and what it may name.
 *
 * The workspace manifest cannot be published as it stands. Every export of `@apackdev/ears`, `@apackdev/sdk` and
 * `@apackdev/ui` names `./src/**` under the `@apackdev/source` condition, which `files` does not ship — 99 targets
 * measured 2026-09-27 — and Node picks a matching condition and *then* requires the file, with no fallback to
 * the next branch. So a consumer that enables the condition (a pack copying a config, a monorepo using the
 * same trick for its own packages) fails to resolve at all, with a message naming neither the condition nor
 * the config. The condition is a checkout-only mechanism, so the published package does not mention it rather than
 * mentioning it as a trap: `@apackdev/testing`'s manifest has never had a source branch, and enabling the
 * condition against it resolves the same `dist` path as not enabling it.
 *
 * Derived at **build** time, into a staged tree the build writes. Not at publish time: `test-packaged-authoring.sh`
 * and `@app/publish-checks` both `npm pack` the tree, so a manifest written only by `npm publish` would be one
 * nothing ever packed, typechecked or installed. And not in a `prepack` hook: seven specs pack these packages
 * concurrently, so a hook rewriting `package.json` in place would race them.
 *
 * Here rather than in the repo's `scripts/` because four callers need it and a package may not reach into
 * `scripts/`: the two build scripts write the tree, `bundle-package.ts` checks its own generated manifest with
 * the same walk, and `@app/publish-checks` checks what `npm pack` would produce.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { replaceDir } from '../replace-dir.ts';
import { SOURCE_CONDITION } from './source-resolution.ts';

/** A parsed `package.json`. Only the fields below are read; the rest is copied through */
export type Manifest = Record<string, unknown>;

/** The directory inside a package that holds the staged tree npm publishes */
export const PUBLISH_TREE = 'publish';

/**
 * Fields a published manifest has no use for. `scripts` is the load-bearing one: with no scripts there is no
 * lifecycle hook to add, so the published manifest cannot become something that runs on install or rewrites
 * itself at pack time. `@app/publish-checks` asserts the absence rather than a list of hook names, which npm
 * is free to grow.
 */
const DROPPED_FIELDS = ['scripts', 'devDependencies'];

/** The manifest fields whose values are paths into the package. `files` holds globs, and is npm's business */
const PATH_FIELDS = ['exports', 'main', 'module', 'types', 'typings', 'browser', 'bin', 'typesVersions'];

/** The dependency fields, whose `file:` specs name a directory only this checkout has */
const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * The workspace manifest as it is published: without the source condition, without an entry that condition was
 * the whole of, and without the fields above. A dependency on a linked directory (`file:`, as `@apackdev/ears`
 * depends on the elmdb checkout `vendor/elmdb` links to) is published as the version of the package there, which is
 * what a registry install resolves; `dir` is the directory the specs are relative to, and one is refused without it.
 *
 * An emptied entry is dropped rather than left as `{}`, and must not be given a published target instead.
 * `@apackdev/sdk`'s `./runtime/internals` is the case: `facade-gate.ts` reports a pack whose facade imports
 * something installed dependents cannot resolve, and it decides that by asking whether the entry has a
 * published target. Give it one and the gate goes quiet; drop the entry and the gate still reports, because an
 * absent entry is not resolvable either.
 */
export function publishedManifest(manifest: Manifest, dir?: string): Manifest {
  const published: Manifest = {};
  for (const [field, value] of Object.entries(manifest)) {
    if (DROPPED_FIELDS.includes(field)) continue;
    published[field] = field === 'exports' ? publishedExports(value)
      : DEPENDENCY_FIELDS.includes(field) ? publishedDependencies(value as Record<string, string>, String(manifest.name), dir)
        : value;
  }
  return published;
}

function publishedDependencies(dependencies: Record<string, string>, name: string, dir: string | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(dependencies).map(([dependency, spec]) => {
    if (!spec.startsWith('file:')) return [dependency, spec];
    if (dir === undefined) throw new Error(`${name}'s dependency ${dependency} is ${spec}: publishing it needs the directory the path is relative to`);
    return [dependency, publishedSpec(spec, dir)];
  }));
}

/**
 * A dependency spec as a published manifest carries it: a `file:` one, relative to `dir`, as the version of the package
 * it links, and any other as it is
 */
export function publishedSpec(spec: string, dir: string): string {
  if (!spec.startsWith('file:')) return spec;
  const linked = JSON.parse(fs.readFileSync(path.join(dir, spec.slice('file:'.length), 'package.json'), 'utf8')) as Manifest;
  return String(linked.version);
}

/** A dependency a published manifest names, as a registry install of it resolves one */
export interface RegistryDependency {
  /** The published package that depends on it */
  dependent: string;
  name: string;
  spec: string;
}

/**
 * What a registry install of `manifests` asks the registry for: every dependency they name but one on a package among
 * them, which the same publish puts there. A linked dependency is among these as the version it links, and a registry
 * holding no such version — a private package, as elmdb's binding is, or one never published — is what a real publish
 * refuses, since everything published depending on it would fail to install
 */
export function registryDependencies(manifests: readonly Manifest[]): RegistryDependency[] {
  const publishing = new Set(manifests.map((manifest) => String(manifest.name)));
  return manifests.flatMap((manifest) => DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries((manifest[field] ?? {}) as Record<string, string>)
      .filter(([name]) => !publishing.has(name))
      .map(([name, spec]) => ({ dependent: String(manifest.name), name, spec }))));
}

function publishedExports(exports: unknown): unknown {
  if (exports === null || typeof exports !== 'object' || Array.isArray(exports)) return exports;
  const kept = Object.entries(exports).flatMap(([subpath, target]) => {
    const published = withoutSourceCondition(target);
    return published === undefined ? [] : [[subpath, published] as const];
  });
  return Object.fromEntries(kept);
}

/** A target without its source branch, at any depth — `undefined` when that leaves nothing publishable */
function withoutSourceCondition(target: unknown): unknown {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return target;
  const kept = Object.entries(target).flatMap(([condition, value]) => {
    if (condition === SOURCE_CONDITION) return [];
    const published = withoutSourceCondition(value);
    return published === undefined ? [] : [[condition, published] as const];
  });
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/**
 * Every path a manifest names, as `[what names it, the path]`: every condition at every depth, and `bin`,
 * which is how a package with no exports map (`@apackdev/cli`) names anything at all.
 *
 * The keys of an `exports`, `bin` or `typesVersions` object are subpaths, conditions, commands or version
 * ranges — only the values name files, so the walk reads values and never keys.
 */
export function manifestPaths(manifest: Manifest): [string, string][] {
  const found: [string, string][] = [];
  const walk = (node: unknown, what: string): void => {
    if (typeof node === 'string') found.push([what, node]);
    else if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${what}[${index}]`));
    else if (node !== null && typeof node === 'object') {
      // Bracketed, not dotted: every `exports` key begins with a dot, so `${what}.${key}` reads `exports...types`
      for (const [key, value] of Object.entries(node)) walk(value, `${what}[${JSON.stringify(key)}]`);
    }
  };
  for (const field of PATH_FIELDS) if (field in manifest) walk(manifest[field], field);
  return found;
}

/** Which of `PATH_FIELDS` a manifest declares: what a check over it should have found something for */
export function declaredPathFields(manifest: Manifest): string[] {
  return PATH_FIELDS.filter((field) => field in manifest);
}

/**
 * Whether `files` holds what a target names. A target with `*` is a pattern, so something must match it —
 * without that, a pattern nobody had thought about would pass every check by matching nothing.
 */
function shipped(files: ReadonlySet<string>, target: string): boolean {
  const wanted = target.replace(/^\.\//, '');
  if (!wanted.includes('*')) return files.has(wanted);
  const [before = '', after = ''] = wanted.split('*', 2);
  return [...files].some((file) => file.length >= before.length + after.length
    && file.startsWith(before) && file.endsWith(after));
}

/**
 * `<what names it> -> <target>` for every path the manifest names that is not in `files`, whose paths are
 * relative to the package root (what `npm pack --json` lists, and what `treeFiles()` walks).
 *
 * The one shared answer to "does this package name only what it holds", so the build's check on a staged tree
 * and the spec's check on a tarball cannot come to different conclusions.
 */
export function missingPublishedPaths(manifest: Manifest, files: ReadonlySet<string>): string[] {
  return manifestPaths(manifest)
    .filter(([, target]) => !shipped(files, target))
    .map(([what, target]) => `${what} -> ${target}`);
}

/**
 * The files `npm pack` would put in a tarball for the tree at `dir`, relative to the package root.
 *
 * npm's answer rather than a reading of `files`, and the difference is not academic: `npm-packlist` force-includes
 * `/package.json`, `/readme*`, `/copying*`, `/license*` and `/licence*` whatever `files` says, and whatever `main`,
 * `bin` and `browser` name. A staged tree built by walking `files` therefore drops a README the moment one is
 * added, silently, since nothing else would notice — which is what this function exists to prevent.
 *
 * `--dry-run`, so nothing is written; `--ignore-scripts`, so a `prepack` in the manifest cannot run during a
 * build (measured: the list is identical either way for all three packages today, so the flag costs nothing and
 * closes that door); and an **absolute** path, because npm reads a relative one as a git shorthand and fails in
 * `git ls-remote`.
 */
export function workspacePackList(dir: string): Set<string> {
  const [{ files }] = npmPack<{ files: { path: string }[] }>(dir, ['--dry-run']);
  return new Set(files.map((file) => file.path));
}

/**
 * Packs `dir` into `destDir` and returns the tarball's path.
 *
 * **For a tool that wants the tarball rather than the file list**, which means `attw`: `attw --pack <dir>`
 * packs *inside* the tree it is checking and deletes the tarball afterwards, so a reader of that tree sees a
 * file appear and vanish — the recorded `ENOENT: open 'publish/apack-ui-0.1.0.tgz'`. Given a tarball path it
 * writes nothing at all, and `destDir` belongs to the caller.
 *
 * `destDir` is outside the repository for every caller here, and may be: nothing is renamed, so no filesystem
 * boundary matters, and neither consumer resolves a module relative to it — the tarball is read as bytes.
 */
export function packTree(dir: string, destDir: string): string {
  const [{ filename }] = npmPack<{ filename: string }>(dir, ['--pack-destination', path.resolve(destDir)]);
  return path.join(path.resolve(destDir), filename);
}

/**
 * `npm pack --json` over one directory, as JSON.
 *
 * Two things it gets right that are easy to leave out. `--ignore-scripts`, because anything a lifecycle script
 * printed lands on this stdout *before* npm's JSON (`@app/publish-checks`' `published-manifest-paths` holds
 * these manifests to publishing no `scripts` at all, so this is the second door rather than the only one), and
 * the guard, which names that as the cause if some other way is ever found. And an **absolute** path, because
 * npm reads a relative one as a git shorthand and fails in `git ls-remote`.
 */
function npmPack<T>(dir: string, args: readonly string[]): [T] {
  const packArgs = ['pack', '--json', '--ignore-scripts', ...args, path.resolve(dir)];
  const windows = process.platform === 'win32';
  if (windows) {
    // Launch the JS entry directly: npm.cmd requires a shell, which would reinterpret package paths.
    const entry = process.env.npm_execpath;
    packArgs.unshift(entry && path.basename(entry) === 'npm-cli.js'
      ? entry : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  const out = execFileSync(windows ? process.execPath : 'npm', packArgs,
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  if (!out.trimStart().startsWith('[')) {
    throw new Error(`npm pack printed something other than JSON for ${dir}:\n${out}`);
  }
  return JSON.parse(out) as [T];
}

/** Every file under `dir`, relative to it and `/`-separated: a staged tree in the form `npm pack` reports */
export function treeFiles(dir: string): Set<string> {
  return new Set(fs.readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(dir, file)).isFile()));
}

/**
 * Writes `<pkgDir>/publish/`: the derived manifest and a copy of everything `files` names, which is the tree
 * npm publishes. Returns it.
 *
 * `files` is kept in the derived manifest rather than dropped, so packing the staged tree is as explicit as
 * packing the source tree: without it npm would fall back to gitignore rules, and this tree sits inside a
 * gitignored directory. Then it checks the result, so a build that stages a short tree fails here rather than
 * shipping a manifest pointing at nothing — `@app/publish-checks` is the backstop, not the first line.
 */
export function stagePublishTree(pkgDir: string, manifest: Manifest): string {
  const name = String(manifest.name);
  const treeDir = path.join(pkgDir, PUBLISH_TREE);
  // The one thing npm's answer cannot give: with no `files` npm packs everything not ignored, so a manifest that
  // lost the field would stage `src/` and `tests/` and publish them, and every check here would pass.
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${name} names no "files", so a staged tree would be its whole working directory. Name what ships.`);
  }
  // Staged aside and renamed into place, so nothing ever *reads* a tree that is half a copy or absent — which
  // is the whole of what it buys, and worth saying because the obvious conclusion from it is wrong.
  //
  // **A rename is no protection from a second writer**, which is the other half of the recorded
  // `ENOENT: open 'publish/apack-ui-0.1.0.tgz'`: a tool packing a tarball *inside* one of these trees loses
  // it to the rename exactly as it lost it to an `rm`, since the whole directory is replaced either way. So
  // the answer there is not to write there at all — `packTree` above, and `scripts/packages-check.ts`, which
  // is the one other thing that wanted a tarball of a staged tree.
  //
  // Inside `pkgDir`, so the rename cannot cross a filesystem. `.temp/` is already gitignored for every
  // package, which matters: a tree that appears and vanishes under a name `git` reports is what the root
  // `.gitignore`'s `*.bundled_*` entry exists for, and eight specs take their population from `git ls-files`.
  const staged = path.join(pkgDir, '.temp', 'publish-staged');
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged, { recursive: true });
  // Exactly what npm would pack, so patterns, its force-included files and its default excludes are all its own
  // business rather than re-implemented here
  for (const file of workspacePackList(pkgDir)) {
    const to = path.join(staged, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(pkgDir, file), to);
  }
  // After the copy, because `package.json` is in that list: this is the one file the staged tree does not share
  // with the source tree
  const published = publishedManifest(manifest, pkgDir);
  fs.writeFileSync(path.join(staged, 'package.json'), `${JSON.stringify(published, null, 2)}\n`);
  // Checked before the swap, never after: a tree that failed this must not be the one readers find, and
  // swapping first would leave a short tree reading as the published one
  const missing = missingPublishedPaths(published, treeFiles(staged));
  if (missing.length > 0) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw new Error(`${name}'s published manifest names files the staged tree does not hold:\n`
      + `${missing.map((problem) => `  ${problem}`).join('\n')}\n`
      + 'Either "files" does not cover it, or the build did not write it.');
  }
  replaceDir(staged, treeDir);
  return treeDir;
}
