import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { readPackCompilerConfiguration, type PackCompilerConfiguration } from './compiler-configuration.ts';
import type { BuildInputObserver } from '@apackdev/host/build/pack-inputs';
import { codeBlocks } from './pack-sources.ts';
import { compilerSourcePath, createPackCompilerInputView, type PackCompilerInputView, type createCompilerFileView, type CompilerFileSystem } from '@apackdev/host/build/compiler-inputs';
import { compilerGlobDirectories } from './compiler-source-globs.ts';

import { readCompilerInstallationInputs } from './compiler-installation-inputs.ts';

/** Resolve script/type inputs afresh, including Vue scripts, outside imports and undeclared npm packages. */
export function readCompilerModuleInputs(root: string, observe?: BuildInputObserver, captured?: PackCompilerInputView): {
  hash: string;
  packageDirectories: string[];
  configuration: PackCompilerConfiguration | undefined;
  declarationConfiguration: PackCompilerConfiguration | undefined;
  readBytes(file: string): Buffer | undefined;
  captureFile: ReturnType<typeof createCompilerFileView>['captureFile'];
  captureLocation: ReturnType<typeof createCompilerFileView>['captureLocation'];
  captureDataLocation: ReturnType<typeof createCompilerFileView>['captureDataLocation'];
  readDirectoryData: ReturnType<typeof createCompilerFileView>['readDirectoryData'];
  readDataBytes: ReturnType<typeof createCompilerFileView>['readDataBytes'];
  readMetadata: ReturnType<typeof createCompilerFileView>['readMetadata'];
  openDirectoryData: ReturnType<typeof createCompilerFileView>['openDirectoryData'];
  dispose(): void;
  resolutionDirectory: ReturnType<typeof createCompilerFileView>['resolutionDirectory'];
  fileSystem: CompilerFileSystem;
  ancestors: ReturnType<typeof createCompilerFileView>['ancestors'];
  snapshot: ReturnType<typeof createCompilerFileView>['snapshot'];
  observations: ReturnType<typeof createCompilerFileView>['observations'];
  /** Follow `files`' imports as the authored sources' were followed, capturing what they read */
  traceImports(files: readonly string[]): void;
  assertCurrent(): void;
} {
  const realRoot = fs.realpathSync.native(root);
  const compilerPaths = readCompilerInstallationInputs()?.paths ?? [];
  const sourceRoot = compilerSourcePath(realRoot, compilerPaths);
  const relative = (file: string) => path.relative(sourceRoot, compilerSourcePath(file, compilerPaths)).split(path.sep).join('/');
  const view = captured ?? createPackCompilerInputView(root, { paths: compilerPaths, observe });
  if (view.observations().root !== sourceRoot) throw new Error('Compiler input view belongs to another pack');
  root = realRoot;
  const excluded = view.excluded;
  const readDirectory: ts.System['readDirectory'] = (...args) => ts.sys.readDirectory(...args);
  const fileSystem: CompilerFileSystem = { ...view.fileSystem, readDirectory: (...args) => view.readGlob(readDirectory, ...args) };
  const configuration = readPackCompilerConfiguration(root, { ...ts.sys, ...fileSystem });
  const declarationConfigPath = configuration ? undefined : ts.findConfigFile(root, fileSystem.fileExists);
  const declarationConfiguration = configuration ?? (declarationConfigPath
    ? readPackCompilerConfiguration(path.dirname(declarationConfigPath), { ...ts.sys, ...fileSystem }) : undefined);
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...declarationConfiguration?.options, allowJs: true, noEmit: true,
  };
  const scripts = new Map<string, string>();
  const rootNames: string[] = [];
  const rootFiles = view.authoredFiles;
  for (const relative of rootFiles) {
    const file = path.join(root, relative);
    view.readBytes(file);
    if (/\.[cm]?[jt]sx?$/.test(file)) rootNames.push(file);
    if (!file.endsWith('.vue')) continue;
    const code = fileSystem.readFile(file);
    if (code === undefined) throw new Error(`Compiler source could not be read: ${file}`);
    const component = fileSystem.realpath(file);
    for (const [index, block] of codeBlocks(file, code).entries()) {
      const extension = block.lang === 'ts' || block.lang === 'tsx' || block.lang === 'jsx' ? block.lang : 'js';
      let virtual = `${component}.__script${index}.${extension}`;
      while (fileSystem.fileExists(virtual)) virtual += `.${extension}`;
      // A same-directory virtual root lets TypeScript follow imports with the component's resolution
      // context. It is never written to disk and is not a replacement for Vue's component typechecker.
      scripts.set(virtual, block.src ? `import ${JSON.stringify(block.src)};` : block.content);
      rootNames.push(virtual);
    }
  }
  const packages = new Set<string>();
  const packageCandidates = new Set<string>();
  const packageOf = (file: string) => {
    const parts = path.resolve(file).split(path.sep);
    const modules = parts.lastIndexOf('node_modules');
    if (modules < 0 || !parts[modules + 1]) return;
    const directory = parts.slice(0, modules + (parts[modules + 1]!.startsWith('@') ? 3 : 2)).join(path.sep);
    if (packageCandidates.has(directory)) return;
    packageCandidates.add(directory);
    if (fileSystem.directoryExists(directory)) packages.add(fileSystem.realpath(directory));
  };
  for (const file of declarationConfiguration?.files.keys() ?? []) packageOf(file);
  // Files outside the authored set that `traceImports` was handed, which the host reads like authored ones
  const traced = new Set<string>();
  const hidden = (file: string) => excluded(file) && !traced.has(path.resolve(file));
  const host = ts.createCompilerHost(options);
  const { getSourceFile } = host;
  host.readFile = file => {
    const script = scripts.get(path.resolve(file));
    if (script !== undefined) return script;
    if (hidden(file)) return undefined;
    const text = fileSystem.readFile(file);
    if (text !== undefined) packageOf(file);
    return text;
  };
  host.fileExists = file => {
    if (scripts.has(path.resolve(file))) return true;
    if (hidden(file)) return false;
    return fileSystem.fileExists(file);
  };
  host.directoryExists = fileSystem.directoryExists;
  host.getDirectories = fileSystem.getDirectories;
  host.realpath = fileSystem.realpath;
  host.readDirectory = fileSystem.readDirectory;
  host.getSourceFile = (file, version, onError, fresh) => {
    const script = scripts.get(path.resolve(file));
    if (script !== undefined) return ts.createSourceFile(file, script, version, true);
    return hidden(file) ? undefined : getSourceFile(file, version, onError, fresh);
  };
  const globDirectories = new Set<string>();
  function captureGlobDirectory(directory: string) {
    const physical = fileSystem.realpath(directory);
    if (globDirectories.has(physical)) return;
    globDirectories.add(physical);
    view.resolutionDirectory(directory);
    for (const name of fileSystem.getDirectories(directory)) captureGlobDirectory(path.join(directory, name));
  }
  const traceImports = (names: readonly string[]) => {
    for (const name of names) traced.add(path.resolve(name));
    const program = ts.createProgram({ rootNames: names, options, host });
    for (const source of program.getSourceFiles()) {
      if (scripts.has(path.resolve(source.fileName))) continue;
      packageOf(source.fileName);
      for (const directory of compilerGlobDirectories(source)) captureGlobDirectory(directory);
    }
  };
  traceImports(rootNames);
  const hash = createHash('sha256').update(JSON.stringify(rootFiles)).update(view.hash());
  const assertCurrent = view.assertCurrent;
  assertCurrent();
  return { hash: hash.digest('hex'), configuration, declarationConfiguration, readBytes: view.readBytes, captureFile: view.captureFile,
    captureLocation: view.captureLocation, readDirectoryData: view.readDirectoryData, readDataBytes: view.readDataBytes, readMetadata: view.readMetadata, openDirectoryData: view.openDirectoryData, dispose: view.dispose, resolutionDirectory: view.resolutionDirectory, ancestors: view.ancestors, fileSystem, snapshot: view.snapshot,
    observations: view.observations, captureDataLocation: view.captureDataLocation, traceImports,
    packageDirectories: [...packages].sort((a, b) => relative(a) < relative(b) ? -1 : relative(a) > relative(b) ? 1 : 0), assertCurrent };

}
