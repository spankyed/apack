import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packBuildRevision, sealPackBuild } from '@apackdev/host/packs';
import { MIME_TYPES, packRequestTarget, readPackFile } from '../src/modules/pack-protocol/PackProtocol.ts';

const revision = 'a'.repeat(64);
const base = `pack://my-pack/builds/${revision}/runtime/fe.js`;

it('retains the build identity in relative module, stylesheet and font requests', () => {
  for (const relative of ['chunks/widget.js', 'fe.css', '../fonts/ui.woff2']) {
    expect(packRequestTarget(new URL(relative, base).href)?.buildRevision).toBe(revision);
  }
  expect(packRequestTarget(base)).toEqual({ packId: 'my-pack', buildRevision: revision, filePath: 'runtime/fe.js' });
  expect(packRequestTarget(base.replace('fe.js', 'a%20b.js'))?.filePath).toBe('runtime/a b.js');
});

it('refuses unversioned URLs, malformed revisions, foreign schemes and invalid owners', () => {
  for (const url of [
    'pack://my-pack/runtime/fe.js', 'pack://my-pack/builds/short/runtime/fe.js',
    base.replace('pack:', 'https:'), base.replace('my-pack', '..'), base.replace('my-pack', 'pack_x'),
    base.replace('my-pack', '1pack'), base.replace('fe.js', '%zz'), 'not a url',
  ]) expect(packRequestTarget(url), url).toBeNull();
});

it('serves modules and styles with their actual MIME type', () => {
  expect(MIME_TYPES['.js']).toBe('application/javascript');
  expect(MIME_TYPES['.mjs']).toBe('application/javascript');
  expect(MIME_TYPES['.css']).toBe('text/css');
  expect(MIME_TYPES['.svg']).toBe('image/svg+xml');
  expect(MIME_TYPES['.woff2']).toBe('font/woff2');
  // `instantiateStreaming` refuses anything else, so a pack shipping a WebAssembly module depends on this
  expect(MIME_TYPES['.wasm']).toBe('application/wasm');
});

describe('accepted installed asset delivery', () => {
  let tmp: string;
  let packsDir: string;
  let dir: string;
  let accepted: string;
  function write(file: string, body: string) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  const seal = () => packBuildRevision(sealPackBuild(dir, { id: 'my-pack', name: 'My pack', version: '1.0.0' }));
  const read = (filePath = 'runtime/fe.js', buildRevision = accepted) =>
    readPackFile({ packsDir, packId: 'my-pack', buildRevision, filePath });
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pack-assets-')));
    packsDir = path.join(tmp, 'packs');
    dir = path.join(packsDir, 'my-pack');
    write('runtime/fe.js', 'export default {};');
    write('runtime/chunks/widget.js', 'export const widget = 1;');
    write('runtime/fe.css', 'body { color: red; }');
    accepted = seal();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('returns the verified bytes, including relative chunks and styles', () => {
    expect(read().toString()).toBe('export default {};');
    expect(read('runtime/chunks/widget.js').toString()).toBe('export const widget = 1;');
    expect(read('runtime/fe.css').toString()).toBe('body { color: red; }');
  });

  it('refuses a changed file without manufacturing a new build identity', () => {
    write('runtime/chunks/widget.js', 'export const widget = 2;');
    expect(() => read('runtime/chunks/widget.js')).toThrow('changed; rebuild and reinstall');
  });

  it('refuses an old module base after replacement, even when the entry bytes are identical', () => {
    write('runtime/chunks/widget.js', 'export const widget = 2;');
    const replacement = seal();
    expect(replacement).not.toBe(accepted);
    expect(() => read()).toThrow('build changed');
    expect(read('runtime/chunks/widget.js', replacement).toString()).toContain('= 2');
  });

  it('refuses unlisted files, missing files and missing installed copies without a shipped fallback', () => {
    write('runtime/unlisted.js', 'unexpected');
    expect(() => read('runtime/unlisted.js')).toThrow('does not declare asset');
    fs.rmSync(path.join(dir, 'runtime/fe.js'));
    expect(() => read()).toThrow();
    fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'app', 'my-pack', 'dist', 'runtime'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'app', 'my-pack', 'dist', 'runtime', 'fe.js'), 'shipped');
    expect(() => read()).toThrow();
  });

  it.each(['../outside.js', '/runtime/fe.js', 'runtime/../fe.js', 'runtime\\fe.js', ''])('refuses a noncanonical asset path %s', file => {
    expect(() => read(file)).toThrow('Invalid pack asset request');
  });

  it('refuses a symlink substituted for an accepted file or directory', () => {
    const file = path.join(dir, 'runtime/fe.js');
    const outside = path.join(tmp, 'outside.js');
    fs.copyFileSync(file, outside);
    fs.rmSync(file);
    fs.symlinkSync(outside, file);
    expect(() => read()).toThrow();
    fs.rmSync(file);
    fs.writeFileSync(file, 'export default {};');
    const chunks = path.join(dir, 'runtime/chunks');
    const moved = path.join(tmp, 'chunks');
    fs.renameSync(chunks, moved);
    fs.symlinkSync(moved, chunks);
    expect(() => read('runtime/chunks/widget.js')).toThrow('symbolic link');
  });
});
