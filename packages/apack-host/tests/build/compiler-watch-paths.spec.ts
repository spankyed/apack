import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { physicalWatchPath, physicalWatchPathListed, type PhysicalListings } from '../../src/build/compiler-inputs/watch-paths.ts';
import { resolveCompilerPath } from '../../src/build/compiler-inputs/compiler-paths.ts';

it('canonicalizes an extended drive root without producing a volume handle or a synthetic C: child', () => {
  const root = resolveCompilerPath('\\\\?\\C:\\');
  expect(root).toBe('C:\\');
  expect(path.win32.join(root, path.win32.basename(root))).toBe(root);
  expect(resolveCompilerPath('.')).toBe(process.cwd());
});

it('resolves extended Windows drive roots through their equivalent DOS spelling', () => {
  const native = vi.spyOn(fs.realpathSync, 'native').mockImplementation(file => {
    if (file === 'C:\\') return 'C:\\';
    throw Object.assign(new Error('root realpath failed'), { code: 'EISDIR' });
  });
  try {
    expect(physicalWatchPath('\\\\?\\C:\\')).toBe('C:\\');
    expect(native).toHaveBeenCalledWith('C:\\');
  } finally { native.mockRestore(); }
});

it('preserves non-root realpath errors instead of treating them as missing inputs', () => {
  const native = vi.spyOn(fs.realpathSync, 'native').mockImplementation(() => {
    throw Object.assign(new Error('non-root failure'), { code: 'EISDIR' });
  });
  try {
    const file = path.join(process.cwd(), 'value');
    expect(() => physicalWatchPath(file)).toThrow(`Cannot resolve compiler input path ${JSON.stringify(file)}`);
    try { physicalWatchPath(file); }
    catch (error) { expect((error as Error).cause).toMatchObject({ message: 'non-root failure', code: 'EISDIR' }); }
  }
  finally { native.mockRestore(); }
});

it('resolves a dangling relative link inside a linked directory from its physical directory', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'apack-watch-link-'));
  try {
    const store = path.join(root, 'store');
    fs.mkdirSync(path.join(store, 'x'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pack'));
    fs.symlinkSync(path.join(store, 'x'), path.join(root, 'pack', 'deps'), 'dir');
    fs.symlinkSync('../b', path.join(store, 'x', 'a'));
    // The kernel resolves `../b` from store/x, so a later store/b is what the compiler would see
    expect(physicalWatchPath(path.join(root, 'pack', 'deps', 'a'))).toBe(path.join(store, 'b'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('answers from a directory listing exactly what resolving each path answers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apack-watch-listed-'));
  try {
    fs.mkdirSync(path.join(root, 'real/nested'), { recursive: true });
    for (const name of ['one.ts', 'two.ts', 'Three.ts']) fs.writeFileSync(path.join(root, 'real', name), name);
    fs.writeFileSync(path.join(root, 'real/nested/deep.ts'), 'deep');
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'), 'dir');
    fs.symlinkSync(path.join(root, 'real/one.ts'), path.join(root, 'real/link.ts'));
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(root, 'real/dangling.ts'));
    const folds = fs.existsSync(path.join(root, 'REAL/ONE.TS'));
    const files = ['real/one.ts', 'real/two.ts', 'real/Three.ts', 'real/link.ts', 'real/dangling.ts', 'real/missing.ts', 'real/nested',
      'real/nested/deep.ts', 'real/nested/absent/below.ts', 'alias/one.ts', 'alias/two.ts', 'alias/nested/deep.ts', 'alias/link.ts',
      ...(folds ? ['real/ONE.ts', 'real/three.ts', 'REAL/two.ts', 'ALIAS/Nested/Deep.ts'] : [])].map(file => path.join(root, file));
    const cache = new Map<string, string>(), listings: PhysicalListings = new Map();
    const lists = vi.spyOn(fs, 'readdirSync');
    // Twice over, so every directory has been asked of often enough to be listed
    for (const file of [...files, ...files]) expect([file, physicalWatchPathListed(file, new Map(), listings)]).toEqual([file, physicalWatchPath(file)]);
    for (const file of files) expect([file, physicalWatchPathListed(file, cache, listings)]).toEqual([file, physicalWatchPath(file)]);
    expect(lists.mock.calls.length).toBeGreaterThan(0);
    lists.mockRestore();
    // A listing is as old as its map. A plain file that appears after it resolves to the same place either way; a
    // link that does is answered as the missing name it was, until a fresh map lists the directory again.
    fs.writeFileSync(path.join(root, 'real/later.ts'), 'later');
    fs.symlinkSync(path.join(root, 'real/two.ts'), path.join(root, 'real/later-link.ts'));
    const real = fs.realpathSync.native(path.join(root, 'real'));
    expect(physicalWatchPathListed(path.join(root, 'real/later.ts'), new Map(), listings)).toBe(path.join(real, 'later.ts'));
    expect(physicalWatchPathListed(path.join(root, 'real/later-link.ts'), new Map(), listings)).toBe(path.join(real, 'later-link.ts'));
    const fresh: PhysicalListings = new Map();
    physicalWatchPathListed(path.join(root, 'real/one.ts'), new Map(), fresh);
    expect(physicalWatchPathListed(path.join(root, 'real/later-link.ts'), new Map(), fresh)).toBe(path.join(real, 'two.ts'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('lists no directory for the only path asked of it', () => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'apack-watch-single-'));
  try {
    fs.writeFileSync(path.join(root, 'only.ts'), 'only');
    const list = vi.fn((directory: string) => fs.readdirSync(directory, { withFileTypes: true }));
    expect(physicalWatchPathListed(path.join(root, 'only.ts'), new Map(), new Map(), list)).toBe(path.join(root, 'only.ts'));
    expect(list).not.toHaveBeenCalled();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
