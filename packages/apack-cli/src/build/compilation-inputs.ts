import type { PackBuildInputs } from '@apackdev/host/build/pack-build-inputs';
import { createHash } from 'node:crypto';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { buildToolHash, cliPackageDirectory } from './tool-identity.ts';
import { readPackageInputs, type PackageInputOwner } from '@apackdev/host/build/package-inputs';
import { parseNodeOptions, SOURCE_CONDITION } from '@apackdev/host/build/source-resolution';
import { readCompilerModuleInputs } from './compiler-module-inputs.ts';
import { isCompilerLocationPath, isOwnedCompilerPath, readCompilerInstallationInputs } from './compiler-installation-inputs.ts';
import type { PackCompilerConfiguration } from './compiler-configuration.ts';
import fs from 'node:fs';
import path from 'node:path';
import { packInputFiles } from '@apackdev/host/build/pack-inputs';
import {
  withoutCompilerFileReads,
  type CompilerMetadataKind,
  type CompilerDirectoryCursor,
  type CompilerDirectoryResult,
  compilerDiagnostic,
  compilerSourcePath,
  relativeCompilerPath,
  createCompilerInputObservations,
  hashCompilerInputObservations,
  type CompilerInputObservations,
  assertNativeCompilerObservations,
  type PackCompilerInputView,
} from '@apackdev/host/build/compiler-inputs';

import { captureCompilerLibraryEnvironment } from './compiler-native-libraries.ts';
import { createNativeInputReader } from './compiler-native-inputs.ts';
import { BUILD_INPUTS_DIRECTORY_ENV, createCompilerReadTree, type CompilerReadTree } from './compiler-read-tree.ts';
import { compilerExecutionIdentity, compilerStartupInputs } from './compiler-startup-inputs.ts';

/** Export selectors passed to the worker; executable preloads need their own captured input closure. */
export function compilationConditions(args = process.execArgv, nodeOptions = process.env.NODE_OPTIONS ?? ''): string[] {
  const options = [...parseNodeOptions(nodeOptions), ...args];
  const conditions = new Set<string>();
  for (let i = 0; i < options.length; i++) {
    const option = options[i]!;
    let condition: string | undefined;
    if (option.startsWith('--conditions=') || option.startsWith('-C=')) condition = option.slice(option.indexOf('=') + 1);
    else if (option === '--conditions' || option === '-C') condition = options[++i];
    if (condition && condition !== SOURCE_CONDITION) conditions.add(condition);
  }
  return [...conditions].sort();
}

export interface CompilationInputs {
  isInput(file: string): boolean;
  readonly hash: string;
  /** Explicit pack config; absence preserves native per-file config discovery. */
  readonly configuration: PackCompilerConfiguration | undefined;
  /** Declaration programs also inherit a parent config when the pack has none. */
  readonly declarationConfiguration: PackCompilerConfiguration | undefined;
  readFile(file: string): Buffer | undefined;
  readDataPath(file: string): string;
  readDirectory(file: string, options: unknown): CompilerDirectoryResult;
  openDirectory(file: string, options: unknown): CompilerDirectoryCursor;
  readMetadata(kind: CompilerMetadataKind, file: string, args: readonly unknown[]): unknown;
  captureGenerated(): void;
  readTree(): CompilerReadTree;
  sourcePath(file: string): string;
  diagnostic(message: string): string;
  prepareNative(specifier: string, importer: string): void;
  prepareNativeSource(file: string, contents: Buffer): void;
  requireParent(file: string): string;
  nativeModule(file: string): string;
  retainInputs(inputs: PackBuildInputs): void;
  finish(options: readonly string[]): Promise<PackBuildInputs>;
  dispose(): void;
  assertCurrent(): void;
}

/** Own one module read-set per build; recheck its data and package/tool inputs without rerunning TypeScript. */
export function captureCompilationInputs(packRoot: string, view?: PackCompilerInputView): CompilationInputs {
  const startup = compilerStartupInputs();
  if (startup && (startup.root !== fs.realpathSync.native(packRoot) || (view && view !== startup.view))) {
    throw new Error('Compiler startup inputs belong to another compilation');
  }
  view ??= startup?.view;
  if (startup && !startup.initial) throw new Error('Compiler startup observations must be captured before compilation');
  const cliRoot = cliPackageDirectory();
  const compiler = readCompilerInstallationInputs();
  if (compiler && !compiler.packages.includes(cliRoot)) throw new Error('Captured compiler inputs do not belong to this CLI');
  const nativeEnvironment = startup?.nativeEnvironment ?? captureCompilerLibraryEnvironment();
  const executionIdentity = startup?.executionIdentity ?? compilerExecutionIdentity(nativeEnvironment, undefined, compiler?.paths);
  const capturedPackages = new Set(compiler?.packages);
  const modules = readCompilerModuleInputs(packRoot, undefined, view);
  let startupObservations: CompilerInputObservations[] = [];
  const retained = new Set<PackBuildInputs>();
  const observationRoot = compilerSourcePath(fs.realpathSync.native(packRoot), compiler?.paths ?? []);
  let tree: CompilerReadTree | undefined;
  let disposed = false;
  const assertOpen = () => { if (disposed) throw new Error('Compiler input operation outlived its build'); };
  const owners: PackageInputOwner[] = [{ id: 'pack', directory: packRoot, development: true }];
  // Without a captured installation the CLI's own graph is the compiler, read whole as an installation is
  if (!compiler) owners.unshift({ id: 'cli', directory: cliRoot, development: false, dependencyContents: 'all' });
  const discovered = modules.packageDirectories.filter(directory => !capturedPackages.has(directory));
  const current = (capture = false) => {
    const inputs = readPackageInputs(owners, {
      discovered,
      dependencyContents: 'resolution',
      onFile: capture ? (file, bytes) => modules.captureFile(file.source, bytes) : undefined,
    });
    const compilerIdentity = compiler?.hash ?? buildToolHash();
    const hash = createHash('sha256').update(compilerIdentity).update(inputs.hash).update(modules.hash)
      // Preload order and native flags can change behavior while reading identical files.
      .update(startup ? executionIdentity : compilerExecutionIdentity(nativeEnvironment, undefined, compiler?.paths))
      .update(JSON.stringify(startup?.initial?.map(hashCompilerInputObservations) ?? []))
      .digest('hex');
    return { hash, packages: inputs, compilerIdentity };
  };
  const { hash, packages, compilerIdentity } = current(true);
  const sourcePath = (file: string): string => tree?.sourcePath(file) ?? compilerSourcePath(file, compiler?.paths ?? []);
  const readTree = (): CompilerReadTree => withoutCompilerFileReads(() => {
    assertOpen();
    if (!tree) {
      const links = packages.nodes.flatMap(node => [
        ...node.links.map(link => ({ file: path.join(node.directory, link.path), target: link.target })),
        ...Object.entries(node.dependencies).flatMap(([name, index]) => index === null ? []
          : [{ file: node.lookups[name]!, target: packages.nodes[index]!.directory }]),
      ]);
      for (const link of links) {
        modules.captureLocation(link.file, 'file');
        modules.ancestors(link.file);
      }
      const snapshot = modules.snapshot();
      const locations = [...snapshot.locations, ...packages.nodes.flatMap(node => node.directories
        .map(directory => ({ file: directory.source, physical: directory.source, kind: 'directory' })))];
      tree = createCompilerReadTree({ ...snapshot, locations, links }, compiler?.paths ?? [], (file, bytes, readPath) => native.projectMetadata(file, bytes, readPath));
    }
    return tree;
  });
  const canonicalRoot = fs.realpathSync.native(packRoot);
  const ownsToolPath = (file: string) => !!compiler
    && (isOwnedCompilerPath(file, compiler.directory) || isCompilerLocationPath(file, compiler.directory, canonicalRoot));
  const executable = nativeEnvironment.elf?.executable;
  const ownedExecutable = compiler && executable && isOwnedCompilerPath(executable, compiler.directory) ? executable : undefined;
  const ownExecutableAlias = `/proc/${process.pid}/exe`;
  const native = createNativeInputReader(modules, packages, sourcePath, snapshot => readTree().include(snapshot), {
    environment: nativeEnvironment, admitNative: startup?.nativeModule,
  });
  const workspace = process.env[BUILD_INPUTS_DIRECTORY_ENV];
  /** `replayStartup: false` only where the startup threads have just asserted their own observations. */
  const check = (replayStartup: boolean) => {
    assertOpen();
    withoutCompilerFileReads(() => {
      try {
        tree?.assertCurrent();
        modules.assertCurrent();
        if (replayStartup) for (const observations of startupObservations) assertNativeCompilerObservations(observations);
        for (const inputs of retained) assertNativeCompilerObservations({ root: observationRoot, entries: inputs.observations });
        if (current().hash !== hash) throw new Error('Implementation, package or execution options differ');
      } catch (cause) {
        throw new Error(`Compiler or installed package inputs changed; retry before publishing: ${errorMessage(cause)}`, { cause });
      }
    });
  };
  const assertCurrent = () => check(true);
  return {
    isInput(file) {
      if (ownsToolPath(file)) return false;
      const internal = [workspace, tree?.directory].some(directory => {
        if (!directory) return false;
        const relative = relativeCompilerPath(directory, file);
        return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
      });
      return !internal || sourcePath(file) !== file;
    },
    hash,
    configuration: modules.configuration,
    declarationConfiguration: modules.declarationConfiguration,
    readFile(file) {
      return withoutCompilerFileReads(() => {
        assertOpen();
        const bytes = modules.readBytes(file);
        if (tree && bytes !== undefined) tree.include({
          files: [modules.captureFile(file, bytes)], locations: [modules.captureLocation(file, 'file')!], links: [],
        });
        return bytes;
      });
    },
    readDataPath(file) {
      assertOpen();
      file = path.resolve(file);
      // libc header reads consume runtime-owned bytes, not a namespace that expires with this PID.
      if (ownedExecutable && (file === '/proc/self/exe' || file === ownExecutableAlias)) return ownedExecutable;
      // The parent already owns and verifies these tool bytes. Do not redirect them to the checkout.
      if (ownsToolPath(file)) return file;
      file = sourcePath(file);
      const bytes = modules.readDataBytes(file);
      const location = modules.captureLocation(file, 'file');
      const owned = readTree();
      owned.includeData({ files: bytes === undefined ? [] : [modules.captureFile(file, bytes)],
        locations: [...(location ? [location] : []), ...modules.ancestors(file)], links: [] });
      return owned.dataPath(file);
    },
    readDirectory(file, options) {
      assertOpen();
      file = path.resolve(file);
      if (ownsToolPath(file)) return Reflect.apply(fs.readdirSync, fs, [file, options]) as CompilerDirectoryResult;
      return modules.readDirectoryData(sourcePath(file), options);
    },
    openDirectory(file, options) {
      assertOpen();
      file = path.resolve(file);
      return modules.openDirectoryData(ownsToolPath(file) ? file : sourcePath(file), options);
    },
    readMetadata(kind, file, args) {
      assertOpen();
      file = path.resolve(file);
      return modules.readMetadata(kind, ownsToolPath(file) ? file : sourcePath(file), args);
    },
    captureGenerated() {
      assertOpen();
      for (const relative of packInputFiles(packRoot, { generated: true })) {
        if (!relative.startsWith('src/__generated__/')) continue;
        const file = path.join(packRoot, relative);
        modules.captureFile(file, fs.readFileSync(file));
      }
    },
    readTree,
    sourcePath,
    diagnostic(message) { return compilerDiagnostic(tree?.diagnostic(message) ?? message, compiler?.paths ?? []); },
    nativeModule(file) {
      assertOpen();
      if (ownsToolPath(file)) return startup?.nativeModule(file) ?? file;
      file = sourcePath(file);
      native.prepare(file, path.dirname(file));
      return startup?.nativeModule(file) ?? readTree().path(file);
    },
    prepareNative(specifier, importer) { withoutCompilerFileReads(() => { readTree(); native.prepare(specifier, sourcePath(importer)); }); },
    requireParent(file) { return withoutCompilerFileReads(() => { readTree(); native.prepare(file, path.dirname(sourcePath(file))); return readTree().path(file); }); },
    retainInputs(inputs) {
      assertOpen();
      retained.add(inputs);
    },
    async finish(options) {
      assertOpen();
      // Each startup thread asserts its own view as it returns these, so they are not replayed from disk here.
      if (startup) startupObservations = await startup.finish();
      check(false);
      // The immutable installation owns its namespace, including paths absent from the copy.
      // Projecting those absences back onto the original machine would misidentify source changes.
      const observed = modules.observations(ownsToolPath);
      const observations = createCompilerInputObservations(observed.root,
        [observed, ...startupObservations, ...[...retained].map(inputs => ({
          root: observationRoot, entries: inputs.observations,
        }))]).snapshot();
      const relative = (directory: string) => path.relative(observations.root,
        compilerSourcePath(directory, compiler?.paths ?? [])).split(path.sep).join('/');
      return {
        compiler: compilerIdentity,
        execution: createHash('sha256').update(executionIdentity).digest('hex'),
        options: [...new Set(options)].sort(),
        packages: { hash: packages.hash, owners: owners.map(owner => ({ ...owner,
          directory: relative(owner.directory),
        })), discovered: discovered.map(relative) },
        observations: observations.entries,
      };
    },
    prepareNativeSource(file, contents) { assertOpen(); withoutCompilerFileReads(() => native.prepareSource(sourcePath(file), contents)); },
    dispose() {
      if (disposed) return;
      disposed = true;
      withoutCompilerFileReads(() => { try { modules.dispose(); } finally { tree?.dispose(); } });
    },
    assertCurrent,
  };
}
