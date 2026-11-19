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
 *   - Inlined into the app's own bundles: what the renderer, main, preload and api builds each recorded
 *     (`@apackdev/host/build/bundled-packages`, `recordBundledPackages`), from the staging build root.
 *   - Inlined into a built-in pack's bundles: what each bundle's source map, or esbuild's module comments in a bundle
 *     without one, names (`packBundledPackages`), with the bundlers' own injected code and the pack's CSS tooling. A
 *     pack's declared dependencies would not do: a pack can import a package hoisted into the repository's
 *     `node_modules` by another workspace, as the built-in pack does vidstack. Type declarations a pack rolls up into
 *     its `defs/` name the packages they come from only in their text, and are not read.
 *
 * **Where a package's text comes from**, first that applies: its own license, licence, notice and copying files, in
 * any case and with any extension; for a platform binary package, which ships none, its parent's (`PLATFORM_PARENTS`);
 * the committed texts of `OVERRIDES`, each with why. A package with none of these is a problem.
 *
 * **What licenses it accepts** (`ACCEPTED`): the package's declared SPDX expression, taking from an OR the branch
 * whose license comes first in `ACCEPTED`. LGPL only for a package shipped as its own files, since inlined it would be
 * linked into the bundle; MPL, EPL and LGPL notices name where the package's source is, and CC-BY ones its creator.
 * Any other license, or an expression that does not parse, is a problem.
 *
 * **A problem fails a production or beta build and is reported on a preview**, keyed on the build's channel: a
 * release must not ship without a notice it owes, and a developer's preview keeps building while one is being added.
 *
 * Native code carries notices of its own, which this points to rather than repeats: Electron's and Chromium's
 * (`scripts/lib/electron-notices.ts`), elmdb's binding's and the terminal broker's, each shipped beside its binary.
 * A missing one is a problem. The prebuilt binaries of npm packages (esbuild's, Rollup's, keyring's, fsevents') are
 * credited by their packages' licenses; esbuild's, built with Go, add Go's (`PLATFORM_EXTRAS`), and the Rust
 * standard library compiled into Rollup's and keyring's carries no notice here.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import parse, { type Node as SpdxNode } from 'spdx-expression-parse';
import satisfies from 'spdx-satisfies';
import { bundledPackages, installedPackage, type BundledPackage } from '@apackdev/host/build/bundled-packages';
import { PACK_BUILD_STAGING_DIR } from '@apackdev/host/build/pack-workdir';

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

/** Texts a platform binary package adds to its parent's, for what its binary is built with, committed under `build/licenses/` */
export const PLATFORM_EXTRAS: readonly (readonly [pattern: RegExp, files: readonly string[], why: string])[] = [
  [/^@esbuild\//, ['go-LICENSE'], "esbuild's binary is built with Go, whose license asks a binary to carry its notice"],
];

/** Texts for packages that ship no license file, committed under `build/licenses/`, each with why */
export const OVERRIDES: Readonly<Record<string, { files: readonly string[]; why: string }>> = {
  dlv: { files: ['dlv-LICENSE'], why: 'declares MIT and ships no license file, nor does its repository' },
  '@ai-sdk/provider-utils': {
    files: ['vercel-ai-LICENSE', 'Apache-2.0.txt'],
    why: "ships no license file; its repository's (vercel/ai) is Apache-2.0's notice, and the license is its full text",
  },
  'apack-terminal': {
    files: ['apack-terminal-LICENSE-MIT'],
    why: "the terminal broker's protocol package, whose license files are at its repository's root, outside it",
  },
};

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
  /** The SPDX expression the package declares */
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

const firstParty = (name: string) => name === 'apack' || name.startsWith('@app/') || name.startsWith('@apackdev/');

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
      if (!firstParty(manifest.name)) found.push({ name: manifest.name, version: manifest.version ?? '0.0.0', dir, carried: 'files' });
      queue.push(path.join(dir, 'node_modules'));
    }
  }
  return found;
}

/**
 * The package a module path runs through `node_modules` to, found from `fromDir` one `node_modules` at a time as
 * Node finds a nested install, or `undefined` for a path through none
 */
function installedThrough(source: string, fromDir: string): BundledPackage | undefined {
  const names = [...source.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].map(([, name]) => name);
  let found: BundledPackage | undefined;
  for (const name of names) {
    try { found = installedPackage(name, found?.dir ?? fromDir); } catch { return found; }
  }
  return found;
}

/**
 * Every third-party package a built pack's bundles inlined, read from the bundles themselves: a bundle with a source
 * map names its modules in the map's `sources`, relative to the map; one without, as esbuild writes a pack's build
 * helpers, names each module in a `// <path>` comment, relative to the pack. A bundle with neither cannot say what it
 * inlined, and is a problem rather than an empty list.
 */
export function packBundledPackages(packDir: string): { packages: NoticePackage[]; problems: string[] } {
  const dist = path.join(packDir, 'dist');
  const bundles = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) => /\.(c|m)?js$/.test(file));
  const ids: string[] = [];
  const named = new Map<string, BundledPackage>();
  const problems: string[] = [];
  for (const bundle of bundles) {
    const file = path.join(dist, bundle);
    if (fs.existsSync(`${file}.map`)) {
      const { sources = [] } = JSON.parse(fs.readFileSync(`${file}.map`, 'utf8')) as { sources?: string[] };
      // A pack is built in a staging directory and copied, so a source's relative path is the staging directory's
      const staged = path.join(packDir, PACK_BUILD_STAGING_DIR, path.dirname(bundle));
      for (const entry of sources) {
        // A source no relative path reaches, such as one on another drive than the map on Windows, is a `file:` URL
        const source = entry.startsWith('file:') ? fileURLToPath(entry) : entry;
        const installed = installedThrough(source, packDir);
        if (installed) { named.set(installed.dir, installed); continue; }
        if (source.startsWith('\0')) { ids.push(source); continue; }
        const resolved = path.resolve(staged, source);
        if (fs.existsSync(resolved)) ids.push(resolved);
        else problems.push(`${path.relative(packDir, file)}.map names ${source}, which is not where its build left it, so its package is unknown`);
      }
      continue;
    }
    const modules = [...fs.readFileSync(file, 'utf8').matchAll(/^\/\/ (\S+\.[cm]?[jt]sx?)$/gm)].map(([, module]) => module);
    for (const module of modules) {
      const installed = installedThrough(module, packDir);
      const resolved = path.resolve(packDir, module);
      if (installed) named.set(installed.dir, installed);
      else if (fs.existsSync(resolved)) ids.push(resolved);
      else problems.push(`${path.relative(packDir, file)} names ${module}, which is not there, so its package is unknown`);
    }
    if (!modules.length) problems.push(`${path.relative(packDir, file)} has no source map and names no module, so what it inlined is unknown`);
  }
  if (!bundles.length) problems.push(`${dist} holds no bundle: build the pack before packaging`);
  // What the bundlers inject with no module of a package: esbuild's and Vite's helpers, plugin-vue's, and the pack's
  // CSS, which Tailwind writes (the pack builder runs every pack's CSS through it)
  const css = fs.readdirSync(dist, { recursive: true, encoding: 'utf8' }).some((file) => file.endsWith('.css'));
  const injected = ['esbuild', 'vite', '@vitejs/plugin-vue', ...(css ? ['tailwindcss'] : [])];
  let fromModules: BundledPackage[] = [];
  try { fromModules = bundledPackages(ids, packDir, injected); } catch (error) { problems.push((error as Error).message); }
  const found = new Map([...fromModules, ...named.values()].map((pkg) => [pkg.dir, pkg]));
  const packages = [...found.values()].filter((pkg) => !firstParty(pkg.name)).map((pkg) => ({ ...pkg, carried: 'inlined' as const }));
  return { packages, problems };
}

/** The repository URL a manifest names, or `undefined` */
function repositoryOf(manifest: { repository?: unknown; name: string }): string | undefined {
  const repository = typeof manifest.repository === 'string' ? manifest.repository : (manifest.repository as { url?: string } | undefined)?.url;
  if (!repository) return undefined;
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return `https://github.com/${repository}`;
  return repository.replace(/^git\+/, '').replace(/\.git$/, '');
}

/** One package's notice, or the problem that keeps it from having one */
export function noticeOf(pkg: NoticePackage, licensesDir: string, byName: ReadonlyMap<string, readonly NoticePackage[]>): PackageNotice | string {
  const manifest = manifestOf(pkg.dir);
  const label = `${pkg.name}@${pkg.version} (${CARRIED_LABEL[pkg.carried]})`;
  const parentName = PLATFORM_PARENTS.find(([pattern]) => pattern.test(pkg.name))?.[1];
  // The parent at the platform package's own version, which a release of both is published at
  const parents = parentName ? byName.get(parentName) ?? [] : [];
  const parent = parents.find((candidate) => candidate.version === pkg.version) ?? parents[0];
  const declared = declaredLicense(manifest) ?? (parent && declaredLicense(manifestOf(parent.dir)));
  if (!declared) return `${label} declares no license`;
  const license = chooseLicense(declared, pkg.carried);
  if (!license) return `${label} is under ${declared}, which does not parse as SPDX or which this app may not ${pkg.carried === 'files' ? 'ship' : 'inline'} (ACCEPTED)`;
  let texts = ownLicenseTexts(pkg.dir);
  if (!texts.length && parent) texts = ownLicenseTexts(parent.dir);
  if (!texts.length && OVERRIDES[pkg.name]) {
    texts = OVERRIDES[pkg.name].files.map((file) => fs.readFileSync(path.join(licensesDir, file), 'utf8').replace(/\r\n/g, '\n').trim());
  }
  if (!texts.length) return `${label} ships no license file: add its text to OVERRIDES, with why`;
  for (const [pattern, files] of PLATFORM_EXTRAS) {
    if (pattern.test(pkg.name)) texts = [...texts, ...files.map((file) => fs.readFileSync(path.join(licensesDir, file), 'utf8').replace(/\r\n/g, '\n').trim())];
  }
  const where = `${repositoryOf(manifest) ?? 'npm'}, ${pkg.name} ${pkg.version}`;
  const author = typeof manifest.author === 'string' ? manifest.author : (manifest.author as { name?: string } | undefined)?.name;
  const source = SOURCE_NAMED.test(license) ? where
    : CREATOR_NAMED.test(license) ? `${where}; created by ${CREATORS[pkg.name] ?? author ?? 'its authors'}` : undefined;
  return { package: pkg, declared, license, text: texts.join('\n\n'), source };
}

/** The notices' text: a header naming what else carries notices, then each distinct text with the packages it covers */
export function renderNotices(notices: readonly PackageNotice[], pointers: readonly string[]): string {
  const groups = new Map<string, PackageNotice[]>();
  for (const notice of notices) groups.set(notice.text, [...(groups.get(notice.text) ?? []), notice]);
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
    "bundles; a package carried as files also keeps its own license files beside it. Native code carries its own",
    'notices beside it:',
    '',
    ...pointers.map((pointer) => `  - ${pointer}`),
    '',
    ...sections,
  ].join('\n');
}

/** A component of the app's SBOM beside its third-party packages: its runtime, or a binary it ships */
export interface SbomComponent {
  type: 'framework' | 'application';
  name: string;
  version: string;
  purl: string;
  license?: string;
}

/** An npm package's purl, whose scope's `@` is encoded */
export const npmPurl = (name: string, version: string) => `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;

/** How the SBOM names a package: its purl, and its hash where the lockfile records one */
export interface SbomIdentity {
  /** A package not from npm, by name, such as a vendored checkout: the purl naming it where it is from */
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
 * The app's CycloneDX 1.5 SBOM: the app, every third-party package it carries with its declared license, how it is
 * carried and its hash, and the other components given. Every package carried is listed, whether or not its notice
 * could be written, so a preview's SBOM is whole too. No timestamp or serial number, so the same app writes the same
 * file.
 */
export function appSbom(app: { name: string; version: string }, packages: readonly NoticePackage[], identity: SbomIdentity, others: readonly SbomComponent[]): object {
  const libraries = packages.map((pkg) => {
    const purl = identity.purls[pkg.name] ?? npmPurl(pkg.name, pkg.version);
    const declared = declaredLicense(manifestOf(pkg.dir));
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
  const rest = others.map((component) => ({
    type: component.type,
    'bom-ref': component.purl,
    name: component.name,
    version: component.version,
    purl: component.purl,
    ...(component.license ? { licenses: sbomLicenses(component.license) } : {}),
  }));
  const components = [...libraries, ...rest].sort((a, b) => (a['bom-ref'] < b['bom-ref'] ? -1 : a['bom-ref'] > b['bom-ref'] ? 1 : 0));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: { component: { type: 'application', 'bom-ref': `app:${app.name}@${app.version}`, name: app.name, version: app.version } },
    components,
  };
}

/**
 * The SBOM's identity for the packages of a repository: the vendored checkouts it pins, by the packages each provides,
 * as GitHub purls at the pinned commit (`vendor/<repo>.rev`), since none is published to npm, each named
 * `<repo>` or `<repo>#<directory>` for a package in a directory of its repository, the purl's subpath, so two from one
 * repository are told apart; and the lockfile's integrity of every package installed from a registry
 */
export function sbomIdentity(repoRoot: string, vendored: Readonly<Record<string, string>>): SbomIdentity {
  const purls: Record<string, string> = {};
  for (const [name, where] of Object.entries(vendored)) {
    const [repo, subpath] = where.split('#');
    const rev = fs.readFileSync(path.join(repoRoot, 'vendor', `${repo}.rev`), 'utf8').trim();
    purls[name] = `pkg:github/spankyed/${repo}@${rev}${subpath ? `#${subpath}` : ''}`;
  }
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; integrity?: string; name?: string }> };
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

/**
 * The terminal broker's notices in the packaged app, `bin/<commit>/<platform>/THIRD-PARTY-NOTICES` of its package,
 * where the install puts what the pinned release publishes beside the binary, or `undefined` when the package holds
 * no build at all
 */
export function brokerNoticesFile(appDir: string): string | undefined {
  const bin = path.join(appDir, 'node_modules', '@app', 'terminal-broker', 'bin');
  const builds = fs.existsSync(bin) ? fs.readdirSync(bin).flatMap((commit) =>
    fs.readdirSync(path.join(bin, commit)).map((platform) => path.join(bin, commit, platform))) : [];
  return builds.length ? path.join(builds[0], 'THIRD-PARTY-NOTICES') : undefined;
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
  /** `build/licenses/`, holding `OVERRIDES`' texts */
  licensesDir: string;
  channel: string;
  /** What else carries notices, named in the header, each with the file that has to exist, or `null` when its binary is missing */
  native: readonly { pointer: string; file?: string | null }[];
  /** Where to write the app's CycloneDX SBOM (`appSbom`), with what it names beside the packages */
  sbom?: { file: string; app: { name: string; version: string }; identity: SbomIdentity; others: readonly SbomComponent[] };
}): string[] {
  const problems: string[] = [];
  const records = options.bundleRecords.flatMap((file) => {
    try { return readBundleRecord(file); } catch (error) { problems.push((error as Error).message); return []; }
  });
  const packs = options.packDirs.map(packBundledPackages);
  problems.push(...packs.flatMap((pack) => pack.problems));
  const packages = noticePackages([shippedPackages(options.appDir), records, ...packs.map((pack) => pack.packages)]);
  if (!packages.length) problems.push('No third-party package was found, which no build of this app carries');
  const byName = new Map<string, NoticePackage[]>();
  for (const pkg of packages) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg]);
  const notices: PackageNotice[] = [];
  for (const pkg of packages) {
    const notice = noticeOf(pkg, options.licensesDir, byName);
    if (typeof notice === 'string') problems.push(notice);
    else notices.push(notice);
  }
  // An override for a package the app no longer carries is a text nobody reads, and a stale reason
  const carried = new Set(packages.map((pkg) => pkg.name));
  for (const name of Object.keys(OVERRIDES)) {
    if (!carried.has(name)) problems.push(`OVERRIDES names ${name}, which the app no longer carries: remove it and its text`);
    else if (byName.get(name)!.some((pkg) => ownLicenseTexts(pkg.dir).length)) {
      problems.push(`OVERRIDES names ${name}, which now ships its own license file: remove it and its text`);
    }
  }
  for (const { pointer, file } of options.native) {
    if (file === null) problems.push(`No binary was found for ${pointer}`);
    else if (file && !fs.existsSync(file)) problems.push(`${file} is missing, so its binary would ship without its notices`);
  }
  fs.writeFileSync(path.join(options.appDir, 'THIRD-PARTY-NOTICES.txt'), renderNotices(notices, options.native.map(({ pointer }) => pointer)));
  if (options.sbom) {
    fs.writeFileSync(options.sbom.file, `${JSON.stringify(appSbom(options.sbom.app, packages, options.sbom.identity, options.sbom.others), null, 2)}\n`);
  }
  if (problems.length && options.channel !== 'preview') {
    throw new Error(`The app's third-party notices are incomplete:\n  ${problems.join('\n  ')}`);
  }
  return problems;
}
