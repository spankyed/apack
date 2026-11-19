import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from '@apackdev/host/build/packages-built';
import { population } from '@apackdev/sdk/testing';
import {
  ADAPTED, ADAPTED_FIRST_PARTY, EXTRAS, OVERRIDES, appSbom, brokerNoticesFile, chooseLicense, declaredLicense, noticeOf, noticePackages,
  packBundledPackages, renderNotices, sbomIdentity, shippedSource, staleExtras, uncreditedAdaptations, writeAppNotices,
  type NoticePackage,
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

  it('fails a production or beta build on a problem, and reports it on a preview', () => {
    const setup = packaged({});
    const missing = /main\.json is missing: the build that wrote the bundles did not record what they inlined/;
    expect(write(setup, 'preview')).toContainEqual(expect.stringMatching(missing));
    expect(() => write(setup, 'production')).toThrow(missing);
    expect(() => write(setup, 'beta')).toThrow(missing);
  });

  it("reports a native binary's notices that are missing, or a binary that is", () => {
    const setup = packaged();
    const problems = write(setup, 'preview', { native: [{ pointer: 'elmdb', file: path.join(setup.app, 'NOTICES') }, { pointer: 'the broker', file: null }] });
    expect(problems).toContainEqual(expect.stringMatching(/NOTICES is missing, so its binary would ship without its notices/));
    expect(problems).toContainEqual('No binary was found for the broker');
  });

  it("reports why a native pointer may be wrong, and still names it in the header", () => {
    const setup = packaged();
    expect(write(setup, 'preview', { native: [{ pointer: 'FFmpeg', problem: 'read for another Electron' }] })).toContainEqual('read for another Electron');
    expect(fs.readFileSync(path.join(setup.app, 'THIRD-PARTY-NOTICES.txt'), 'utf8')).toContain('  - FFmpeg\n');
  });

  it('reports a carried package whose downloaded binary is another release than its texts were read for', () => {
    const setup = packaged();
    for (const [file, text] of Object.entries(installed('@vscode/ripgrep', { license: 'MIT' }, { LICENSE: 'x', 'lib/postinstall.js': "const VERSION = 'v0.0.1';" }))) {
      fs.mkdirSync(path.dirname(path.join(setup.app, file)), { recursive: true });
      fs.writeFileSync(path.join(setup.app, file), text);
    }
    expect(write(setup, 'preview')).toContainEqual(expect.stringContaining('@vscode/ripgrep@1.0.0 downloads v0.0.1'));
  });

  it("points at the broker's notices built for the app's own platform, never another's", () => {
    const broker = 'node_modules/@app/terminal-broker/bin/abc123';
    const app = tree({ [`${broker}/darwin-arm64/THIRD-PARTY-NOTICES`]: 'x', [`${broker}/darwin-x64/THIRD-PARTY-NOTICES`]: 'x' });
    expect(brokerNoticesFile(app, 'darwin-x64')).toBe(path.join(app, broker, 'darwin-x64', 'THIRD-PARTY-NOTICES'));
    expect(brokerNoticesFile(app, 'darwin-arm64')).toBe(path.join(app, broker, 'darwin-arm64', 'THIRD-PARTY-NOTICES'));
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
      [{ type: 'framework', name: 'electron', version: '44.9.3', purl: 'pkg:npm/electron@44.9.3', license: 'MIT' }]) as {
      specVersion: string; metadata: { component: { name: string } }; components: Record<string, unknown>[];
    };
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.metadata.component.name).toBe('apack');
    expect(sbom.components.map((component) => component.purl)).toEqual([
      'pkg:github/spankyed/elmdb@abc123', 'pkg:npm/%40tiptap/pm@3.0.0', 'pkg:npm/bare@1.0.0', 'pkg:npm/electron@44.9.3', 'pkg:npm/plus@1.0.0',
      'pkg:npm/vue@3.5.0', 'pkg:npm/weird@1.0.0',
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

  it("names vendored packages by their pinned commit and directory, and hashes the lockfile's", () => {
    const root = tree({
      'vendor/elmdb.rev': 'abc123\n',
      'vendor/apack-terminal.rev': 'def456\n',
      'package-lock.json': JSON.stringify({ packages: {
        '': { name: 'apack', version: '0.3.14' },
        'node_modules/vue': { version: '3.5.0', integrity: 'sha512-hoisted' },
        'node_modules/a/node_modules/vue': { version: '3.4.0', integrity: 'sha512-nested' },
        'node_modules/linked': { resolved: 'packages/linked', link: true },
        'node_modules/aliased': { name: 'real-name', version: '1.0.0', integrity: 'sha512-aliased' },
        'node_modules/b/node_modules/vue': { version: '3.5.0', integrity: 'sha512-later-copy' },
        'node_modules/unversioned': { integrity: 'sha512-unversioned' },
      } }),
    });
    const { purls, integrity } = sbomIdentity(root, { elmdb: 'elmdb#crates/elmdb-node', 'apack-terminal': 'apack-terminal' });
    expect(purls).toEqual({
      elmdb: 'pkg:github/spankyed/elmdb@abc123#crates/elmdb-node',
      'apack-terminal': 'pkg:github/spankyed/apack-terminal@def456',
    });
    // The first copy of a release is the one hashed; an entry without a version or an integrity is not hashed at all
    expect(Object.fromEntries(integrity)).toStrictEqual({
      'vue@3.5.0': 'sha512-hoisted', 'vue@3.4.0': 'sha512-nested', 'real-name@1.0.0': 'sha512-aliased',
    });
  });
});
