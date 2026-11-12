import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packInputFiles, packInputsHash, packInputWatchTargets } from '../../src/build/pack-inputs.ts';

const roots: string[] = [];
function pack(file: string, content: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-inputs-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, file), content);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('pack input identity', () => {
  it('is independent of checkout location and distinguishes ambiguous filename/content concatenation', () => {
    const first = pack('a', 'bc');
    expect(packInputsHash(first)).toBe(packInputsHash(pack('a', 'bc')));
    expect(packInputsHash(first)).not.toBe(packInputsHash(pack('ab', 'c')));
  });

  it('retains authored nested dist folders while excluding root build/dependency trees', () => {
    const root = pack('entry.ts', 'source');
    const before = packInputsHash(root);
    for (const dir of ['.git', 'node_modules', 'dist', '.apack', 'src/__generated__']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'entry.ts'), 'output');
    }
    expect(packInputsHash(root)).toBe(before);
    fs.mkdirSync(path.join(root, 'src/dist'));
    fs.writeFileSync(path.join(root, 'src/dist/entry.ts'), 'authored');
    expect(packInputsHash(root)).not.toBe(before);
  });

  it('is the same after a file browser, an editor or a tool left a file of its own in any folder', () => {
    const root = pack('entry.ts', 'source');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/a.ts'), 'authored');
    const before = packInputsHash(root);
    const files = packInputFiles(root);

    const left = [
      '.DS_Store', 'Thumbs.db', 'desktop.ini', '4913', '.eslintcache', '._a.ts', '.a.ts.swp', '.a.ts.swo', 'a.ts~',
      '.#a.ts', '#a.ts#', 'tsconfig.tsbuildinfo', 'npm-debug.log', 'npm-debug.log.1', '.nfs0000a1',
    ];
    for (const directory of ['', 'src']) for (const name of left) fs.writeFileSync(path.join(root, directory, name), 'left');
    for (const directory of ['.hg', '.svn', '.jj', '.turbo', 'src/.vite']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true });
      fs.writeFileSync(path.join(root, directory, 'entry.ts'), 'left');
    }

    expect(packInputFiles(root)).toEqual(files);
    expect(packInputsHash(root)).toBe(before);
  });

  it('leaves out what a test run wrote at the root, and keeps a source folder of the same name', () => {
    const root = pack('entry.ts', 'source');
    const before = packInputsHash(root);
    for (const directory of ['coverage', 'test-results', 'playwright-report']) {
      fs.mkdirSync(path.join(root, directory));
      fs.writeFileSync(path.join(root, directory, 'index.html'), 'report');
    }
    expect(packInputsHash(root)).toBe(before);

    fs.mkdirSync(path.join(root, 'src/coverage'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/coverage/map.ts'), 'authored');
    expect(packInputFiles(root)).toContain('src/coverage/map.ts');
  });

  it('keeps authored files whose names only resemble what a tool leaves', () => {
    const root = pack('entry.ts', 'source');
    const authored = ['swap.ts', 'notes.swpx', 'a~b.ts', '#readme.md', 'tsbuildinfo.ts', '.nfsrc.json5', 'log.npm-debug.ts', 'x._y.ts'];
    for (const name of authored) fs.writeFileSync(path.join(root, name), 'authored');

    expect(packInputFiles(root)).toEqual(['entry.ts', ...authored].sort());
  });

  it('tracks source symlinks and refuses directory cycles', () => {
    const root = pack('entry.ts', 'source');
    const linked = pack('schema.json', '{}');
    fs.symlinkSync(linked, path.join(root, 'schemas'), 'dir');
    const before = packInputsHash(root);
    fs.writeFileSync(path.join(linked, 'schema.json'), '{"type":"object"}');
    expect(packInputsHash(root)).not.toBe(before);
    fs.symlinkSync(root, path.join(root, 'loop'), 'dir');
    expect(() => packInputsHash(root)).toThrow('Cyclic source directory');
  });

  it('names a broken symbolic link in the authored tree rather than failing on a bare ENOENT', () => {
    const root = pack('entry.ts', 'source');
    fs.symlinkSync('../removed.ts', path.join(root, 'old.ts'));
    // The link text as the filesystem stores it: Windows writes its own separator
    expect(() => packInputsHash(root)).toThrow(`Broken symbolic link in pack source: old.ts -> ${path.normalize('../removed.ts')}`);
  });

  it('compares bytes and membership independently of filesystem timestamps', () => {
    const root = pack('entry.ts', 'before');
    const file = path.join(root, 'entry.ts');
    const { atime, mtime } = fs.statSync(file);
    const original = packInputsHash(root);
    fs.utimesSync(file, atime, new Date(mtime.getTime() + 60_000));
    expect(packInputsHash(root)).toBe(original);

    fs.writeFileSync(file, 'after!');
    fs.utimesSync(file, atime, mtime);
    expect(packInputsHash(root)).not.toBe(original);
    fs.writeFileSync(file, 'before');
    expect(packInputsHash(root)).toBe(original);

    const added = path.join(root, 'schema.json');
    fs.writeFileSync(added, '{}');
    fs.utimesSync(added, atime, mtime);
    expect(packInputsHash(root)).not.toBe(original);
    fs.rmSync(added);
    expect(packInputsHash(root)).toBe(original);
    fs.renameSync(file, path.join(root, 'renamed.ts'));
    expect(packInputsHash(root)).not.toBe(original);
  });
});


it('derives linked-directory and atomic-file replacement watches from authored inputs', () => {
  const root = pack('entry.ts', 'source');
  const linked = pack('schema.json', '{}');
  fs.symlinkSync(linked, path.join(root, 'schemas'), 'dir');
  fs.symlinkSync(path.join(linked, 'schema.json'), path.join(root, 'schema.json'));
  fs.symlinkSync(linked, path.join(root, 'node_modules'), 'dir');
  const targets = packInputWatchTargets(root);
  expect(targets).toContainEqual({ directory: fs.realpathSync.native(linked), relative: 'schemas' });
  expect(targets).toContainEqual({ directory: fs.realpathSync.native(linked), child: 'schema.json', relative: 'schema.json' });
  expect(targets.some(target => target.relative.startsWith('node_modules'))).toBe(false);
});
