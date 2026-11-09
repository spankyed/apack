import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assertNativeCompilerObservations, createCompilerFileView } from '@apackdev/host/build/compiler-inputs';
import { BUILD_INPUTS_DIRECTORY_ENV, createCompilerReadTree, removeCompilerReadTree, type CompilerReadTree } from '../../src/build/compiler-read-tree.ts';
import { compilerReadMapping } from '../../bin/compiler-source-hooks.mjs';
import { execFileWhileWorking } from '@apackdev/sdk/progress';

const roots: string[] = [];
const trees: CompilerReadTree[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const tree of trees.splice(0)) tree.dispose();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it('replays retained copy integrity after the source disappears and refuses writable or changed bytes', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-retained-copy-')));
  roots.push(root);
  const file = path.join(root, 'module.node');
  fs.writeFileSync(file, 'OWNED');
  fs.chmodSync(file, 0o755);
  const mode = fs.statSync(file).mode & 0o777;
  const tree = createCompilerReadTree({ files: [{ file, bytes: Buffer.from('OWNED'), mode }], locations: [], links: [] }, []);
  trees.push(tree);
  const observed = tree.observations();
  fs.rmSync(file);
  expect(() => assertNativeCompilerObservations(observed)).not.toThrow();
  const copy = tree.path(file);
  fs.chmodSync(copy, mode | 0o222);
  expect(() => assertNativeCompilerObservations(observed)).toThrow(/changed/);
  fs.writeFileSync(copy, 'CHANGED');
  fs.chmodSync(copy, mode & ~0o222);
  expect(() => assertNativeCompilerObservations(observed)).toThrow(/changed/);
});

/** A standalone tree's process may die before disposing it; the next standalone tree removes it */
it('removes standalone trees whose process has exited and keeps a live process\'s', async () => {
  const parent = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-standalone-trees-')));
  roots.push(parent);
  const exited = (await execFileWhileWorking(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'])).stdout;
  const abandoned = path.join(parent, `apack-inputs-${exited}-AbCdEf`);
  const live = path.join(parent, `apack-inputs-${process.pid}-GhIjKl`);
  for (const tree of [abandoned, live]) {
    fs.mkdirSync(path.join(tree, 'work'), { recursive: true });
    fs.chmodSync(tree, 0o500);
  }
  vi.spyOn(os, 'tmpdir').mockReturnValue(parent);
  const tree = createCompilerReadTree({ files: [], locations: [], links: [] }, []);
  trees.push(tree);
  expect(path.dirname(tree.directory)).toBe(parent);
  expect(fs.existsSync(abandoned)).toBe(false);
  expect(fs.existsSync(live)).toBe(true);
  fs.chmodSync(live, 0o700);
});

it('lets the parent remove an abandoned read-only workspace without following foreign links', () => {
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-parent-inputs-')));
  const foreign = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-foreign-inputs-')));
  roots.push(workspace, foreign);
  fs.chmodSync(foreign, 0o755);
  const foreignMode = fs.statSync(foreign).mode;
  const file = path.join(foreign, 'source.ts');
  fs.writeFileSync(file, 'export const untouched = true;');
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  const tree = createCompilerReadTree({
    files: [{ file, bytes: fs.readFileSync(file), mode: 0o644 }], locations: [], links: [],
  }, []);
  trees.push(tree);
  expect(path.dirname(tree.directory)).toBe(workspace);
  const link = path.join(workspace, 'foreign');
  fs.symlinkSync(foreign, link, 'dir');
  const chmod = vi.spyOn(fs, 'chmodSync');
  removeCompilerReadTree(workspace);
  expect(fs.existsSync(workspace)).toBe(false);
  expect(fs.readFileSync(file, 'utf8')).toContain('untouched = true');
  expect(fs.statSync(foreign).mode).toBe(foreignMode);
  expect(chmod.mock.calls.map(([file]) => file)).not.toContain(foreign);
  expect(chmod.mock.calls.map(([file]) => file)).not.toContain(link);
});

it('closes a worker frame while retaining its bytes until the parent removes the workspace', () => {
  const workspace = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-worker-inputs-')));
  roots.push(workspace);
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  const file = path.join(workspace, 'source.node');
  const tree = createCompilerReadTree({ files: [{ file, bytes: Buffer.from('OWNED'), mode: 0o644 }], locations: [], links: [] }, []);
  trees.push(tree);
  const copy = tree.path(file);
  tree.dispose();
  expect(() => tree.assertCurrent()).toThrow(/outlived/);
  expect(fs.readFileSync(copy, 'utf8')).toBe('OWNED');
  removeCompilerReadTree(workspace);
  expect(fs.existsSync(copy)).toBe(false);
  expect(fs.existsSync(workspace)).toBe(false);
});

it('preserves owned file/directory links, dangling links and executable bits after originals disappear', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-read-tree-source-')));
  roots.push(root);
  const pack = path.join(root, 'pack'), shared = path.join(root, 'shared');
  fs.mkdirSync(pack); fs.mkdirSync(shared);
  const file = path.join(shared, 'value.ts');
  fs.writeFileSync(file, 'export const value = 7;');
  fs.chmodSync(file, 0o755);
  const executable = fs.statSync(file).mode & 0o111;
  fs.symlinkSync('../shared', path.join(pack, 'linked'), 'dir');
  fs.symlinkSync('../shared/value.ts', path.join(pack, 'entry.ts'));
  fs.symlinkSync('../missing.ts', path.join(pack, 'missing.ts'));
  const view = createCompilerFileView(pack);
  expect(view.fileSystem.directoryExists(path.join(pack, 'linked'))).toBe(true);
  expect(view.fileSystem.readFile(path.join(pack, 'entry.ts'))).toContain('value = 7');
  expect(view.fileSystem.readFile(path.join(pack, 'linked/value.ts'))).toContain('value = 7');
  expect(view.fileSystem.fileExists(path.join(pack, 'missing.ts'))).toBe(false);
  const tree = createCompilerReadTree({ ...view.snapshot(), links: [] }, []);
  trees.push(tree);
  fs.rmSync(root, { recursive: true, force: true });
  expect(fs.readFileSync(tree.path(path.join(pack, 'linked/value.ts')), 'utf8')).toContain('value = 7');
  expect(tree.sourcePath(fs.realpathSync.native(tree.path(path.join(pack, 'entry.ts'))))).toBe(file);
  expect(fs.existsSync(tree.path(path.join(pack, 'missing.ts')))).toBe(false);
  expect(fs.lstatSync(tree.path(path.join(pack, 'missing.ts'))).isSymbolicLink()).toBe(true);
  expect(fs.statSync(tree.path(file)).mode & 0o111).toBe(executable);
  expect(fs.statSync(tree.path(file)).mode & 0o222).toBe(0);
  // Windows chmod controls file read-only attributes, not directory permissions.
  if (process.platform !== 'win32') expect(fs.statSync(tree.path(pack)).mode & 0o222).toBe(0);
  expect(() => tree.assertCurrent()).not.toThrow();
  fs.chmodSync(tree.path(file), 0o644);
  fs.writeFileSync(tree.path(file), 'export const value = 99;');
  expect(() => tree.assertCurrent()).toThrow('Captured compiler input changed');
  const directory = tree.directory;
  tree.dispose();
  expect(fs.existsSync(directory)).toBe(false);
});

it('refuses conflicting captured/source origins and removes the incomplete tree', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-read-tree-conflict-')));
  roots.push(root);
  const source = path.join(root, 'source'), captured = path.join(root, 'captured');
  const mkdtemp = fs.mkdtempSync;
  let directory = '';
  vi.spyOn(fs, 'mkdtempSync').mockImplementation(prefix => directory = mkdtemp(prefix));
  expect(() => createCompilerReadTree({
    files: [
      { file: path.join(source, 'a.ts'), bytes: Buffer.from('original'), mode: 0o644 },
      { file: path.join(captured, 'a.ts'), bytes: Buffer.from('different'), mode: 0o644 },
    ], locations: [], links: [],
  }, [{ source, captured }])).toThrow('Conflicting captured input');
  expect(directory).not.toBe('');
  expect(fs.existsSync(directory)).toBe(false);
});

it('reuses materialized directories independently for code and data reads', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-read-tree-reuse-')));
  roots.push(root);
  const file = path.join(root, 'value.ts');
  fs.writeFileSync(file, 'export const value = 7;');
  const view = createCompilerFileView(root);
  view.readBytes(file);
  const snapshot = { ...view.snapshot(), links: [] };
  const tree = createCompilerReadTree(snapshot, []);
  trees.push(tree);
  tree.includeData(snapshot);
  const chmod = vi.spyOn(fs, 'chmodSync');
  tree.include(snapshot);
  tree.includeData(snapshot);
  expect(chmod).not.toHaveBeenCalled();
  expect(fs.readFileSync(tree.path(file), 'utf8')).toContain('value = 7');
  expect(fs.readFileSync(tree.dataPath(file), 'utf8')).toContain('value = 7');
  tree.assertCurrent();
});

it('refuses retained admissions after disposal while preserving diagnostic paths', () => {
  const tree = createCompilerReadTree({ files: [], locations: [], links: [] }, []);
  trees.push(tree);
  const file = path.join(os.tmpdir(), 'retained-source.ts');
  const owned = tree.path(file);
  const snapshot = { files: [{ file, bytes: Buffer.from('export {};'), mode: 0o644 }], locations: [], links: [] };
  tree.dispose();
  tree.dispose();
  expect(() => tree.include(snapshot)).toThrow(/outlived/);
  expect(() => tree.includeData(snapshot)).toThrow(/outlived/);
  expect(() => tree.assertCurrent()).toThrow(/outlived/);
  expect(tree.diagnostic(owned)).toBe(file);
  expect(fs.existsSync(tree.directory)).toBe(false);
});

/**
 * Native loading hands Windows the extended spelling of a module's path, and side-by-side activation probes for its
 * manifests and configuration beside it. Both spellings must reach one stored location, or a captured addon loads
 * from a directory holding none of its selectors.
 */
it.runIf(process.platform === 'win32')('stores the extended and drive spellings of a file in one place', () => {
  const directory = 'C:\\inputs';
  const drive = compilerReadMapping(directory, 'C:\\pack\\binding\\addon.node');
  expect(compilerReadMapping(directory, '\\\\?\\C:\\pack\\binding\\addon.node')).toEqual(drive);
  expect(compilerReadMapping(directory, 'C:\\pack\\binding\\addon.node.2.config').readRoot).toBe(drive.readRoot);
});
