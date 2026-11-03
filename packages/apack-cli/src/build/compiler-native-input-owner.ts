import fs from 'node:fs';
import path from 'node:path';
import { beginCompilerNativeModules, compilerDiagnostic, compilerSourcePath, relativeCompilerPath, withoutCompilerFileReads,
  type createCompilerFileView } from '@apackdev/host/build/compiler-inputs';
import { captureCompilerPackage } from './compiler-package-inputs.ts';
import { assertCapturedCompilerLibraries, type CompilerLibraryEnvironment } from './compiler-native-libraries.ts';
import { createCompilerReadTree, type CompilerReadTree } from './compiler-read-tree.ts';
import { readPeDirectoryEntries } from './compiler-pe-activation.ts';
import { isCompilerLocationPath, isOwnedCompilerPath, type CompilerInstallationInputs } from './compiler-installation-inputs.ts';

export interface CapturedNativeModule { readonly source: string; readonly captured: string; readonly packageRoot: string }

/** Owned native bytes; Vite captures selected images so authored sources remain live. */
export function createCompilerNativeInputs(original: ReturnType<typeof createCompilerFileView>, workspace: string,
  compiler: Pick<CompilerInstallationInputs, 'directory' | 'paths'>, nativeEnvironment: CompilerLibraryEnvironment, options: {
    capture: 'package' | 'images';
    findModule?(file: string): CapturedNativeModule | undefined;
    onCapture?(): void;
  }) {
  const { paths } = compiler;
  const modules = new Map<string, CapturedNativeModule>();
  const packRoot = original.observations().root;
  const within = (parent: string, file: string) => {
    const relative = relativeCompilerPath(parent, file);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  const includes = (file: string) => !isOwnedCompilerPath(file, workspace, compiler.directory)
    && !isCompilerLocationPath(file, compiler.directory, packRoot);
  let tree: CompilerReadTree | undefined;
  const sourcePath = (file: string) => tree?.sourcePath(file) ?? compilerSourcePath(file, paths);
  const executable = nativeEnvironment.elf?.executable;
  const ownedExecutable = executable && isOwnedCompilerPath(executable, compiler.directory) ? executable : undefined;
  const ownExecutableAlias = `/proc/${process.pid}/exe`;
  const readDataPath = (file: string) => withoutCompilerFileReads(() => {
    // libc detection reads its own ELF header through procfs. Those bytes already belong to
    // the captured runtime; recording the resolved PID would make its receipt expire on exit.
    if (ownedExecutable && (file === '/proc/self/exe' || file === ownExecutableAlias)) return ownedExecutable;
    if (!includes(file)) return file;
    file = sourcePath(file);
    // Node's package metadata reader bypasses fs wrappers. Observe enclosing declarations,
    // including absent nearer scopes, without resolving or rewriting module requests.
    for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
      const metadata = path.join(directory, 'package.json');
      if (includes(metadata)) original.readDataBytes(metadata);
      if (path.dirname(directory) === directory) break;
    }
    const bytes = original.readDataBytes(file);
    const location = original.captureLocation(file, 'file');
    tree ??= createCompilerReadTree({ files: [], locations: [], links: [] }, paths);
    tree.includeData({ files: bytes === undefined ? [] : [original.captureFile(file, bytes)],
      locations: [...(location ? [location] : []), ...original.ancestors(file)], links: [] });
    return tree.dataPath(file);
  });
  const readEntries = (file: string) => {
    if (includes(file) && sourcePath(file) === file) {
      original.captureDataLocation(file, 'entries');
      original.fileSystem.getDirectories(file);
      const entries = readPeDirectoryEntries(file);
      if (entries) readDataPath(file);
      return entries;
    }
    return readPeDirectoryEntries(file);
  };
  const nativePackages = new Set<string>();
  const packageRoot = (file: string, exists: (file: string) => boolean) => {
    for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
      if (exists(path.join(directory, 'package.json'))) return directory;
      if (path.dirname(directory) === directory) return path.dirname(file);
    }
  };
  const nativeModule = (file: string): string => {
    if (process.platform !== 'darwin' && process.platform !== 'linux' && process.platform !== 'win32') return file;
    const known = options.findModule?.(file);
    if (known) {
      assertCapturedCompilerLibraries(known.captured, known.packageRoot, {
        readEntries,
        directoryExists: file => fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false,
        arch: process.arch, environment: nativeEnvironment, realpath: file => fs.realpathSync.native(file),
        read: file => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : undefined,
      });
      return known.captured;
    }
    // Compiler-installation and earlier read-tree copies already have an input owner. Inspect their
    // actual images without recording ephemeral private paths as new source inputs.
    if (!includes(file) || sourcePath(file) !== file) {
      assertCapturedCompilerLibraries(file, packageRoot(file, fs.existsSync), {
        readEntries,
        directoryExists: file => includes(file) && sourcePath(file) === file
          ? original.captureDataLocation(file, 'directory')?.kind === 'directory'
          : fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false,
        arch: process.arch, environment: nativeEnvironment,
        realpath: file => fs.realpathSync.native(file),
        read: file => includes(file) && sourcePath(file) === file ? original.readDataBytes(file)
          : fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : undefined,
      });
      return file;
    }
    const owner = packageRoot(file, original.fileSystem.fileExists);
    // The authored pack already has an input owner, including codegen's later admission of
    // generated files. Whole-package capture is for dependencies, whose output is immutable here.
    const capturePackage = options.capture === 'package' && relativeCompilerPath(packRoot, owner) !== '';
    if (capturePackage && !nativePackages.has(owner)) {
      const { snapshot } = captureCompilerPackage(owner, original.captureDataLocation, (file, bytes) =>
        original.captureFile(file.source, original.readDataBytes(file.source) ?? bytes));
      tree ??= createCompilerReadTree({ files: [], locations: [], links: [] }, paths);
      tree.includeData(snapshot);
      nativePackages.add(owner);
    }
    assertCapturedCompilerLibraries(file, owner, {
      readEntries,
      directoryExists: file => !includes(file) || sourcePath(file) !== file
        ? fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false
        : original.captureDataLocation(file, 'directory')?.kind === 'directory',
      arch: process.arch, environment: nativeEnvironment, realpath: original.fileSystem.realpath,
      read(candidate) {
        if (!includes(candidate) || sourcePath(candidate) !== candidate) {
          return fs.statSync(candidate, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(candidate) : undefined;
        }
        const bytes = original.readDataBytes(candidate);
        if (!capturePackage && bytes && within(owner, candidate)) readDataPath(candidate);
        return bytes;
      },
    });
    const captured = readDataPath(file);
    modules.set(file, { source: file, captured, packageRoot: tree!.dataPath(owner) });
    return captured;
  };
  const admit = (file: string) => {
    try { return nativeModule(file); }
    finally { options.onCapture?.(); }
  };
  const stopNativeModules = beginCompilerNativeModules(admit);
  return {
    includes, sourcePath, readDataPath, nativeModule: admit,
    modules: () => [...modules.values()], copies: () => tree?.observations(),
    diagnostic: (message: string) => compilerDiagnostic(tree?.diagnostic(message) ?? message, paths),
    assertCurrent() { withoutCompilerFileReads(() => { original.assertCurrent(); tree?.assertCurrent(); }); },
    dispose() {
      withoutCompilerFileReads(() => {
        stopNativeModules();
        try { original.dispose(); } finally { tree?.dispose(); }
      });
    },
  };
}
