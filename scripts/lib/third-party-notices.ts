/**
 * The app's `THIRD-PARTY-NOTICES.txt`: the license and notices of every third-party package the packaged app carries,
 * which their licenses ask a redistribution to carry, written into the app by `afterPack` (`electron-builder.mjs`).
 * Beside it, the release's CycloneDX SBOM (`appSbom`) lists the same packages with their purls, hashes and declared
 * licenses, written next to the release files for the release workflows to upload.
 *
 * **What the app carries, three ways.**
 *
 *   - As files: every package under a `node_modules` of the packaged app. Each also keeps its own license files there
 *     (`packaged-app-files.spec.ts`); this lists it again so the notices are whole in one place.
 *   - Inlined into the app's own bundles: what the renderer, main, preload and server builds each recorded
 *     (`@apackdev/host/build/bundled-packages`, `recordBundledPackages`), from the staging build root.
 *   - Inlined into a built-in pack's bundles: what each bundle's source map, or esbuild's module comments in a bundle
 *     without one, names (`packBundledPackages`), with the bundlers' own injected code and the pack's CSS tooling. A
 *     pack's declared dependencies would not do: a pack can import a package hoisted into the repository's
 *     `node_modules` by another workspace, as the built-in pack does vidstack. Type declarations a pack rolls up into
 *     its `defs/` name the packages they come from only in their text, and are not read.
 *
 * **Where a package's text comes from**, first that applies: its own license, licence, notice and copying files, in
 * any case and with any extension; for a platform binary package, which ships none, its parent's (`PLATFORM_PARENTS`);
 * the committed texts of `OVERRIDES`, each with why. A package with none of these is a problem. To that, `EXTRAS` adds
 * the committed texts of what a package's binary is built from, which its own license does not cover.
 *
 * **What licenses it accepts** (`ACCEPTED`): the package's declared SPDX expression, taking from an OR the branch
 * whose license comes first in `ACCEPTED`. LGPL only for a package shipped as its own files, since inlined it would be
 * linked into the bundle; MPL, EPL and LGPL notices name where the package's source is, and CC-BY ones its creator.
 * Any other license, or an expression that does not parse, is a problem. A manifest that declares none that reads as
 * SPDX (`SEE LICENSE IN LICENSE`, `BSD`, `Apache 2.0`) is judged under the `license` its `OVERRIDES` entry gives, read
 * from the package's own license text, and held to `ACCEPTED` like any other.
 *
 * **A problem fails a production or beta build and is reported on a preview**, keyed on the build's channel: a
 * release must not ship without a notice it owes, and a developer's preview keeps building while one is being added.
 *
 * **Third-party code adapted into the app's own files** is credited at the end (`ADAPTED`): each file, where it is from,
 * and its license's texts, committed under `build/licenses/`. Every shipped source file that says it was adapted,
 * ported or copied from somewhere is named there or in `ADAPTED_FIRST_PARTY` (`uncreditedAdaptations`, which
 * `third-party-notices.spec.ts` runs over the tree).
 *
 * Native code carries notices of its own, which this points to rather than repeats: Electron's and Chromium's
 * (`scripts/lib/electron-notices.ts`), elmdb's binding's and the terminal broker's, each shipped beside its binary.
 * A missing one is a problem. The prebuilt binaries of npm packages ship no notices of their own: a package's license
 * covers its own code, and `EXTRAS` adds the texts of what a binary is built from that is not the package's own, Go
 * for esbuild's and ripgrep and PCRE2 for the `rg` @vscode/ripgrep's install downloads. The Rust standard library and
 * the crates compiled into Rollup's, keyring's and Linux's lzma's binaries carry no notice here.
 */
import { hash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import parse, { type Node as SpdxNode } from 'spdx-expression-parse';
import satisfies from 'spdx-satisfies';
import { bundledPackages, installedPackage, isFirstParty, type BundledPackage } from '@apackdev/host/build/bundled-packages';
import { PACK_BUILD_STAGING_DIR } from '@apackdev/host/build/pack-workdir';
import { OWNER, REPOSITORIES, releaseOf } from './external-packages.mjs';

/** A license, licence, notice or copying file, in any case and with any extension, the word anywhere in the name */
export const LICENSE_FILE = /(licen[cs]e|notice|copying)/i;

/** The SPDX licenses a package may be under, in the order one is chosen from an OR: the first here wins */
export const ACCEPTED = [
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'Zlib', 'Unlicense', 'CC0-1.0',
  'Python-2.0', 'CC-BY-4.0', 'MPL-2.0', 'EPL-2.0', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0-only',
  'LGPL-3.0-or-later',
] as const;

/** Licenses whose notice names where the source is: they ask a binary's recipient to be told how to obtain it */
const SOURCE_NAMED = /^(MPL|EPL|LGPL)-/;

/** Licenses whose notice names the creator and where the work is: Creative Commons attribution asks it */
const CREATOR_NAMED = /^CC-BY-/;

/** Creators a package's `author` does not name: caniuse-lite packages data created by caniuse.com */
const CREATORS: Readonly<Record<string, string>> = { 'caniuse-lite': 'Alexis Deveria, caniuse.com' };

/** Accepted only for a package shipped as its own files */
const SHIPPED_ONLY = /^LGPL-/;

/** Platform binary packages, which ship a prebuilt binary and no license file, and the package each belongs to */
export const PLATFORM_PARENTS: readonly (readonly [pattern: RegExp, parent: string])[] = [
  [/^@esbuild\//, 'esbuild'],
  [/^@rollup\/rollup-/, 'rollup'],
  [/^@napi-rs\/keyring-/, '@napi-rs/keyring'],
  [/^@msgpackr-extract\/msgpackr-extract-/, 'msgpackr-extract'],
  [/^@parcel\/watcher-/, '@parcel/watcher'],
];

/** Texts a package adds to its own, or a platform binary package to its parent's, for what its binary is built from */
export interface Extra {
  pattern: RegExp;
  /** Committed under `build/licenses/` */
  files: readonly string[];
  why: string;
  /**
   * For a binary the package's install downloads, the release the texts were read for, as the package's own code
   * declares it: a new release of the package can move the binary without its license files changing, so a build
   * carrying another release is a problem until the texts are read again (`staleExtras`)
   */
  readFor?: {
    file: string; declared: RegExp; release: string; reread: string;
    /**
     * The binary that release holds, for the SBOM (`downloadedBinaries`): what it is a build of, at which version, the
     * GitHub repository whose release it is downloaded from, and where the install leaves it in the package
     */
    binary: { name: string; version: string; repository: string; license: string; file: string };
  };
}

export const EXTRAS: readonly Extra[] = [
  { pattern: /^@esbuild\//, files: ['go-LICENSE'], why: "esbuild's binary is built with Go, whose license asks a binary to carry its notice" },
  {
    pattern: /^@vscode\/ripgrep$/,
    files: ['ripgrep-COPYING', 'ripgrep-LICENSE-MIT', 'ripgrep-UNLICENSE', 'pcre2-LICENCE.md'],
    why: "its install downloads bin/rg from microsoft/ripgrep-prebuilt: ripgrep, built with PCRE2, under licenses that ask a binary to carry them, where the package's own is Microsoft's, for its wrapper",
    // ripgrep-prebuilt v15.0.1 is ripgrep 15.0.0 built with +pcre2, and its Cargo.lock's pcre2-sys 0.2.10 bundles PCRE2 10.46
    readFor: {
      file: 'lib/postinstall.js', declared: /^const VERSION = '([^']+)';$/m, release: 'v15.0.1',
      reread: "ripgrep's LICENSE-MIT, UNLICENSE and COPYING at the ripgrep tag that release builds, and the LICENCE of the PCRE2 its Cargo.lock's pcre2-sys bundles",
      binary: { name: 'ripgrep', version: '15.0.0', repository: 'microsoft/ripgrep-prebuilt', license: 'Unlicense OR MIT', file: 'bin/rg' },
    },
  },
];

/** What a package's own files don't say, or say unreadably, with why */
export interface Override {
  /** The package's license texts, committed under `build/licenses/`, for one that ships no license file; else empty */
  files: readonly string[];
  /**
   * The SPDX expression the package is under, as its license text reads, for one whose manifest declares none that
   * reads as SPDX. It is held to `ACCEPTED` as a declared one is, and is never read over a manifest's that does parse
   */
  license?: string;
  why: string;
  /** The one platform whose build carries the package */
  platform?: NodeJS.Platform;
}

/**
 * Texts for packages that ship no license file, and licenses for packages whose manifest declares none that reads as
 * SPDX, each with why. One a single platform's build carries, a platform binary whose parent isn't installed, names
 * that platform: a build for another doesn't carry the package, and doesn't call the override stale for it
 */
export const OVERRIDES: Readonly<Record<string, Override>> = {
  dlv: { files: ['dlv-LICENSE'], why: 'declares MIT and ships no license file, nor does its repository' },
  '@ai-sdk/provider-utils': {
    files: ['vercel-ai-LICENSE', 'Apache-2.0.txt'],
    why: "ships no license file; its repository's (vercel/ai) is Apache-2.0's notice, and the license is its full text",
  },
  '@napi-rs/lzma-linux-x64-gnu': {
    files: ['napi-rs-lzma-LICENSE'],
    why: "Rollup's optional dependency on Linux x64, without its parent @napi-rs/lzma: it declares MIT, and neither it, its parent nor their repository ships a license file",
    platform: 'linux',
  },
};

/** A file of the app's own adapted from third-party code: where it is from, under what, and the texts that license asks for */
export interface Adaptation {
  /** The file, from the repository's root */
  file: string;
  upstream: string;
  license: string;
  /** Committed under `build/licenses/` */
  files: readonly string[];
}

/** The app's own files adapted from third-party code */
export const ADAPTED: readonly Adaptation[] = [
  {
    file: 'packages/default-setup/src/content/actions/codex/_helpers/goal-prompts.ts',
    upstream: "OpenAI Codex's goal templates, https://github.com/openai/codex, codex-rs/ext/goal/templates/goals",
    license: 'Apache-2.0',
    // Apache-2.0 asks a derivative work to carry the license and the upstream's NOTICE
    files: ['codex-LICENSE', 'codex-NOTICE'],
  },
  {
    file: 'packages/apack-host/src/features/application/fe/input.ts',
    upstream: "VueUse's useMagicKeys, https://github.com/vueuse/vueuse, packages/core/useMagicKeys",
    license: 'MIT',
    files: ['vueuse-LICENSE'],
  },
];

/** What a source file says when its code came from elsewhere */
export const SAYS_ADAPTED = /\b(adapted|ported|copied) from\b/i;

/** Shipped source files that say so of first-party code, each with why, which `uncreditedAdaptations` passes over */
export const ADAPTED_FIRST_PARTY: Readonly<Record<string, string>> = {};

/** Whether a file, from the repository's root, is source the app ships code from: in a package's `src/` or `native/`, and not a guide */
export const shippedSource = (file: string): boolean => /^(packages\/[^/]+\/src|native)\//.test(file)
  && path.posix.basename(file) !== 'CLAUDE.md' && /\.([cm]?[jt]sx?|vue|css|html|md|swift|ps1|sh)$/.test(file);

/**
 * Of the files given, from the repository's root, each shipped source file that says it was adapted from elsewhere
 * and that `adapted` does not credit, nor
 * `firstParty` excuse, and each entry of either naming a file that no longer says so, as a problem
 */
export function uncreditedAdaptations(
  sources: readonly { file: string; text: string }[],
  adapted: readonly Adaptation[] = ADAPTED,
  firstParty: Readonly<Record<string, string>> = ADAPTED_FIRST_PARTY,
): string[] {
  const saying = new Set(sources.filter(({ file, text }) => shippedSource(file) && SAYS_ADAPTED.test(text)).map(({ file }) => file));
  const named = new Set([...adapted.map(({ file }) => file), ...Object.keys(firstParty)]);
  return [
    ...saying.difference(named).values().map((file) =>
      `${file} says its code was adapted from elsewhere, and ADAPTED does not credit it: add it with its upstream's license, or to ADAPTED_FIRST_PARTY with why`),
    ...named.difference(saying).values().map((file) =>
      `${file} is named in ADAPTED or ADAPTED_FIRST_PARTY, and no shipped source by that name says it was adapted from anything: remove it, and its texts`),
  ];
}

/** How the app carries a package: as its own files, inlined into a bundle, or both */
export type Carried = 'files' | 'inlined' | 'both';

export interface NoticePackage extends BundledPackage {
  carried: Carried;
}

/** Packages in a fixed order whatever the machine's locale: the notices are compared across machines */
const byNameAndVersion = (a: { name: string; version: string }, b: { name: string; version: string }) =>
  (`${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : `${a.name}@${a.version}` > `${b.name}@${b.version}` ? 1 : 0);

const CARRIED_LABEL: Record<Carried, string> = { files: 'shipped', inlined: 'inlined', both: 'shipped and inlined' };

/** One package's notice: what it is under, and the text the notices give for it */
export interface PackageNotice {
  package: NoticePackage;
  /** The SPDX expression the package is judged under: what it declares, or its override's `license` (`judgedLicense`) */
  declared: string;
  /** What the notices name it under, chosen from `declared` */
  license: string;
  text: string;
  source?: string;
}

/**
 * The SPDX expression a manifest declares, or `undefined`: a `license` string, or the legacy `license` object or
 * `licenses` array, which are joined with OR
 */
export function declaredLicense(manifest: { license?: unknown; licenses?: unknown }): string | undefined {
  const named = (entry: unknown) => (typeof entry === 'string' ? entry : (entry as { type?: string } | null)?.type);
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license) return named(manifest.license);
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map(named).filter(Boolean).join(' OR ') || undefined;
  return undefined;
}

/** Whether what a manifest declares reads as an SPDX expression */
function readsAsSpdx(declared: string | undefined): declared is string {
  if (!declared) return false;
  try { parse(declared); return true; } catch { return false; }
}

/**
 * The expression a package is judged under: what its manifest declares when that reads as SPDX, whatever license it
 * names, and otherwise its override's `license`, when it gives one
 */
export function judgedLicense(declared: string | undefined, override: Override | undefined): string | undefined {
  return readsAsSpdx(declared) ? declared : override?.license ?? declared;
}

/** An expression tree written back as an SPDX expression, with or without its exceptions */
function spdxText(node: SpdxNode, exceptions = true): string {
  if ('license' in node) return `${node.license}${node.plus ? '+' : ''}${exceptions && node.exception ? ` WITH ${node.exception}` : ''}`;
  const [left, right] = [spdxText(node.left, exceptions), spdxText(node.right, exceptions)];
  return node.conjunction === 'and' ? `${left} AND ${right}` : `(${left} OR ${right})`;
}

/**
 * The accepted license an SPDX expression comes to, or `undefined` when it is not accepted or does not parse.
 * `spdx-expression-parse` reads the expression, refusing what is not SPDX (`MIT and ISC`, whose operators are not
 * upper case, or `(MIT`), and `spdx-satisfies` decides whether it is accepted, `+` and `-or-later` included. A `WITH`
 * exception only grants more than its license does, so a license with one is judged as the license, and the notices
 * name it with the exception. What is chosen is what the notices name: an AND comes to all of its parts, and an OR to
 * its accepted branch whose parts are each satisfied earliest in `ACCEPTED`.
 */
export function chooseLicense(expression: string, carried: Carried): string | undefined {
  const allowed = ACCEPTED.filter((id) => !(carried !== 'files' && SHIPPED_ONLY.test(id)));
  let tree: SpdxNode;
  try { tree = parse(expression); } catch { return undefined; }
  const fine = (node: SpdxNode) => satisfies(spdxText(node, false), allowed);
  if (!fine(tree)) return undefined;
  // Where in ACCEPTED a chosen license first satisfies, so `MIT OR LGPL-2.1+` names MIT, as `LGPL-2.1+` is satisfied
  // only by a later entry, whatever ids spdx-satisfies reads it as
  const position = (part: SpdxNode) => allowed.findIndex((id) => satisfies(spdxText(part, false), [id]));
  const parts = (node: SpdxNode): SpdxNode[] => ('license' in node || node.conjunction === 'or' ? [node] : [...parts(node.left), ...parts(node.right)]);
  const choose = (node: SpdxNode): SpdxNode => {
    if ('license' in node) return node;
    if (node.conjunction === 'and') return { left: choose(node.left), conjunction: 'and', right: choose(node.right) };
    const rank = (branch: SpdxNode) => Math.max(...parts(branch).map(position));
    return [node.left, node.right].filter(fine).map(choose).sort((x, y) => rank(x) - rank(y))[0];
  };
  return spdxText(choose(tree));
}

/** Every license an SPDX expression names, without its `+` or exceptions: each part of an AND, each branch of an OR */
function licensesIn(expression: string): string[] {
  const leaves = (node: SpdxNode): string[] => ('license' in node ? [node.license] : [...leaves(node.left), ...leaves(node.right)]);
  return leaves(parse(expression));
}

/** A package's own license files, read, sorted by name */
function ownLicenseTexts(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && LICENSE_FILE.test(entry.name)
      && fs.statSync(path.join(dir, entry.name)).isFile())
    .map((entry) => entry.name).sort()
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n').trim());
}

/** The packages directly under a `node_modules`, scoped ones included, linked ones resolved to their real directory */
function packagesIn(nodeModules: string): string[] {
  if (!fs.existsSync(nodeModules)) return [];
  const isDir = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() === true;
  return fs.readdirSync(nodeModules)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) => (name.startsWith('@') && isDir(path.join(nodeModules, name))
      ? fs.readdirSync(path.join(nodeModules, name)).map((scoped) => path.join(nodeModules, name, scoped))
      : [path.join(nodeModules, name)]))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')));
}


function manifestOf(dir: string): { name: string; version?: string; license?: unknown; licenses?: unknown; repository?: unknown; author?: unknown } {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
}

/** Every package under every `node_modules` of the packaged app, nested ones included, by the directory it is in */
export function shippedPackages(appDir: string): NoticePackage[] {
  const found: NoticePackage[] = [];
  const workspaces = path.join(appDir, 'packages');
  const queue = [path.join(appDir, 'node_modules'), ...(fs.existsSync(workspaces) ? fs.readdirSync(workspaces, { withFileTypes: true }) : [])
    .filter((entry) => entry.isDirectory()).map((entry) => path.join(workspaces, entry.name, 'node_modules'))];
  while (queue.length) {
    for (const dir of packagesIn(queue.pop()!)) {
      const manifest = manifestOf(dir);
      if (!isFirstParty(manifest.name)) found.push({ name: manifest.name, version: manifest.version ?? '0.0.0', dir, carried: 'files' });
      queue.push(path.join(dir, 'node_modules'));
    }
  }
  return found;
}

/** The packages a module path runs through `node_modules` to, outermost first */
const namedThrough = (module: string): string[] => [...module.matchAll(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g)].map(([, name]) => name.replace('\\', '/'));

/**
 * The package a module path runs through `node_modules` to, by its names alone, for a path that is no file: found from
 * `fromDir` one `node_modules` at a time, as Node finds a nested install. It throws for a name that isn't installed,
 * so a nested package that is gone is never taken for the one it was nested in
 */
function installedThrough(names: readonly string[], fromDir: string): BundledPackage {
  let found = installedPackage(names[0], fromDir);
  for (const name of names.slice(1)) found = installedPackage(name, found.dir);
  return found;
}

/** A path to a script with no space in it, which a `// ` line naming no file is still taken for a module by */
const SCRIPT_PATH = /^\S+\.[cm]?[jt]sx?$/;

/**
 * Every third-party package a built pack's bundles inlined, read from the bundles themselves: a bundle with a source
 * map names its modules in the map's `sources`, relative to the map; one without, as esbuild writes a pack's build
 * helpers, names each module in a `// <path>` comment, relative to the pack, whatever the module is: a script, a
 * package's JSON, a path with spaces. A bundle with neither cannot say what it inlined, and is a problem rather than an
 * empty list.
 *
 * **A module is its package's by where its file is** (`packageOf`): a pack can inline another workspace's or a
 * dependency's copy of a package the pack itself would resolve at another version. Only a module that is no file is told
 * by the names in its path, and one whose names don't resolve is a problem.
 *
 * A pack's CSS says nothing of where it came from, so a package a pack takes only CSS from is not found here.
 */
export function packBundledPackages(packDir: string): { packages: NoticePackage[]; problems: string[] } {
  const dist = path.join(packDir, 'dist');
  const noBundle = `${dist} holds no bundle: build the pack before packaging`;
  if (!fs.existsSync(dist)) return { packages: [], problems: [noBundle] };
  const bundles = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(c|m)?js$/.test(file));
  const ids: string[] = [];
  const named = new Map<string, BundledPackage>();
  const problems: string[] = [];
  const isFile = (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  const credit = (module: string, resolved: string, unknown: string) => {
    if (isFile(resolved)) { ids.push(resolved); return; }
    const names = namedThrough(module);
    if (!names.length) { problems.push(unknown); return; }
    try {
      const installed = installedThrough(names, packDir);
      named.set(installed.dir, installed);
    } catch (error) { problems.push(`${unknown}: ${(error as Error).message}`); }
  };
  for (const bundle of bundles) {
    const file = path.join(dist, bundle);
    const name = path.relative(packDir, file);
    if (fs.existsSync(`${file}.map`)) {
      const { sources = [] } = JSON.parse(fs.readFileSync(`${file}.map`, 'utf8')) as { sources?: string[] };
      // A pack is built in a staging directory and copied, so a source's relative path is the staging directory's
      const staged = path.join(packDir, PACK_BUILD_STAGING_DIR, path.dirname(bundle));
      for (const entry of sources) {
        // A source no relative path reaches, such as one on another drive than the map on Windows, is a `file:` URL
        const source = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
        // A bundler's own virtual module, which `packageOf` knows by its id, unless it is a package's file under a query
        if (source.startsWith('\0') && !namedThrough(source).length) { ids.push(source); continue; }
        const module = (source.startsWith('\0') ? source.slice(1) : source).split('?')[0];
        credit(module, path.resolve(staged, module), `${name}.map names ${source}, which is not where its build left it, so its package is unknown`);
      }
      continue;
    }
    // esbuild keeps no comment of the source's but a legal one, so a `// ` line is a module's, or text inside a string:
    // one naming a file is a module, and one naming none is taken for a module only when it looks like a script's path
    const modules = [...fs.readFileSync(file, 'utf8').matchAll(/^\/\/ (.+)$/gm)].map(([, module]) => module)
      .filter((module) => isFile(path.resolve(packDir, module)) || SCRIPT_PATH.test(module));
    for (const module of modules) credit(module, path.resolve(packDir, module), `${name} names ${module}, which is not there, so its package is unknown`);
    if (!modules.length) problems.push(`${name} has no source map and names no module, so what it inlined is unknown`);
  }
  if (!bundles.length) problems.push(noBundle);
  // What the bundlers inject with no module of a package: esbuild's and Vite's helpers, plugin-vue's, and the pack's
  // CSS, which Tailwind writes (the pack builder runs every pack's CSS through it)
  const css = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).some((file) => file.endsWith('.css'));
  const injected = ['esbuild', 'vite', '@vitejs/plugin-vue', ...(css ? ['tailwindcss'] : [])];
  let fromModules: BundledPackage[] = [];
  try {
    // Two esbuilds write a pack's bundles: the one the pack builder calls for the build helpers, and the one Vite
    // depends on, which transforms and minifies the frontend and is another install when Vite asks for a newer one
    fromModules = [...bundledPackages(ids, packDir, injected), installedPackage('esbuild', installedPackage('vite', packDir).dir)];
  } catch (error) { problems.push((error as Error).message); }
  const found = new Map([...fromModules, ...named.values()].map((pkg) => [pkg.dir, pkg]));
  const packages = [...found.values()].filter((pkg) => !isFirstParty(pkg.name)).map((pkg) => ({ ...pkg, carried: 'inlined' as const }));
  return { packages, problems };
}

/** The repository URL a manifest names, or `undefined` */
function repositoryOf(manifest: { repository?: unknown; name: string }): string | undefined {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository as { url?: string } | undefined)?.url;
  if (!repository) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return `https://github.com/${repository}`;
  return repository.replace(/^git\+/, '').replace(/\.git$/, '');
}

/** The package a platform binary package belongs to, at its own version, which a release of both is published at */
function parentOf(pkg: NoticePackage, byName: ReadonlyMap<string, readonly NoticePackage[]>): NoticePackage | undefined {
  const parentName = PLATFORM_PARENTS.find(([pattern]) => pattern.test(pkg.name))?.[1];
  const parents = parentName ? byName.get(parentName) ?? [] : [];
  return parents.find((candidate) => candidate.version === pkg.version) ?? parents[0];
}

/** What a package's manifest declares as its license, or its parent's for a platform binary package that declares none */
function statedLicense(pkg: NoticePackage, byName: ReadonlyMap<string, readonly NoticePackage[]>): string | undefined {
  const parent = parentOf(pkg, byName);
  return declaredLicense(manifestOf(pkg.dir)) ?? (parent && declaredLicense(manifestOf(parent.dir)));
}

/** One package's notice, or the problem that keeps it from having one */
export function noticeOf(
  pkg: NoticePackage, licensesDir: string, byName: ReadonlyMap<string, readonly NoticePackage[]>, overrides: Readonly<Record<string, Override>> = OVERRIDES,
): PackageNotice | string {
  const manifest = manifestOf(pkg.dir);
  const label = `${pkg.name}@${pkg.version} (${CARRIED_LABEL[pkg.carried]})`;
  const parent = parentOf(pkg, byName);
  const override = overrides[pkg.name] as Override | undefined;
  const stated = statedLicense(pkg, byName);
  const declared = judgedLicense(stated, override);
  // What to do about a manifest that is the trouble, said only while no override answers it
  const unreadable = declared === stated && !readsAsSpdx(stated)
    ? ": when its own license text is one ACCEPTED names, give that as the license of its OVERRIDES entry, with why" : '';
  if (!declared) return `${label} declares no license${unreadable}`;
  const license = chooseLicense(declared, pkg.carried);
  if (!license) return `${label} is under ${declared}, which does not parse as SPDX or which this app may not ${pkg.carried === 'files' ? 'ship' : 'inline'} (ACCEPTED)${unreadable}`;
  let texts = ownLicenseTexts(pkg.dir);
  if (!texts.length && parent) texts = ownLicenseTexts(parent.dir);
  if (!texts.length && override) {
    texts = override.files.map((file) => fs.readFileSync(path.join(licensesDir, file), 'utf8').replace(/\r\n/g, '\n').trim());
  }
  if (!texts.length) return `${label} ships no license file: add its text to OVERRIDES, with why`;
  for (const { pattern, files } of EXTRAS) {
    if (pattern.test(pkg.name)) texts = [...texts, ...files.map((file) => fs.readFileSync(path.join(licensesDir, file), 'utf8').replace(/\r\n/g, '\n').trim())];
  }
  const where = `${repositoryOf(manifest) ?? 'npm'}, ${pkg.name} ${pkg.version}`;
  const author = typeof manifest.author === 'string' ? manifest.author : (manifest.author as { name?: string } | undefined)?.name;
  // Any license the package is named under can ask for these, so `MIT AND MPL-2.0` names the source as MPL-2.0 does
  const named = licensesIn(license);
  const creator = named.some((id) => CREATOR_NAMED.test(id));
  const source = creator || named.some((id) => SOURCE_NAMED.test(id))
    ? `${where}${creator ? `; created by ${CREATORS[pkg.name] ?? author ?? 'its authors'}` : ''}` : undefined;
  return { package: pkg, declared, license, text: texts.join('\n\n'), source };
}

/**
 * The packages whose binary is another release than their `EXTRAS`' texts were read for, or whose code no longer says
 * which release it downloads, each as a problem
 */
export function staleExtras(packages: readonly NoticePackage[]): string[] {
  return packages.flatMap((pkg) => EXTRAS.flatMap(({ pattern, readFor }) => {
    if (!readFor || !pattern.test(pkg.name)) return [];
    const file = path.join(pkg.dir, readFor.file);
    const declared = fs.existsSync(file) ? readFor.declared.exec(fs.readFileSync(file, 'utf8'))?.[1] : undefined;
    if (!declared) return [`${pkg.name}@${pkg.version}'s ${readFor.file} no longer says which release of its binary it downloads, so EXTRAS' texts for it cannot be checked: find where it does, and update readFor`];
    if (declared === readFor.release) return [];
    return [`${pkg.name}@${pkg.version} downloads ${declared}, and EXTRAS' texts for it were read for ${readFor.release}: re-read ${readFor.reread}, then update them and readFor`];
  }));
}

/**
 * The notices' text: a header naming what else carries notices, then each distinct text with the packages it covers,
 * then each file of the app's own adapted from third-party code, with its texts
 */
export function renderNotices(notices: readonly PackageNotice[], pointers: readonly string[], adapted: readonly (Adaptation & { text: string })[] = []): string {
  const groups = Map.groupBy(notices, (notice) => notice.text);
  const line = (notice: PackageNotice) => `  ${notice.package.name} ${notice.package.version}, ${notice.license}, `
    + `${CARRIED_LABEL[notice.package.carried]}${notice.source ? `; source: ${notice.source}` : ''}`;
  const sorted = (lines: string[]) => [...new Set(lines)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sections = [...groups.entries()]
    .map(([text, covered]) => {
      const lines = sorted(covered.map(line));
      return { key: lines[0], body: `${'='.repeat(80)}\nCovering:\n${lines.join('\n')}\n\n${text}\n` };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ body }) => body);
  return [
    'THIRD-PARTY NOTICES',
    '',
    "apack is built from its own code and from third-party packages, each under its own license. This file holds the",
    'license and notices of each package the app carries, as files under its node_modules or inlined into its',
    "bundles; a package carried as files also keeps its own license files beside it. It ends with the licenses of",
    "third-party code adapted into apack's own files. Native code carries its own notices beside it:",
    '',
    ...pointers.map((pointer) => `  - ${pointer}`),
    '',
    ...sections,
    ...[...adapted].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)).map(({ file, upstream, license, text }) =>
      `${'='.repeat(80)}\nAdapted into apack's own code:\n  ${file}, from ${upstream}, ${license}\n\n${text}\n`),
  ].join('\n');
}

/** A component of the app's SBOM beside its third-party packages: its runtime, a binary it ships, or a file of one */
export interface SbomComponent {
  type: 'framework' | 'application' | 'library' | 'file';
  name: string;
  version?: string;
  /** Where it is from; a file has none, and is named by the component that holds it */
  purl?: string;
  license?: string;
  /** The SHA-256 of the file it is, in hex */
  sha256?: string;
  /** What is shipped inside it: the libraries a runtime builds in, the files beside a binary */
  components?: readonly SbomComponent[];
}

/** An npm package's purl, whose scope's `@` is encoded */
export const npmPurl = (name: string, version: string) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;

/** How the SBOM names a package: its purl, and its hash where the lockfile records one */
export interface SbomIdentity {
  /** A package not from npm, by name, such as another of our repositories' release: the purl naming it where it is from */
  purls: Readonly<Record<string, string>>;
  /** The lockfile's integrity of a package, `sha512-<base64>`, by `name@version` */
  integrity: ReadonlyMap<string, string>;
}

/**
 * A license entry of a CycloneDX component, which the schema holds to SPDX: a plain SPDX license as an id, any other
 * SPDX expression (`MIT+`, `LicenseRef-…`, `MIT OR ISC`) as an expression, and what is not SPDX (`UNLICENSED`, `BSD`)
 * as a name
 */
function sbomLicenses(declared: string): object[] {
  let tree: SpdxNode;
  try { tree = parse(declared); } catch { return [{ license: { name: declared } }]; }
  const plain = 'license' in tree && !tree.plus && !tree.exception && !tree.license.startsWith('LicenseRef-') && !tree.license.startsWith('DocumentRef-');
  return plain ? [{ license: { id: declared } }] : [{ expression: declared }];
}

/**
 * The app's CycloneDX 1.5 SBOM: the app, every third-party package it carries with the license it is judged under, how
 * it is carried and its hash, and the other components given, each with what is shipped inside it. Every package
 * carried is listed, whether or not its notice could be written, so a preview's SBOM is whole too. No timestamp or
 * serial number, so the same app writes the same file.
 */
export function appSbom(
  app: { name: string; version: string }, packages: readonly NoticePackage[], identity: SbomIdentity, others: readonly SbomComponent[],
  overrides: Readonly<Record<string, Override>> = OVERRIDES,
): object {
  const libraries = packages.map((pkg) => {
    const purl = identity.purls[pkg.name] ?? npmPurl(pkg.name, pkg.version);
    const declared = judgedLicense(declaredLicense(manifestOf(pkg.dir)), overrides[pkg.name]);
    const integrity = identity.integrity.get(`${pkg.name}@${pkg.version}`);
    const sha512 = integrity?.startsWith('sha512-') ? Buffer.from(integrity.slice(7), 'base64').toString('hex') : undefined;
    return {
      type: 'library',
      'bom-ref': purl,
      name: pkg.name,
      version: pkg.version,
      purl,
      ...(sha512 ? { hashes: [{ alg: 'SHA-512', content: sha512 }] } : {}),
      ...(declared ? { licenses: sbomLicenses(declared) } : {}),
      properties: [{ name: 'apack:carried', value: CARRIED_LABEL[pkg.carried] }],
    };
  });
  const appRef = `app:${app.name}@${app.version}`;
  const byRef = (a: { 'bom-ref': string }, b: { 'bom-ref': string }) => (a['bom-ref'] < b['bom-ref'] ? -1 : a['bom-ref'] > b['bom-ref'] ? 1 : 0);
  // A component with no purl is one of the component holding it, whose reference its own extends to stay the only one
  const other = (component: SbomComponent, within: string): Record<string, unknown> & { 'bom-ref': string } => {
    const ref = component.purl ?? `${within}#${component.name}`;
    return {
      type: component.type,
      'bom-ref': ref,
      name: component.name,
      ...(component.version ? { version: component.version } : {}),
      ...(component.purl ? { purl: component.purl } : {}),
      ...(component.sha256 ? { hashes: [{ alg: 'SHA-256', content: component.sha256 }] } : {}),
      ...(component.license ? { licenses: sbomLicenses(component.license) } : {}),
      ...(component.components?.length ? { components: component.components.map((held) => other(held, ref)).sort(byRef) } : {}),
    };
  };
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component: { type: 'application', 'bom-ref': appRef, name: app.name, version: app.version } },
    components: [...libraries, ...others.map((component) => other(component, appRef))].sort(byRef),
  };
}

/**
 * The binaries the carried packages' installs downloaded, as SBOM components: each `EXTRAS` entry's `readFor.binary`,
 * at the release its texts were read for, with the hash of the file the app carries. A package downloading another
 * release adds none: which version of what that release holds is unread, and `staleExtras` reports it.
 */
export function downloadedBinaries(packages: readonly NoticePackage[]): SbomComponent[] {
  const found = new Map<string, SbomComponent>();
  for (const pkg of packages) {
    for (const { pattern, readFor } of EXTRAS) {
      if (!readFor || !pattern.test(pkg.name) || staleExtras([pkg]).length) continue;
      const { binary, release } = readFor;
      const file = [binary.file, `${binary.file}.exe`].map((name) => path.join(pkg.dir, name)).find((candidate) => fs.existsSync(candidate));
      const purl = `pkg:github/${binary.repository}@${release}`;
      found.set(purl, {
        type: 'application', name: binary.name, version: binary.version, purl, license: binary.license,
        ...(file ? { sha256: hash('sha256', fs.readFileSync(file), 'hex') } : {}),
      });
    }
  }
  return [...found.values()];
}

/** The commit a release tarball was packed from, as its URL names it (`external-packages.mjs`'s `releaseOf`) */
const releaseCommit = (resolved: string | undefined) => (resolved === undefined ? undefined : releaseOf(resolved)?.commit);

/**
 * The terminal broker as an SBOM component, from the platform package that carries it in the app (`brokerDirectory`):
 * the commit its release was built from, which the lockfile's URL for the package names, the hash of its binary, and
 * each file beside the binary with its own hash; or `undefined` when the app carries no broker
 */
export function brokerSbomComponent(repoRoot: string, appDir: string, platform: string): SbomComponent | undefined {
  const dir = brokerDirectory(appDir, platform);
  if (dir === undefined) return undefined;
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as { packages: Record<string, { resolved?: string }> };
  const commit = releaseCommit(lock.packages[`node_modules/${BROKER_PACKAGE_PREFIX}${platform}`]?.resolved);
  const sha256 = (file: string) => hash('sha256', fs.readFileSync(path.join(dir, file)), 'hex');
  const files = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile() && name !== 'package.json').sort();
  const binary = files.find((name) => name === 'apack-terminal' || name === 'apack-terminal.exe');
  return {
    type: 'application', name: 'apack-terminal', license: 'MIT OR Apache-2.0',
    ...(commit ? { version: commit, purl: `pkg:github/${OWNER}/apack-terminal@${commit}` } : {}),
    ...(binary ? { sha256: sha256(binary) } : {}),
    components: files.filter((name) => name !== binary).map((name) => ({ type: 'file' as const, name, sha256: sha256(name) })),
  };
}

/**
 * The SBOM's identity for the packages of a repository: those another of ours publishes as a release's tarball
 * (`external-packages.mjs`), as GitHub purls at the commit the lockfile's URL for each names, with the package's
 * directory in its repository as the purl's subpath, so two from one repository are told apart; and the lockfile's
 * integrity of every package it holds one for, which those tarballs have as a registry's packages do. A package
 * installed from elsewhere, a local checkout's, has no purl here
 */
export function sbomIdentity(repoRoot: string): SbomIdentity {
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; integrity?: string; name?: string; resolved?: string }> };
  const purls: Record<string, string> = {};
  for (const [repo, { packages }] of Object.entries(REPOSITORIES)) {
    for (const [name, { dir }] of Object.entries(packages)) {
      const commit = releaseCommit(lock.packages[`node_modules/${name}`]?.resolved);
      if (commit) purls[name] = `pkg:github/${OWNER}/${repo}@${commit}${dir === '.' ? '' : `#${dir}`}`;
    }
  }
  const integrity = new Map<string, string>();
  for (const [key, entry] of Object.entries(lock.packages)) {
    const name = entry.name ?? key.split('node_modules/').pop();
    if (name && entry.version && entry.integrity && !integrity.has(`${name}@${entry.version}`)) integrity.set(`${name}@${entry.version}`, entry.integrity);
  }
  return { purls, integrity };
}

/**
 * Everything the notices cover, one entry per name and version: the app's copy of a package and the repository's
 * copy a bundle inlined are one package, carried both ways
 */
export function noticePackages(sources: readonly (readonly NoticePackage[])[]): NoticePackage[] {
  const byRelease = new Map<string, NoticePackage>();
  for (const pkg of sources.flat()) {
    const key = `${pkg.name}@${pkg.version}`;
    const held = byRelease.get(key);
    byRelease.set(key, held && held.carried !== pkg.carried ? { ...held, carried: 'both' } : held ?? pkg);
  }
  return [...byRelease.values()].sort(byNameAndVersion);
}

/** The name of the package holding the terminal broker for a platform, but for the platform (`darwin-arm64`) */
const BROKER_PACKAGE_PREFIX = '@apackdev/terminal-';

/**
 * The directory holding the terminal broker in the packaged app, for the build's own `<platform>` (`darwin-arm64`, as
 * `process.platform` and `process.arch` name it): the binary in `@apackdev/terminal`'s platform package, beside the
 * notices its release ships; or `undefined` when the app carries no broker for it
 */
export function brokerDirectory(appDir: string, platform: string): string | undefined {
  const pkg = path.join(appDir, 'node_modules', `${BROKER_PACKAGE_PREFIX}${platform}`);
  if (!fs.existsSync(pkg)) return undefined;
  const holds = (dir: string) => ['apack-terminal', 'apack-terminal.exe'].some((name) => fs.existsSync(path.join(dir, name)));
  return [pkg, ...fs.readdirSync(pkg, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => path.join(pkg, entry.name))]
    .find(holds);
}

/** The terminal broker's notices in the packaged app, beside its binary (`brokerDirectory`), or `undefined` with no broker */
export function brokerNoticesFile(appDir: string, platform: string): string | undefined {
  const dir = brokerDirectory(appDir, platform);
  return dir === undefined ? undefined : path.join(dir, 'THIRD-PARTY-NOTICES');
}

/** A bundle record written by `recordBundledPackages` */
export function readBundleRecord(file: string): NoticePackage[] {
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: the build that wrote the bundles did not record what they inlined`);
  const { packages } = JSON.parse(fs.readFileSync(file, 'utf8')) as { packages: BundledPackage[] };
  return packages.map((pkg) => ({ ...pkg, carried: 'inlined' as const }));
}

/**
 * Writes `THIRD-PARTY-NOTICES.txt` into the packaged app, and the SBOM where `sbom` says, answering the problems found:
 * on a production or beta build they throw, failing the build, and on a preview they are returned for the caller to
 * report.
 */
export function writeAppNotices(options: {
  appDir: string;
  /** The staging build root, holding each app workspace's bundle record */
  buildRoot: string;
  bundleRecords: readonly string[];
  /** The built-in packs whose bundles the app ships, by their directory in the repository */
  packDirs: readonly string[];
  /** `build/licenses/`, holding the texts of `OVERRIDES`, `EXTRAS` and `ADAPTED` */
  licensesDir: string;
  channel: string;
  /** The platform the app is built for, which decides which of `OVERRIDES` it carries */
  platform: NodeJS.Platform;
  /**
   * What else carries notices, named in the header, each with the files it names, which have to exist, or `null` when
   * its binary is missing, and why the pointer may be wrong, when it may
   */
  native: readonly { pointer: string; files?: readonly string[] | null; problem?: string }[];
  /** What the packages' own files don't say: `OVERRIDES`, unless given */
  overrides?: Readonly<Record<string, Override>>;
  /** Where to write the app's CycloneDX SBOM (`appSbom`), with what it names beside the packages and the binaries their installs downloaded */
  sbom?: { file: string; app: { name: string; version: string }; identity: SbomIdentity; others: readonly SbomComponent[] };
}): string[] {
  const problems: string[] = [];
  const overrides = options.overrides ?? OVERRIDES;
  const records = options.bundleRecords.flatMap((file) => {
    try { return readBundleRecord(file); } catch (error) { problems.push((error as Error).message); return []; }
  });
  const packs = options.packDirs.map(packBundledPackages);
  problems.push(...packs.flatMap((pack) => pack.problems));
  const packages = noticePackages([shippedPackages(options.appDir), records, ...packs.map((pack) => pack.packages)]);
  if (!packages.length) problems.push('No third-party package was found, which no build of this app carries');
  const byName = Map.groupBy(packages, (pkg) => pkg.name);
  const notices: PackageNotice[] = [];
  for (const pkg of packages) {
    const notice = noticeOf(pkg, options.licensesDir, byName, overrides);
    if (typeof notice === 'string') problems.push(notice);
    else notices.push(notice);
  }
  problems.push(...staleExtras(packages));
  // An override for a package the app no longer carries is a text nobody reads, and a stale reason; so is the half of
  // one the package now answers itself, its texts once it ships a license file, its license once its manifest reads
  for (const [name, { platform, files, license }] of Object.entries(overrides)) {
    if (platform && platform !== options.platform) continue;
    const copies = byName.get(name);
    if (!files.length && !license) problems.push(`OVERRIDES names ${name} with neither a text nor a license: remove it, or give it what the package lacks`);
    if (!copies) { problems.push(`OVERRIDES names ${name}, which the app no longer carries: remove it and its text`); continue; }
    if (files.length && copies.some((pkg) => ownLicenseTexts(pkg.dir).length)) {
      problems.push(`OVERRIDES names ${name}, which now ships its own license file: remove ${license ? "the entry's files" : 'it'} and its text`);
    }
    if (license && copies.every((pkg) => readsAsSpdx(statedLicense(pkg, byName)))) {
      problems.push(`OVERRIDES gives ${name} a license, and its manifest now declares one that reads as SPDX: remove the entry's license`);
    }
  }
  for (const { pointer, files, problem } of options.native) {
    if (problem) problems.push(problem);
    if (files === null) problems.push(`No binary was found for ${pointer}`);
    for (const file of files ?? []) {
      if (!fs.existsSync(file)) problems.push(`${file} is missing, so its binary would ship without its notices`);
    }
  }
  const adapted = ADAPTED.map((entry) => ({
    ...entry, text: entry.files.map((file) => fs.readFileSync(path.join(options.licensesDir, file), 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n'),
  }));
  fs.writeFileSync(path.join(options.appDir, 'THIRD-PARTY-NOTICES.txt'), renderNotices(notices, options.native.map(({ pointer }) => pointer), adapted));
  if (options.sbom) {
    fs.writeFileSync(options.sbom.file, `${JSON.stringify(appSbom(options.sbom.app, packages, options.sbom.identity, [...options.sbom.others, ...downloadedBinaries(packages)], overrides), null, 2)}\n`);
  }
  if (problems.length && options.channel !== 'preview') {
    throw new Error(`The app's third-party notices are incomplete:\n  ${problems.join('\n  ')}`);
  }
  return problems;
}
