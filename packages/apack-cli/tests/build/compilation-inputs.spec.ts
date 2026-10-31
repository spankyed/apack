import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliPackageDirectory } from '../../src/build/tool-identity.ts';
import { createCompilerInputObservations } from '@apackdev/host/build/compiler-inputs';
import { expect, it, vi } from 'vitest';
import * as nativeLibraries from '../../src/build/compiler-native-libraries.ts';
import { compilationConditions, captureCompilationInputs } from '../../src/build/compilation-inputs.ts';

it('normalizes equivalent launch paths while retaining custom export selectors', () => {
  expect(compilationConditions(['--require', '/test-loader.js', '--conditions=custom', '-C', 'custom'],
    '--import /other-loader.js --conditions="@apackdev/source" --conditions="custom with space"'))
    .toEqual(['custom', 'custom with space']);
  expect(compilationConditions([], '--conditions=@apackdev/source')).toEqual(compilationConditions([], ''));
});

it('preserves literal single quotes and unquoted backslashes in environment selectors', () => {
  expect(compilationConditions([], String.raw`--conditions='two words' --conditions=back\slash`))
    .toEqual(["'two", String.raw`back\slash`]);
});

it("retains skipped phases' consumed inputs and refuses changes before completing their replacement", async () => {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-completed-inputs-')));
  const root = path.join(temporary, 'pack');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, types: [] } }));
  fs.writeFileSync(path.join(root, 'value.ts'), 'export const value = 1;');
  const installation = path.join(temporary, 'compiler');
  fs.mkdirSync(installation);
  const metadata = path.join(installation, 'inputs.json');
  fs.writeFileSync(metadata, JSON.stringify({ hash: 'a'.repeat(64), packages: [cliPackageDirectory()], paths: [] }));
  vi.stubEnv('APACK_COMPILER_INPUTS', metadata);
  const file = path.join(temporary, 'external.txt');
  fs.writeFileSync(file, 'FIRST');
  try {
    const first = captureCompilationInputs(root);
    const inputs = await (async () => {
      try {
        first.readFile(file);
        first.prepareNativeSource(path.join(root, 'virtual.ts'), Buffer.from('export {};'));
        return await first.finish([]);
      }
      finally { first.dispose(); }
    })();
    // Native resolution inventories authored siblings, not the output directory publication creates.
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/compiled.js'), 'output');
    const replacement = captureCompilationInputs(root);
    try {
      replacement.retainInputs(inputs);
      replacement.retainInputs(inputs);
      const completed = await replacement.finish([]);
      expect(completed.observations).toEqual(createCompilerInputObservations(root,
        [{ root, entries: completed.observations }, { root, entries: inputs.observations }]).snapshot().entries);
      expect(JSON.stringify(completed)).not.toContain(temporary);
    } finally { replacement.dispose(); }
    const changed = captureCompilationInputs(root);
    try {
      changed.retainInputs(inputs);
      fs.writeFileSync(file, 'OTHER');
      await expect(changed.finish([])).rejects.toThrow(/input changed/);
    } finally { changed.dispose(); }
  } finally {
    vi.unstubAllEnvs();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

it.runIf(process.platform === 'win32').each(['tool', 'workspace'] as const)(
  'preserves compiler ownership for extended Windows paths: %s', owner => {
    const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-owned-inputs-')));
    const installation = path.join(temporary, 'compiler');
    fs.mkdirSync(installation);
    const root = path.join(temporary, 'pack'), owned = path.join(owner === 'tool' ? installation : temporary, 'owned');
    fs.mkdirSync(root); fs.mkdirSync(owned);
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noLib":true,"types":[]}}');
    const file = path.join(owned, 'native.node');
    fs.writeFileSync(file, 'INERT');
    const metadata = path.join(installation, 'inputs.json');
    fs.writeFileSync(metadata, JSON.stringify({ hash: 'a'.repeat(64), packages: [cliPackageDirectory()],
      paths: owner === 'tool' ? [{ captured: owned, source: path.join(temporary, 'original') }] : [] }));
    vi.stubEnv('APACK_COMPILER_INPUTS', metadata);
    if (owner === 'workspace') vi.stubEnv('APACK_BUILD_INPUTS_DIRECTORY', owned);
    let inputs: ReturnType<typeof captureCompilationInputs> | undefined;
    try {
      inputs = captureCompilationInputs(root);
      expect(inputs.isInput(file)).toBe(false);
      const extended = path.toNamespacedPath(file);
      expect(inputs.isInput(extended)).toBe(false);
      expect(inputs.isInput(path.join(temporary, 'owned-sibling/native.node'))).toBe(true);
      if (owner === 'tool') expect(inputs.readDataPath(extended)).toBe(extended);
    } finally {
      inputs?.dispose(); vi.unstubAllEnvs(); fs.rmSync(temporary, { recursive: true, force: true });
    }
  },
);


it.each(['safeSearch', 'devOverride', 'knownDlls'] as const)('includes captured native %s policy in the phase input identity', policy => {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-native-policy-')));
  const pack = path.join(root, 'pack');
  fs.mkdirSync(pack);
  fs.writeFileSync(path.join(pack, 'package.json'), '{"name":"native-policy","version":"1.0.0"}');
  fs.writeFileSync(path.join(pack, 'tsconfig.json'), '{"compilerOptions":{"noLib":true,"types":[]}}');
  const installation = path.join(root, 'compiler');
  fs.mkdirSync(installation);
  const metadata = path.join(installation, 'inputs.json');
  fs.writeFileSync(metadata, JSON.stringify({ hash: 'a'.repeat(64), packages: [cliPackageDirectory()], paths: [] }));
  vi.stubEnv('APACK_COMPILER_INPUTS', metadata);
  let environment: nativeLibraries.CompilerLibraryEnvironment = { macho: {
    libraryPaths: [], fallbackLibraryPaths: undefined, frameworkPaths: [], fallbackFrameworkPaths: undefined, imageSuffixes: [],
  }, pe: { systemDirectory: 'C:\\Windows\\System32', windowsDirectory: 'C:\\Windows', safeSearch: true,
    devOverride: false, knownDlls: [], apiSets: [], schema: 'C:\\Windows\\System32\\apisetschema.dll', nodeApiExports: [],
    applicationContext: { image: 'C:\\compiler\\node.exe', inputs: [], redirections: [] } } };
  const capture = vi.spyOn(nativeLibraries, 'captureCompilerLibraryEnvironment').mockImplementation(() => environment);
  const identity = () => { const input = captureCompilationInputs(pack); try { return input.hash; } finally { input.dispose(); } };
  try {
    const first = identity();
    if (policy === 'safeSearch') environment = { ...environment, pe: { ...environment.pe!, safeSearch: false } };
    else if (policy === 'devOverride') environment = { ...environment, pe: { ...environment.pe!, devOverride: true } };
    else environment = { ...environment, pe: { ...environment.pe!, knownDlls: ['value.dll'] } };
    expect(identity()).not.toBe(first);
  } finally { capture.mockRestore(); vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
});

it.runIf(process.platform !== 'win32')('keeps compilation executable reads with the captured runtime owner', () => {
  const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'apack-compilation-exe-')));
  const root = path.join(temporary, 'pack'), installation = path.join(temporary, 'compiler');
  fs.mkdirSync(root); fs.mkdirSync(installation);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noLib":true,"types":[]}}');
  const executable = path.join(installation, 'node');
  fs.writeFileSync(executable, 'captured runtime');
  const metadata = path.join(installation, 'inputs.json');
  fs.writeFileSync(metadata, JSON.stringify({ hash: 'a'.repeat(64), packages: [cliPackageDirectory()], paths: [] }));
  vi.stubEnv('APACK_COMPILER_INPUTS', metadata);
  const environment = nativeLibraries.captureCompilerLibraryEnvironment();
  vi.spyOn(nativeLibraries, 'captureCompilerLibraryEnvironment').mockReturnValue({ ...environment, elf: {
    executable, cwd: root, libraryPaths: [], executableRpath: [], loader: '/lib/ld-linux.so', littleEndian: true,
    isaLevels: 0, loadedLibraries: [], systemDirectories: [], libraryToken: 'lib', platformToken: '', hardwareCapabilities: [],
  } });
  let inputs: ReturnType<typeof captureCompilationInputs> | undefined;
  const previous = process.execPath;
  try {
    inputs = captureCompilationInputs(root);
    process.execPath = path.join(installation, 'spoofed-node');
    expect(inputs.readDataPath('/proc/self/exe')).toBe(executable);
    expect(inputs.readDataPath(`/proc/${process.pid}/exe`)).toBe(executable);
    const metadataRead = () => inputs!.readMetadata('readlink', '/proc/self/exe', []);
    if (fs.existsSync('/proc/self/exe')) expect(metadataRead()).toBe(fs.readlinkSync('/proc/self/exe'));
    else expect(metadataRead).toThrow();
    expect(inputs.readDataPath('/proc/2147483647/exe')).not.toBe(executable);
  } finally {
    process.execPath = previous; inputs?.dispose(); vi.restoreAllMocks(); vi.unstubAllEnvs();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
