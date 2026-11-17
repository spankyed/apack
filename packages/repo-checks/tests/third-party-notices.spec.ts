import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OVERRIDES, chooseLicense, declaredLicense, noticeOf, noticePackages, packBundledPackages, renderNotices, writeAppNotices,
  type NoticePackage,
} from '../../../scripts/lib/third-party-notices.ts';

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

  it('refuses a license it does not know', () => {
    expect(chooseLicense('GPL-3.0-only', 'files')).toBeUndefined();
    expect(chooseLicense('SEE LICENSE IN EULA.txt', 'files')).toBeUndefined();
  });

  it('refuses an expression that does not parse, rather than reading part of it', () => {
    for (const malformed of ['MIT and GPL-3.0', 'MIT OR', '(MIT', 'MIT)', 'MIT WITH', 'OR MIT']) {
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
    const licenses = tree(Object.fromEntries(Object.values(OVERRIDES).flatMap(({ files }) => files.map((file) => [file, file]))));
    return { app, root, pack, licenses };
  }
  const write = (setup: ReturnType<typeof packaged>, channel: string, extra: Partial<Parameters<typeof writeAppNotices>[0]> = {}) =>
    writeAppNotices({
      appDir: setup.app, buildRoot: setup.root, bundleRecords: [path.join(setup.root, 'bundled-packages', 'main.json')],
      packDirs: [setup.pack], licensesDir: setup.licenses, channel, native: [], ...extra,
    });

  it('writes each text with the packages it covers', () => {
    const setup = packaged();
    const problems = write(setup, 'preview');
    const text = fs.readFileSync(path.join(setup.app, 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    expect(text).toContain('  ws 1.0.0, MIT, shipped\n\nws license');
    // Every override names a package this fixture does not carry
    expect(problems).toEqual(Object.keys(OVERRIDES).map((name) => expect.stringContaining(`OVERRIDES names ${name}`)));
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

  it('renders the same notices from the same packages, whatever order they come in', () => {
    const notices = [
      { package: { name: 'b', version: '1.0.0', dir: '/b', carried: 'files' as const }, license: 'MIT', text: 'same' },
      { package: { name: 'a', version: '1.0.0', dir: '/a', carried: 'inlined' as const }, license: 'MIT', text: 'same' },
    ];
    expect(renderNotices(notices, [])).toBe(renderNotices([...notices].reverse(), []));
    expect(renderNotices(notices, [])).toContain('Covering:\n  a 1.0.0, MIT, inlined\n  b 1.0.0, MIT, shipped\n\nsame');
  });
});
