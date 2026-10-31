import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { assertNativeCompilerObservations, beginCompilerStartupReads, createCompilerFileView } from '@apackdev/host/build/compiler-inputs';
import { BUILD_INPUTS_IPC_ENV, readCompilerWatchReports } from '../../src/build/build-watch-inputs.ts';
import { beginFrontendNativeInputs } from '../../src/build/frontend-native-inputs.ts';
import { createCompilerNativeInputs } from '../../src/build/compiler-native-input-owner.ts';
import { BUILD_INPUTS_DIRECTORY_ENV, removeCompilerReadTree } from '../../src/build/compiler-read-tree.ts';

// Exercise capture ownership with inert bytes; actual native loading belongs on disposable runners.
const runtimeProbe = vi.hoisted(() => ({ file: undefined as string | undefined, directory: undefined as string | undefined }));
vi.mock('../../src/build/compiler-native-libraries.ts', () => ({
  assertCapturedCompilerLibraries(file: string, _root: string, input: {
    read(file: string): unknown; directoryExists(file: string): boolean; readEntries(file: string): unknown;
  }) {
    if (runtimeProbe.directory) input.readEntries(runtimeProbe.directory);
    input.read(file);
    input.read(file.replace('addon.node', 'value.dll'));
    if (runtimeProbe.file) { input.read(runtimeProbe.file); input.directoryExists(runtimeProbe.file); }
  },
}));

it.each(['author', 'dependency'] as const)('keeps generated-output ownership with the %s package', owner => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-owner-')));
  const pack = path.join(root, 'pack'), workspace = path.join(root, 'workspace');
  const directory = owner === 'author' ? pack : path.join(root, 'dependency');
  const generated = path.join(directory, 'src/__generated__/events.ts');
  fs.mkdirSync(pack); fs.mkdirSync(workspace);
  fs.mkdirSync(path.dirname(generated), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{}');
  fs.writeFileSync(generated, 'BEFORE');
  fs.writeFileSync(path.join(directory, 'addon.node'), 'ADDON');
  fs.writeFileSync(path.join(directory, 'value.dll'), 'VALUE');
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  const view = createCompilerFileView(pack);
  const native = createCompilerNativeInputs(view, workspace, { directory: path.join(root, 'compiler'), paths: [] }, { macho: {
    libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [],
  } }, { capture: 'package' });
  try {
    runtimeProbe.file = path.join(workspace, 'node.exe.local');
    fs.mkdirSync(runtimeProbe.file);
    const captured = native.nativeModule(path.join(directory, 'addon.node'));
    expect(fs.readFileSync(captured, 'utf8')).toBe('ADDON');
    expect(fs.readFileSync(path.join(path.dirname(captured), 'value.dll'), 'utf8')).toBe('VALUE');
    // Runtime distribution membership belongs to the installation, not this pack's source receipt.
    fs.rmdirSync(runtimeProbe.file);
    expect(() => native.assertCurrent()).not.toThrow();
    fs.writeFileSync(generated, 'AFTER');
    const captureGenerated = () => view.captureFile(generated, Buffer.from('AFTER'));
    if (owner === 'author') expect(captureGenerated).not.toThrow();
    else expect(captureGenerated).toThrow('Compiler input changed during capture');
  } finally {
    runtimeProbe.file = undefined;
    native.dispose();
    vi.unstubAllEnvs();
    removeCompilerReadTree(root);
  }
});

it('keeps compiler copy locations out of replayable source input identity', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-owned-lookups-')));
  const pack = path.join(root, 'pack'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(pack); fs.mkdirSync(workspace);
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  const hashes: string[] = [];
  try {
    for (const name of ['compiler-a', 'compiler-b']) {
      const directory = path.join(root, name);
      const captured = path.join(directory, 'tree/drive');
      const dependency = path.join(captured, 'tool/node_modules/helper');
      fs.mkdirSync(dependency, { recursive: true });
      fs.writeFileSync(path.join(dependency, 'package.json'), '{"main":"index.js"}');
      fs.writeFileSync(path.join(dependency, 'index.js'), 'module.exports = 42;');
      const view = createCompilerFileView(pack);
      const native = createCompilerNativeInputs(view, workspace, {
        directory, paths: [{ captured, source: path.join(root, 'original') }],
      }, { macho: { libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [] } }, { capture: 'images' });
      const stop = beginCompilerStartupReads({ outputDirectory: workspace, compilation: {
        isInput: native.includes, readDataPath: native.readDataPath, sourcePath: native.sourcePath,
        readMetadata: view.readMetadata, readDirectory: view.readDirectoryData, openDirectory: view.openDirectoryData,
        requireParent: file => file, diagnostic: value => value,
      } });
      let observations;
      try {
        expect(createRequire(path.join(captured, 'tool/entry.cjs'))('helper')).toBe(42);
        hashes.push(view.hash());
        observations = view.observations();
      } finally { stop(); native.dispose(); }
      removeCompilerReadTree(directory);
      expect(() => assertNativeCompilerObservations(observations)).not.toThrow();
    }
    expect(hashes[1]).toBe(hashes[0]);
  } finally { vi.unstubAllEnvs(); removeCompilerReadTree(root); }
});


it('retains directory membership for native language lookup and replays it after disposal', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-directory-')));
  const pack = path.join(root, 'pack'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(pack); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(pack, 'addon.node'), 'ADDON');
  fs.writeFileSync(path.join(pack, 'value.dll'), 'VALUE');
  fs.writeFileSync(path.join(pack, 'package.json'), '{}');
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  const watched: string[] = [];
  const view = createCompilerFileView(pack, { observe: (file, kind) => { if (kind === 'entries') watched.push(file); } });
  const native = createCompilerNativeInputs(view, workspace, { directory: path.join(root, 'compiler'), paths: [] },
    { macho: { libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [] } }, { capture: 'images' });
  try {
    runtimeProbe.directory = pack;
    native.nativeModule(path.join(pack, 'addon.node'));
    expect(watched).toContain(pack);
    const observations = view.observations();
    native.dispose();
    expect(() => assertNativeCompilerObservations(observations)).not.toThrow();
    fs.mkdirSync(path.join(pack, 'fr-BE'));
    expect(() => assertNativeCompilerObservations(observations)).toThrow();
    fs.rmdirSync(path.join(pack, 'fr-BE'));
    expect(() => assertNativeCompilerObservations(observations)).not.toThrow();
  } finally { runtimeProbe.directory = undefined; native.dispose(); vi.unstubAllEnvs(); removeCompilerReadTree(root); }
});

it('retains frontend JavaScript preload inputs without pinning later authored reads', async () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-frontend-preload-')));
  const pack = path.join(root, 'pack'), workspace = path.join(root, 'workspace');
  fs.mkdirSync(pack); fs.mkdirSync(workspace);
  const preload = path.join(root, 'preload.cjs'), dependency = path.join(root, 'dependency.cjs');
  const authored = path.join(pack, 'View.vue');
  fs.writeFileSync(preload, "module.exports = require('./dependency.cjs');");
  fs.writeFileSync(dependency, 'module.exports = 41;');
  fs.writeFileSync(authored, '<template>before</template>');
  vi.stubEnv(BUILD_INPUTS_DIRECTORY_ENV, workspace);
  vi.stubEnv(BUILD_INPUTS_IPC_ENV, '1');
  const inputs = beginFrontendNativeInputs(pack, workspace, { directory: path.join(root, 'compiler'), paths: [] }, { macho: {
    libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [],
  } });
  try {
    expect(createRequire(import.meta.url)(preload)).toBe(41);
    inputs.stopReads();
    const observations = await inputs.snapshot();
    const probes = readCompilerWatchReports(workspace).flatMap(report => report.probes);
    for (const file of [preload, dependency]) {
      expect(probes).toContainEqual([file, 'file']);
      expect(observations.some(record => record.entries.some(([query]) => {
        const [kind, relative] = JSON.parse(query);
        return kind === 'file' && path.resolve(record.root, relative) === file;
      }))).toBe(true);
      const bytes = fs.readFileSync(file);
      fs.appendFileSync(file, '\n// changed preload input');
      await expect(inputs.snapshot()).rejects.toThrow(file);
      fs.writeFileSync(file, bytes);
      await expect(inputs.snapshot()).resolves.toBeDefined();
    }
    expect(() => observations.forEach(assertNativeCompilerObservations)).not.toThrow();
    expect(fs.readFileSync(authored, 'utf8')).toContain('before');
    fs.writeFileSync(authored, '<template>after</template>');
    expect(fs.readFileSync(authored, 'utf8')).toContain('after');
    await expect(inputs.snapshot()).resolves.toBeDefined();
  } finally {
    inputs.disposeLocal();
    vi.unstubAllEnvs();
    removeCompilerReadTree(root);
  }
});

it('keeps own executable data with its runtime owner without erasing procfs metadata or other process inputs', () => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-runtime-alias-')));
  const pack = path.join(root, 'pack'), workspace = path.join(root, 'workspace'), compiler = path.join(root, 'compiler');
  fs.mkdirSync(pack); fs.mkdirSync(workspace); fs.mkdirSync(compiler);
  const executable = path.join(compiler, 'node');
  fs.writeFileSync(executable, 'captured runtime image');
  const view = createCompilerFileView(pack);
  const native = createCompilerNativeInputs(view, workspace, { directory: compiler, paths: [] }, {
    macho: { libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [] },
    elf: { executable, cwd: root, libraryPaths: [], executableRpath: [], loader: '/lib/ld-linux.so', littleEndian: true,
      isaLevels: 0, loadedLibraries: [], systemDirectories: [], libraryToken: 'lib', platformToken: '', hardwareCapabilities: [] },
  }, { capture: 'images' });
  const previous = process.execPath;
  try {
    // User initialization cannot replace the runtime identity captured before it ran.
    process.execPath = path.join(compiler, 'different-node');
    for (const alias of ['/proc/self/exe', `/proc/${process.pid}/exe`]) {
      const captured = native.readDataPath(alias);
      expect(captured).toBe(executable);
      expect(fs.readFileSync(captured, 'utf8')).toBe('captured runtime image');
    }
    expect(native.copies()).toBeUndefined();
    expect(JSON.stringify(view.observations())).not.toContain('/proc/');
    // Explicit metadata remains the kernel's answer, even though data has a runtime owner.
    const metadata = () => view.readMetadata('readlink', '/proc/self/exe', []);
    if (fs.existsSync('/proc/self/exe')) expect(metadata()).toBe(fs.readlinkSync('/proc/self/exe'));
    else expect(metadata).toThrow();
    const foreign = '/proc/2147483647/exe';
    expect(native.readDataPath(foreign)).not.toBe(executable);
    expect(JSON.stringify(view.observations())).toContain('2147483647');
    expect(JSON.stringify(view.observations())).toContain('node-metadata');
  } finally { process.execPath = previous; native.dispose(); removeCompilerReadTree(root); }
});
