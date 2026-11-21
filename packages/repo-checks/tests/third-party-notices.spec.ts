import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import {
  ADAPTED, ADAPTED_FIRST_PARTY, EXTRAS, OVERRIDES, appSbom, brokerNoticesFile, brokerSbomComponent, chooseLicense, declaredLicense, downloadedBinaries,
  noticeOf, noticePackages, packBundledPackages, renderNotices, sbomIdentity, shippedSource, staleExtras, uncreditedAdaptations, writeAppNotices,
  type NoticePackage, type Override,
} from '../../../scripts/lib/third-party-notices.ts';
import { repoFiles } from './_support/repo-files.ts';

/**
 * The app's third-party notices (`scripts/lib/third-party-notices.ts`), written by `afterPack` into the packaged app:
 * which licenses it accepts and how, where a package's text comes from, what a built pack says it inlined, and when
 * a problem fails a build. Over trees made here, since the subject runs inside electron-builder.
 */
const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

/** A directory holding the given files, relative paths to contents */
function tree(files: Record<string, string> = {}): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notices-')));
  made.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** The files of an installed package at `node_modules/<name>`, its manifest and the files given */
const installed = (name: string, manifest: object, files: Record<string, string> = {}) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: '1.0.0', ...manifest }),
  ...Object.fromEntries(Object.entries(files).map(([file, text]) => [`node_modules/${name}/${file}`, text])),
});

const at = (root: string, name: string, carried: NoticePackage['carried'] = 'files'): NoticePackage =>
  ({ name, version: '1.0.0', dir: path.join(root, 'node_modules', name), carried });

describe('which license a package is under', () => {
  it('reads the license field, and the legacy object and array', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT');
    expect(declaredLicense({ license: { type: 'ISC' } })).toBe('ISC');
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('MIT OR Apache-2.0');
    expect(declaredLicense({})).toBeUndefined();
  });

  it('takes from an OR the branch whose license comes first in ACCEPTED, and needs every part of an AND', () => {
    expect(chooseLicense('(MPL-2.0 OR Apache-2.0)', 'files')).toBe('Apache-2.0');
    expect(chooseLicense('(AFL-2.1 OR BSD-3-Clause)', 'files')).toBe('BSD-3-Clause');
    expect(chooseLicense('MIT AND Zlib', 'files')).toBe('MIT AND Zlib');
    expect(chooseLicense('MIT AND GPL-3.0-only', 'files')).toBeUndefined();
  });

  it('accepts LGPL for a package shipped as its own files, never for one inlined into a bundle', () => {
    expect(chooseLicense('LGPL-3.0-only', 'files')).toBe('LGPL-3.0-only');
    expect(chooseLicense('LGPL-3.0-only', 'inlined')).toBeUndefined();
    expect(chooseLicense('LGPL-3.0-only', 'both')).toBeUndefined();
  });

  it("understands SPDX's + as spdx-satisfies does, and still names the branch that comes first in ACCEPTED", () => {
    expect(chooseLicense('GPL-2.0+', 'files')).toBeUndefined();
    expect(chooseLicense('GPL-2.0+ OR MIT', 'files')).toBe('MIT');
    // spdx-satisfies accepts LGPL-2.1+ for a shipped package, and MIT still comes first
    expect(chooseLicense('MIT OR LGPL-2.1+', 'files')).toBe('MIT');
    expect(chooseLicense('(MIT AND LGPL-2.1) OR ISC', 'files')).toBe('ISC');
  });

  it('judges a license with a WITH exception as the license, and names it with the exception', () => {
    expect(chooseLicense('Apache-2.0 WITH LLVM-exception', 'inlined')).toBe('Apache-2.0 WITH LLVM-exception');
    expect(chooseLicense('GPL-3.0-only WITH GCC-exception-3.1', 'files')).toBeUndefined();
  });

  it('refuses a license it does not know', () => {
    expect(chooseLicense('GPL-3.0-only', 'files')).toBeUndefined();
    expect(chooseLicense('SEE LICENSE IN EULA.txt', 'files')).toBeUndefined();
  });

  it('refuses an expression that does not parse, rather than reading part of it', () => {
    for (const malformed of ['MIT and ISC', 'MIT or ISC', 'MIT OR', '(MIT', 'MIT)', 'MIT WITH', 'OR MIT']) {
      expect(chooseLicense(malformed, 'files'), malformed).toBeUndefined();
    }
    expect(chooseLicense('(MIT OR GPL-3.0-only) AND BSD-3-Clause', 'files')).toBe('MIT AND BSD-3-Clause');
  });
});

describe("where a package's text comes from", () => {
  it('reads every license, licence, notice and copying file, in any case and with any extension', () => {
    const root = tree(installed('lgpl', { license: 'LGPL-3.0-only' }, { COPYING: 'gpl text', 'COPYING.LESSER': 'lgpl text', 'readme.md': 'no' }));
    const notice = noticeOf(at(root, 'lgpl'), root, new Map());
    expect(typeof notice !== 'string' && notice.text).toBe('gpl text\n\nlgpl text');
    const markdown = tree(installed('md', { license: 'MIT' }, { 'LICENSE.md': 'markdown license' }));
    expect(noticeOf(at(markdown, 'md'), markdown, new Map())).toMatchObject({ text: 'markdown license' });
  });

  it("gives a platform binary package its parent's text and license", () => {
    const root = tree({
      ...installed('esbuild', { license: 'MIT' }, { LICENSE: 'esbuild license' }),
      ...installed('@esbuild/darwin-arm64', { os: ['darwin'] }),
    });
    const licenses = tree({ 'go-LICENSE': 'go license' });
    const byName = new Map([['esbuild', [{ ...at(root, 'esbuild'), version: '0.1.0' }, at(root, 'esbuild')]]]);
    // The parent at the platform package's own version, then what its binary is built with
    expect(noticeOf(at(root, '@esbuild/darwin-arm64'), licenses, byName))
      .toMatchObject({ license: 'MIT', text: 'esbuild license\n\ngo license' });
  });

  it("adds to a package's own text what its downloaded binary is built from: ripgrep's and PCRE2's to @vscode/ripgrep's", () => {
    const root = tree(installed('@vscode/ripgrep', { license: 'MIT' }, { LICENSE: 'wrapper license' }));
    const ripgrep = EXTRAS.find(({ pattern }) => pattern.test('@vscode/ripgrep'))!;
    const licenses = tree(Object.fromEntries(ripgrep.files.map((file) => [file, `${file} text`])));
    expect(ripgrep.files).toEqual(['ripgrep-COPYING', 'ripgrep-LICENSE-MIT', 'ripgrep-UNLICENSE', 'pcre2-LICENCE.md']);
    expect(noticeOf(at(root, '@vscode/ripgrep'), licenses, new Map())).toMatchObject({
      text: ['wrapper license', ...ripgrep.files.map((file) => `${file} text`)].join('\n\n'),
    });
  });

  it('refuses a downloaded binary of another release than its texts were read for, or one its code no longer names', () => {
    const declaring = (version?: string) => {
      const root = tree(installed('@vscode/ripgrep', { license: 'MIT' }, version ? { 'lib/postinstall.js': `const X = 1;\nconst VERSION = '${version}';\n` } : {}));
      return staleExtras([at(root, '@vscode/ripgrep')]);
    };
    const { release } = EXTRAS.find(({ pattern }) => pattern.test('@vscode/ripgrep'))!.readFor!;
    expect(declaring(release)).toEqual([]);
    expect(declaring('v99.0.0')).toEqual([expect.stringContaining(`downloads v99.0.0, and EXTRAS' texts for it were read for ${release}: re-read ripgrep's`)]);
    expect(declaring()).toEqual([expect.stringMatching(/lib\/postinstall\.js no longer says which release of its binary it downloads/)]);
  });

  it("holds the installed @vscode/ripgrep to the release its texts were read for, and every committed text to a file", () => {
    const dir = path.join(REPO_ROOT, 'node_modules', '@vscode', 'ripgrep');
    const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string };
    expect(staleExtras([{ name: '@vscode/ripgrep', version, dir, carried: 'files' }])).toEqual([]);
    const named = [...EXTRAS.flatMap(({ files }) => files), ...Object.values(OVERRIDES).flatMap(({ files }) => files)];
    expect(named.filter((file) => !fs.existsSync(path.join(REPO_ROOT, 'build', 'licenses', file)))).toEqual([]);
  });

  it('takes a committed override, and names the problem when there is none', () => {
    const licenses = tree({ 'dlv-LICENSE': 'dlv text' });
    const root = tree({ ...installed('dlv', { license: 'MIT' }), ...installed('bare', { license: 'MIT' }) });
    expect(OVERRIDES.dlv.files).toEqual(['dlv-LICENSE']);
    expect(noticeOf(at(root, 'dlv'), licenses, new Map())).toMatchObject({ text: 'dlv text' });
    expect(noticeOf(at(root, 'bare'), licenses, new Map())).toMatch(/bare@1\.0\.0 \(shipped\) ships no license file/);
  });

  it("judges a package whose manifest declares no SPDX license under its override's, held to ACCEPTED like any other", () => {
    const root = tree({
      ...installed('see', { license: 'SEE LICENSE IN LICENSE' }, { LICENSE: 'mit text' }),
      ...installed('loose', { license: 'Apache 2.0' }, { LICENSE: 'apache text' }),
      ...installed('copyleft', { license: 'GPL' }, { LICENSE: 'gpl text' }),
      ...installed('honest', { license: 'GPL-3.0-only' }, { LICENSE: 'gpl text' }),
    });
    const overrides: Record<string, Override> = {
      see: { files: [], license: 'MIT', why: 'its LICENSE is the MIT license' },
      loose: { files: [], license: 'Apache-2.0', why: 'its LICENSE is Apache-2.0' },
      copyleft: { files: [], license: 'GPL-3.0-only', why: 'its LICENSE is the GPL' },
      honest: { files: [], license: 'MIT', why: 'an override that contradicts a manifest that reads' },
    };
    const notice = (name: string, given = overrides) => noticeOf(at(root, name), root, new Map(), given);
    expect(notice('see')).toMatchObject({ declared: 'MIT', license: 'MIT', text: 'mit text' });
    expect(notice('loose')).toMatchObject({ declared: 'Apache-2.0', license: 'Apache-2.0', text: 'apache text' });
    // With no override it is a problem, which says what answers it
    expect(notice('see', {})).toMatch(/^see@1\.0\.0 \(shipped\) is under SEE LICENSE IN LICENSE, which does not parse as SPDX .* give that as the license of its OVERRIDES entry, with why$/);
    // An override's license is held to ACCEPTED, and never read over a manifest's that parses
    expect(notice('copyleft')).toMatch(/^copyleft@1\.0\.0 \(shipped\) is under GPL-3\.0-only, .*\(ACCEPTED\)$/);
    expect(notice('honest')).toMatch(/^honest@1\.0\.0 \(shipped\) is under GPL-3\.0-only, .*\(ACCEPTED\)$/);
  });

  it('names where the source is for a license that asks for it', () => {
    const root = tree(installed('elk', { license: 'EPL-2.0', repository: 'kieler/elkjs' }, { LICENSE: 'epl' }));
    expect(noticeOf(at(root, 'elk', 'inlined'), root, new Map())).toMatchObject({ source: 'https://github.com/kieler/elkjs, elk 1.0.0' });
    const caniuse = tree(installed('caniuse', { license: 'CC-BY-4.0', author: 'Ben Briggs', repository: 'browserslist/caniuse-lite' }, { LICENSE: 'cc' }));
    expect(noticeOf(at(caniuse, 'caniuse'), caniuse, new Map()))
      .toMatchObject({ source: 'https://github.com/browserslist/caniuse-lite, caniuse 1.0.0; created by Ben Briggs' });
  });

  it('names them for a license that asks anywhere in an AND, not only first', () => {
    const root = tree({
      ...installed('mixed', { license: 'MIT AND MPL-2.0', repository: 'a/mixed' }, { LICENSE: 'x' }),
      ...installed('data', { license: 'MIT AND CC-BY-4.0', author: 'Ada', repository: 'a/data' }, { LICENSE: 'x' }),
      ...installed('plain', { license: 'MIT AND ISC' }, { LICENSE: 'x' }),
    });
    expect(noticeOf(at(root, 'mixed'), root, new Map())).toMatchObject({ source: 'https://github.com/a/mixed, mixed 1.0.0' });
    expect(noticeOf(at(root, 'data'), root, new Map())).toMatchObject({ source: 'https://github.com/a/data, data 1.0.0; created by Ada' });
    expect(noticeOf(at(root, 'plain'), root, new Map())).toMatchObject({ source: undefined });
  });
});

describe('the packages the notices cover', () => {
  it("lists a package the app ships and a bundle inlined once, carried both ways", () => {
    const shipped = { name: 'vue', version: '3.5.0', dir: '/app/node_modules/vue', carried: 'files' as const };
    const inlined = { name: 'vue', version: '3.5.0', dir: '/repo/node_modules/vue', carried: 'inlined' as const };
    expect(noticePackages([[shipped], [inlined]])).toEqual([{ ...shipped, carried: 'both' }]);
  });

  /** What the pack reader adds to every pack, for the bundlers' helpers, installed where a pack finds them */
  const bundlers = { ...installed('esbuild', {}), ...installed('vite', {}), ...installed('@vitejs/plugin-vue', {}) };

  it("reads what a built pack inlined from its source maps, relative to where it was built", () => {
    const repo = tree({
      ...bundlers,
      ...installed('vidstack', { license: 'MIT' }),
      'linked-view/package.json': JSON.stringify({ name: 'linked-view', version: '2.0.0' }),
      'linked-view/index.js': '',
      // A map's sources are relative to the staging directory the pack was built in, not to where the map is now
      'pack/dist/runtime/a.js': 'x',
      'pack/dist/runtime/a.js.map': JSON.stringify({ sources: ['../../../../node_modules/vidstack/prod/a.js', '../../../src/own.ts', '../../../../linked-view/index.js'] }),
      'pack/src/own.ts': '',
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['@vitejs/plugin-vue', 'esbuild', 'linked-view', 'vidstack', 'vite']);
  });

  it("reads a map source named by its file: URL, as esbuild names one no relative path reaches", () => {
    const repo = tree({
      ...bundlers,
      ...installed('vidstack', { license: 'MIT' }, { 'prod/a.js': '' }),
      'pack/src/own.ts': '',
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/a.js': 'x',
    });
    const sources = [path.join(repo, 'node_modules/vidstack/prod/a.js'), path.join(repo, 'pack/src/own.ts')].map((file) => pathToFileURL(file).href);
    fs.writeFileSync(path.join(repo, 'pack/dist/a.js.map'), JSON.stringify({ sources }));
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.map((pkg) => pkg.name)).toContain('vidstack');
  });

  it("credits a module to the package its file is in, not to the one of that name the pack would resolve", () => {
    const repo = tree({
      ...bundlers,
      ...installed('dep', { version: '1.0.0' }, { 'index.js': '' }),
      // Another workspace's own copy, at another version, which the pack's bundle inlined
      'other/node_modules/dep/package.json': JSON.stringify({ name: 'dep', version: '2.0.0' }),
      'other/node_modules/dep/index.js': '',
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/runtime/a.js': 'x',
      'pack/dist/runtime/a.js.map': JSON.stringify({ sources: ['../../../../other/node_modules/dep/index.js'] }),
      'pack/dist/build/helpers.mjs': '// ../other/node_modules/dep/index.js\nvar x;\n',
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.filter((pkg) => pkg.name === 'dep').map((pkg) => pkg.version)).toEqual(['2.0.0']);
  });

  it("credits a package's file a bundler names under a virtual id and a query, as Vite's CommonJS proxies are", () => {
    const repo = tree({
      ...bundlers,
      'other/node_modules/dep/package.json': JSON.stringify({ name: 'dep', version: '2.0.0' }),
      'other/node_modules/dep/index.js': '',
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/a.js': 'x',
    });
    const sources = [`\0${path.join(repo, 'other/node_modules/dep/index.js')}?commonjs-proxy`, '\0vite/preload-helper.js'];
    fs.writeFileSync(path.join(repo, 'pack/dist/a.js.map'), JSON.stringify({ sources }));
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.map((pkg) => `${pkg.name}@${pkg.version}`)).toContain('dep@2.0.0');
  });

  it('refuses a nested package that is not installed, rather than crediting the package it was nested in', () => {
    const repo = tree({
      ...bundlers,
      ...installed('outer', {}),
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/a.js': 'x',
      'pack/dist/a.js.map': JSON.stringify({ sources: ['../../../../node_modules/outer/node_modules/inner/index.js'] }),
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([expect.stringMatching(/a\.js\.map names .*outer\/node_modules\/inner\/index\.js, which is not where its build left it, so its package is unknown: inner isn't installed above /)]);
    expect(packages.map((pkg) => pkg.name)).not.toContain('outer');
  });

  it("credits the esbuild Vite depends on beside the pack builder's, when they are two installs", () => {
    const repo = tree({
      ...bundlers,
      'node_modules/vite/node_modules/esbuild/package.json': JSON.stringify({ name: 'esbuild', version: '2.0.0' }),
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/src/own.ts': '',
      'pack/dist/a.mjs': '// src/own.ts\n',
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.filter((pkg) => pkg.name === 'esbuild').map((pkg) => pkg.version).sort()).toEqual(['1.0.0', '2.0.0']);
  });

  it('refuses a map source that is not where the build left it, rather than dropping its package', () => {
    const repo = tree({
      ...bundlers,
      'pack/dist/a.js': 'x',
      'pack/dist/a.js.map': JSON.stringify({ sources: ['../../gone/index.js'] }),
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
    });
    expect(packBundledPackages(path.join(repo, 'pack')).problems).toEqual([expect.stringMatching(/a\.js\.map names \.\.\/\.\.\/gone\/index\.js, which is not where its build left it/)]);
  });

  it("reads esbuild's module comments in a bundle without a map, and refuses one that names nothing", () => {
    const repo = tree({
      ...bundlers,
      ...installed('zod', { license: 'MIT' }, { 'index.js': '' }),
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/build/helpers.mjs': '// ../node_modules/zod/index.js\nvar x;\n',
      'pack/dist/build/minified.mjs': 'var a=1;',
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['@vitejs/plugin-vue', 'esbuild', 'vite', 'zod']);
    expect(problems).toEqual([expect.stringMatching(/minified\.mjs has no source map and names no module/)]);
  });

  it("reads a module comment naming any file, a package's JSON or a path with spaces, and passes over one naming none", () => {
    const repo = tree({
      ...bundlers,
      ...installed('data', {}, { 'table.json': '{}' }),
      ...installed('spaced', {}, { 'my file.js': '' }),
      'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }),
      'pack/dist/build/helpers.mjs': '// ../node_modules/data/table.json\n// ../node_modules/spaced/my file.js\n// a line of a template literal\nvar x;\n',
    });
    const { packages, problems } = packBundledPackages(path.join(repo, 'pack'));
    expect(problems).toEqual([]);
    expect(packages.map((pkg) => pkg.name).sort()).toEqual(['@vitejs/plugin-vue', 'data', 'esbuild', 'spaced', 'vite']);
  });

  it('reports a pack never built, with no dist at all, as holding no bundle', () => {
    const repo = tree({ ...bundlers, 'pack/package.json': JSON.stringify({ name: '@apackdev/pack' }) });
    expect(packBundledPackages(path.join(repo, 'pack'))).toEqual({
      packages: [], problems: [`${path.join(repo, 'pack', 'dist')} holds no bundle: build the pack before packaging`],
    });
  });
});

/** The bundlers a pack reader credits, installed inside a fixture pack */
const bundlersFor = () => ({ ...installed('esbuild', { license: 'MIT' }, { LICENSE: 'x' }), ...installed('vite', { license: 'MIT' }, { LICENSE: 'x' }),
  ...installed('@vitejs/plugin-vue', { license: 'MIT' }, { LICENSE: 'x' }) });

describe('the notices written into the app', () => {
  /** A packaged app with one shipped package, a staging root with the records given, and a built pack */
  function packaged(records: Record<string, object> = { 'main.json': { packages: [] } }) {
    const app = tree(installed('ws', { license: 'MIT' }, { LICENSE: 'ws license' }));
    const root = tree(Object.fromEntries(Object.entries(records).map(([name, record]) => [`bundled-packages/${name}`, JSON.stringify(record)])));
    const pack = tree({ 'package.json': '{"name":"@apackdev/pack"}', 'dist/a.js': '// src/a.ts\n', 'src/a.ts': '', ...bundlersFor() });
    const committed = [...Object.values(OVERRIDES), ...EXTRAS, ...ADAPTED].flatMap(({ files }) => files);
    const licenses = tree(Object.fromEntries(committed.map((file) => [file, file])));
    return { app, root, pack, licenses };
  }
  /** Adds files to a tree already made */
  const add = (root: string, files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
  };
  const write = (setup: ReturnType<typeof packaged>, channel: string, extra: Partial<Parameters<typeof writeAppNotices>[0]> = {}) =>
    writeAppNotices({
      appDir: setup.app, buildRoot: setup.root, bundleRecords: [path.join(setup.root, 'bundled-packages', 'main.json')],
      packDirs: [setup.pack], licensesDir: setup.licenses, channel, platform: 'linux', native: [], ...extra,
    });

  it('writes each text with the packages it covers', () => {
    const setup = packaged();
    const problems = write(setup, 'preview');
    const text = fs.readFileSync(path.join(setup.app, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    expect(text).toContain('  ws 1.0.0, MIT, shipped\n\nws license');
    // Each adapted file, with its texts, which the fixture's licenses directory holds as their own names
    for (const { file, files } of ADAPTED) {
      expect(text).toContain(`Adapted into apack's own code:\n  ${file}, from `);
      expect(text).toContain(files.join('\n\n'));
    }
    // Every override names a package this fixture does not carry
    expect(problems).toEqual(Object.keys(OVERRIDES).map((name) => expect.stringContaining(`OVERRIDES names ${name}`)));
  });

  it("asks a platform's override of that platform's build alone", () => {
    const linuxOnly = Object.entries(OVERRIDES).filter(([, { platform }]) => platform === 'linux').map(([name]) => name);
    expect(linuxOnly).toContain('@napi-rs/lzma-linux-x64-gnu');
    const stale = (platform: NodeJS.Platform) =>
      write(packaged(), 'preview', { platform }).filter((problem) => linuxOnly.some((name) => problem.includes(`OVERRIDES names ${name}`)));
    expect(stale('linux')).toHaveLength(linuxOnly.length);
    expect(stale('darwin')).toEqual([]);
    expect(stale('win32')).toEqual([]);
  });

  it("calls an override's license stale once the manifest declares one that reads, and an override of nothing a problem", () => {
    const carrying = (license: string) => {
      const setup = packaged();
      add(setup.app, installed('see', { license }, { LICENSE: 'mit text' }));
      return setup;
    };
    const overrides: Record<string, Override> = { see: { files: [], license: 'MIT', why: 'its LICENSE is the MIT license' } };
    const unreadable = carrying('SEE LICENSE IN LICENSE');
    expect(write(unreadable, 'production', { overrides })).toEqual([]);
    expect(fs.readFileSync(path.join(unreadable.app, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toContain('  see 1.0.0, MIT, shipped\n');
    expect(write(carrying('MIT'), 'preview', { overrides }))
      .toEqual(['OVERRIDES gives see a license, and its manifest now declares one that reads as SPDX: remove the entry\'s license']);
    // One that reads and is refused is the manifest's to answer for, and the override is as stale
    expect(write(carrying('GPL-3.0-only'), 'preview', { overrides })).toEqual([
      expect.stringContaining('see@1.0.0 (shipped) is under GPL-3.0-only'), expect.stringContaining('OVERRIDES gives see a license'),
    ]);
    expect(write(carrying('MIT'), 'preview', { overrides: { see: { files: [], why: 'nothing' } } }))
      .toEqual(['OVERRIDES names see with neither a text nor a license: remove it, or give it what the package lacks']);
  });

  it('fails a production or beta build on a problem, and reports it on a preview', () => {
    const setup = packaged({});
    const missing = /main\.json is missing: the build that wrote the bundles did not record what they inlined/;
    expect(write(setup, 'preview')).toContainEqual(expect.stringMatching(missing));
    expect(() => write(setup, 'production')).toThrow(missing);
    expect(() => write(setup, 'beta')).toThrow(missing);
  });

  it("reports each of a native binary's notices that is missing, or a binary that is", () => {
    const setup = packaged();
    add(setup.app, { NOTICES: 'x' });
    const files = ['NOTICES', 'COPYRIGHT.html'].map((name) => path.join(setup.app, name));
    const problems = write(setup, 'preview', { overrides: {}, native: [{ pointer: 'elmdb', files }, { pointer: 'the broker', files: null }] });
    // Every file a pointer names is looked for, not the first alone
    expect(problems).toEqual([`${files[1]} is missing, so its binary would ship without its notices`, 'No binary was found for the broker']);
  });

  it("reports why a native pointer may be wrong, and still names it in the header", () => {
    const setup = packaged();
    expect(write(setup, 'preview', { native: [{ pointer: 'FFmpeg', problem: 'read for another Electron' }] })).toContainEqual('read for another Electron');
    expect(fs.readFileSync(path.join(setup.app, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toContain('  - FFmpeg\n');
  });

  it('reports a carried package whose downloaded binary is another release than its texts were read for', () => {
    const setup = packaged();
    add(setup.app, installed('@vscode/ripgrep', { license: 'MIT' }, { LICENSE: 'x', 'lib/postinstall.js': "const VERSION = 'v0.0.1';" }));
    expect(write(setup, 'preview')).toContainEqual(expect.stringContaining('@vscode/ripgrep@1.0.0 downloads v0.0.1'));
  });

  it("points at the broker's notices beside the binary of the app's own platform, never another's", () => {
    const broker = 'node_modules/@apackdev/terminal-';
    const app = tree({
      [`${broker}darwin-arm64/apack-terminal`]: 'x', [`${broker}darwin-arm64/THIRD-PARTY-NOTICES`]: 'x',
      [`${broker}win32-x64/bin/apack-terminal.exe`]: 'x', [`${broker}win32-x64/bin/THIRD-PARTY-NOTICES`]: 'x',
      [`${broker}linux-x64/package.json`]: '{}',
    });
    expect(brokerNoticesFile(app, 'darwin-arm64')).toBe(path.join(app, `${broker}darwin-arm64`, 'THIRD-PARTY-NOTICES'));
    expect(brokerNoticesFile(app, 'win32-x64')).toBe(path.join(app, `${broker}win32-x64`, 'bin', 'THIRD-PARTY-NOTICES'));
    // A platform package holding no binary, and none at all
    expect(brokerNoticesFile(app, 'linux-x64')).toBeUndefined();
    expect(brokerNoticesFile(tree(), 'linux-x64')).toBeUndefined();
  });

  it('renders the same notices from the same packages, whatever order they come in', () => {
    const notices = [
      { package: { name: 'b', version: '1.0.0', dir: '/b', carried: 'files' as const }, declared: 'MIT', license: 'MIT', text: 'same' },
      { package: { name: 'a', version: '1.0.0', dir: '/a', carried: 'inlined' as const }, declared: 'MIT', license: 'MIT', text: 'same' },
    ];
    expect(renderNotices(notices, [])).toBe(renderNotices([...notices].reverse(), []));
    expect(renderNotices(notices, [])).toContain('Covering:\n  a 1.0.0, MIT, inlined\n  b 1.0.0, MIT, shipped\n\nsame');
  });
});

describe("third-party code adapted into the app's own files", () => {
  const credit = { file: 'packages/a/src/ported.ts', upstream: 'up', license: 'MIT', files: ['up-LICENSE'] };

  it('reports a shipped source that says it was adapted, ported or copied from elsewhere and is not credited', () => {
    const sources = ['Adapted from x', 'ported from y', 'Copied from z'].map((text, i) => ({ file: `packages/a/src/f${i}.ts`, text: `// ${text}` }));
    expect(uncreditedAdaptations(sources, [], {})).toEqual(sources.map(({ file }) => expect.stringContaining(`${file} says its code was adapted from elsewhere, and ADAPTED does not credit it`)));
  });

  it('passes a credited file or an excused one, and source the app does not ship', () => {
    const sources = [
      { file: credit.file, text: '// Ported from up' },
      { file: 'native/speech/helper.swift', text: '// adapted from our own helper' },
      { file: 'packages/a/tests/a.spec.ts', text: '// copied from upstream' },
      { file: 'packages/a/src/CLAUDE.md', text: 'ported from somewhere' },
      { file: 'packages/a/src/plain.ts', text: '// imported from a module' },
    ];
    expect(uncreditedAdaptations(sources, [credit], { 'native/speech/helper.swift': 'first-party' })).toEqual([]);
  });

  it('reports an entry naming a file that no longer says it was adapted, or is gone', () => {
    expect(uncreditedAdaptations([{ file: credit.file, text: '// all ours now' }], [credit], { 'native/x.sh': 'why' })).toEqual([
      expect.stringContaining(`${credit.file} is named in ADAPTED or ADAPTED_FIRST_PARTY, and no shipped source by that name says`),
      expect.stringContaining('native/x.sh is named in ADAPTED or ADAPTED_FIRST_PARTY'),
    ]);
  });

  it('credits every shipped source in the tree that says it was adapted, each with its texts committed', () => {
    const sources = population('shipped source files', repoFiles('packages', 'native').filter(shippedSource), { atLeast: 500 })
      .map((file) => ({ file, text: fs.readFileSync(path.join(REPO_ROOT, file), 'utf8') }));
    expect(uncreditedAdaptations(sources)).toEqual([]);
    expect(ADAPTED.length + Object.keys(ADAPTED_FIRST_PARTY).length).toBeGreaterThan(0);
    const named = ADAPTED.flatMap(({ files }) => files);
    expect(named.filter((file) => !fs.existsSync(path.join(REPO_ROOT, 'build', 'licenses', file)))).toEqual([]);
  });

  it('ends the notices with each adapted file, where it is from, its license and its texts', () => {
    const text = renderNotices([], [], [{ ...credit, text: 'up license' }]);
    expect(text).toContain(`Adapted into apack's own code:\n  ${credit.file}, from up, MIT\n\nup license\n`);
  });
});

describe("the app's SBOM", () => {
  /** Packages with manifests, as the SBOM reads each one's declared license from its own */
  function carried() {
    const root = tree({
      ...installed('vue', { license: 'MIT', version: '3.5.0' }),
      ...installed('@tiptap/pm', { license: '(MPL-2.0 OR Apache-2.0)', version: '3.0.0' }),
      ...installed('elmdb', { license: 'MIT OR Apache-2.0', version: '0.0.0' }),
      ...installed('bare', { version: '1.0.0' }),
      ...installed('weird', { license: 'UNLICENSED', version: '1.0.0' }),
      ...installed('plus', { license: 'MIT+', version: '1.0.0' }),
    });
    const pkg = (name: string, version: string, carried: NoticePackage['carried']): NoticePackage =>
      ({ name, version, dir: path.join(root, 'node_modules', name), carried });
    return [pkg('vue', '3.5.0', 'both'), pkg('@tiptap/pm', '3.0.0', 'inlined'), pkg('elmdb', '0.0.0', 'files'), pkg('bare', '1.0.0', 'files'),
      pkg('weird', '1.0.0', 'files'), pkg('plus', '1.0.0', 'files')];
  }
  const identity = {
    purls: { elmdb: 'pkg:github/spankyed/elmdb@abc123' },
    integrity: new Map([['vue@3.5.0', `sha512-${Buffer.from('vue bytes').toString('base64')}`]]),
  };

  it('lists every package carried with its purl, hash, declared license and how it is carried, then the others', () => {
    const sbom = appSbom({ name: 'apack', version: '0.3.14' }, carried(), identity,
      [{ type: 'framework', name: 'electron', version: '44.9.3', purl: 'pkg:github/electron/electron@v44.9.3', license: 'MIT' }]) as {
      specVersion: string; metadata: { component: { name: string } }; components: Record<string, unknown>[];
    };
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.metadata.component.name).toBe('apack');
    expect(sbom.components.map((component) => component.purl)).toEqual([
      'pkg:github/electron/electron@v44.9.3', 'pkg:github/spankyed/elmdb@abc123', 'pkg:npm/%40tiptap/pm@3.0.0', 'pkg:npm/bare@1.0.0',
      'pkg:npm/plus@1.0.0', 'pkg:npm/vue@3.5.0', 'pkg:npm/weird@1.0.0',
    ]);
    const byName = Object.fromEntries(sbom.components.map((component) => [component.name, component]));
    expect(byName['@tiptap/pm']).toMatchObject({ licenses: [{ expression: '(MPL-2.0 OR Apache-2.0)' }], properties: [{ name: 'apack:carried', value: 'inlined' }] });
    expect(byName.vue).toMatchObject({ licenses: [{ license: { id: 'MIT' } }], hashes: [{ alg: 'SHA-512', content: Buffer.from('vue bytes').toString('hex') }] });
    expect(byName.weird).toMatchObject({ licenses: [{ license: { name: 'UNLICENSED' } }] });
    expect(byName.plus).toMatchObject({ licenses: [{ expression: 'MIT+' }] });
    // A package that declares no license, whose notice is a problem, is listed all the same
    expect(byName.bare).not.toHaveProperty('licenses');
  });

  it('is the same file for the same app, whatever order the packages come in', () => {
    const packages = carried();
    expect(JSON.stringify(appSbom({ name: 'apack', version: '1' }, packages, identity, [])))
      .toBe(JSON.stringify(appSbom({ name: 'apack', version: '1' }, [...packages].reverse(), identity, [])));
  });

  it('lists inside a component what is shipped inside it, each with its hash and a reference of its own', () => {
    const broker = {
      type: 'application' as const, name: 'broker', version: 'abc', purl: 'pkg:github/a/broker@abc', sha256: 'b1',
      components: [{ type: 'file' as const, name: 'z.dll', sha256: 'f2' }, { type: 'file' as const, name: 'NOTICES', sha256: 'f1' }],
    };
    const { components } = appSbom({ name: 'apack', version: '1' }, [], identity, [broker]) as { components: object[] };
    expect(components).toEqual([{
      type: 'application', 'bom-ref': 'pkg:github/a/broker@abc', name: 'broker', version: 'abc', purl: 'pkg:github/a/broker@abc',
      hashes: [{ alg: 'SHA-256', content: 'b1' }],
      components: [
        { type: 'file', 'bom-ref': 'pkg:github/a/broker@abc#NOTICES', name: 'NOTICES', hashes: [{ alg: 'SHA-256', content: 'f1' }] },
        { type: 'file', 'bom-ref': 'pkg:github/a/broker@abc#z.dll', name: 'z.dll', hashes: [{ alg: 'SHA-256', content: 'f2' }] },
      ],
    }]);
  });

  it("names a package whose manifest declares no SPDX license by its override's", () => {
    const root = tree(installed('see', { license: 'SEE LICENSE IN LICENSE' }));
    const sbom = (overrides: Record<string, Override>) =>
      (appSbom({ name: 'apack', version: '1' }, [at(root, 'see')], identity, [], overrides) as { components: { licenses: object[] }[] }).components[0].licenses;
    expect(sbom({ see: { files: [], license: 'MIT', why: 'its LICENSE is the MIT license' } })).toEqual([{ license: { id: 'MIT' } }]);
    expect(sbom({})).toEqual([{ license: { name: 'SEE LICENSE IN LICENSE' } }]);
  });

  it("names the terminal broker by its release's commit, its binary's hash, and each file beside it with its own", () => {
    const commit = 'a'.repeat(40);
    const root = tree({ 'package-lock.json': JSON.stringify({ packages: {
      'node_modules/@apackdev/terminal-win32-x64': { resolved: `https://github.com/spankyed/apack-terminal/releases/download/bin-${commit}/t.tgz` },
    } }) });
    const app = tree({
      'node_modules/@apackdev/terminal-win32-x64/package.json': '{}',
      'node_modules/@apackdev/terminal-win32-x64/apack-terminal.exe': 'exe',
      'node_modules/@apackdev/terminal-win32-x64/conpty.dll': 'dll',
      'node_modules/@apackdev/terminal-darwin-arm64/apack-terminal': 'mach-o',
    });
    const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
    expect(brokerSbomComponent(root, app, 'win32-x64')).toEqual({
      type: 'application', name: 'apack-terminal', version: commit, purl: `pkg:github/spankyed/apack-terminal@${commit}`, license: 'MIT OR Apache-2.0',
      sha256: sha256('exe'), components: [{ type: 'file', name: 'conpty.dll', sha256: sha256('dll') }],
    });
    // A platform package the lockfile names no release for is still the binary carried, with no commit to name
    expect(brokerSbomComponent(root, app, 'darwin-arm64')).toEqual({
      type: 'application', name: 'apack-terminal', license: 'MIT OR Apache-2.0', sha256: sha256('mach-o'), components: [],
    });
    expect(brokerSbomComponent(root, app, 'linux-x64')).toBeUndefined();
  });

  it("names the binary a package's install downloaded, at the release its texts were read for, with the hash of the file carried", () => {
    const { release, binary } = EXTRAS.find(({ pattern }) => pattern.test('@vscode/ripgrep'))!.readFor!;
    const carrying = (declared: string, files: Record<string, string> = {}) => {
      const root = tree(installed('@vscode/ripgrep', { license: 'MIT' }, { 'lib/postinstall.js': `const VERSION = '${declared}';\n`, ...files }));
      return downloadedBinaries([at(root, '@vscode/ripgrep'), at(root, '@vscode/ripgrep', 'inlined')]);
    };
    const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(carrying(release, { 'bin/rg': 'rg bytes' })).toEqual([{
      type: 'application', name: 'ripgrep', version: '15.0.0', purl: `pkg:github/microsoft/ripgrep-prebuilt@${release}`, license: 'Unlicense OR MIT', sha256: sha256('rg bytes'),
    }]);
    expect(carrying(release, { 'bin/rg.exe': 'exe bytes' })).toMatchObject([{ sha256: sha256('exe bytes') }]);
    expect(carrying(release)).toEqual([expect.not.objectContaining({ sha256: expect.anything() })]);
    // Another release's binary is of a version nobody read
    expect(carrying('v99.0.0', { 'bin/rg': 'rg bytes' })).toEqual([]);
    expect(binary.file).toBe('bin/rg');
    // The installed package, whose install downloaded the binary this machine runs
    const dir = path.join(REPO_ROOT, 'node_modules', '@vscode', 'ripgrep');
    const installedBinary = [binary.file, `${binary.file}.exe`].map((file) => path.join(dir, file)).find((file) => fs.existsSync(file))!;
    expect(downloadedBinaries([{ name: '@vscode/ripgrep', version: '0.0.0', dir, carried: 'files' }]))
      .toMatchObject([{ name: 'ripgrep', sha256: sha256(fs.readFileSync(installedBinary)) }]);
  });

  it('writes the downloaded binaries into the SBOM beside the components given', () => {
    const { release } = EXTRAS.find(({ pattern }) => pattern.test('@vscode/ripgrep'))!.readFor!;
    const committed = [...Object.values(OVERRIDES), ...EXTRAS, ...ADAPTED].flatMap(({ files }) => files);
    const licenses = tree(Object.fromEntries(committed.map((file) => [file, file])));
    const app = tree(installed('@vscode/ripgrep', { license: 'MIT' }, { LICENSE: 'x', 'lib/postinstall.js': `const VERSION = '${release}';\n`, 'bin/rg': 'rg' }));
    const file = path.join(app, 'app.cdx.json');
    writeAppNotices({
      appDir: app, buildRoot: app, bundleRecords: [], packDirs: [], licensesDir: licenses, channel: 'production', platform: 'linux', native: [], overrides: {},
      sbom: { file, app: { name: 'apack', version: '1' }, identity, others: [{ type: 'framework', name: 'electron', version: '1', purl: 'pkg:github/electron/electron@v1' }] },
    });
    const { components } = JSON.parse(fs.readFileSync(file, 'utf8')) as { components: { purl: string }[] };
    expect(components.map(({ purl }) => purl)).toEqual(['pkg:github/electron/electron@v1', `pkg:github/microsoft/ripgrep-prebuilt@${release}`, 'pkg:npm/%40vscode/ripgrep@1.0.0']);
  });

  it("names our repositories' packages by the commit of the release the lockfile installs, and hashes the lockfile's", () => {
    const [elmdb, terminal] = ['a'.repeat(40), 'b'.repeat(40)];
    const root = tree({
      'package-lock.json': JSON.stringify({ packages: {
        '': { name: 'apack', version: '0.3.14' },
        'node_modules/elmdb': { version: '0.1.0', resolved: `https://github.com/spankyed/elmdb/releases/download/pkg-${elmdb}/elmdb-0.1.0.tgz`, integrity: 'sha512-elmdb' },
        'node_modules/@apackdev/terminal': { version: '0.1.0', resolved: `https://github.com/spankyed/apack-terminal/releases/download/bin-${terminal}/t.tgz`, integrity: 'sha512-terminal' },
        'node_modules/@apackdev/git': { version: '0.1.0', resolved: '../apack-git', link: true },
        'node_modules/vue': { version: '3.5.0', integrity: 'sha512-hoisted' },
        'node_modules/a/node_modules/vue': { version: '3.4.0', integrity: 'sha512-nested' },
        'node_modules/linked': { resolved: 'packages/linked', link: true },
        'node_modules/aliased': { name: 'real-name', version: '1.0.0', integrity: 'sha512-aliased' },
        'node_modules/b/node_modules/vue': { version: '3.5.0', integrity: 'sha512-later-copy' },
        'node_modules/unversioned': { integrity: 'sha512-unversioned' },
      } }),
    });
    const { purls, integrity } = sbomIdentity(root, { elmdb: 'elmdb#crates/elmdb-node', '@apackdev/terminal': 'apack-terminal', '@apackdev/git': 'apack-git' });
    // A local checkout's package (`npm run deps:local`) is from no release, so it has no purl here
    expect(purls).toEqual({
      elmdb: `pkg:github/spankyed/elmdb@${elmdb}#crates/elmdb-node`,
      '@apackdev/terminal': `pkg:github/spankyed/apack-terminal@${terminal}`,
    });
    // The first copy of a release is the one hashed; an entry without a version or an integrity is not hashed at all
    expect(Object.fromEntries(integrity)).toStrictEqual({
      'vue@3.5.0': 'sha512-hoisted', 'vue@3.4.0': 'sha512-nested', 'real-name@1.0.0': 'sha512-aliased',
      'elmdb@0.1.0': 'sha512-elmdb', '@apackdev/terminal@0.1.0': 'sha512-terminal',
    });
  });
});
