import { posix as path } from 'node:path';
import fs from 'node:fs';
import { assertCapturedElfLibraries } from './compiler-elf-libraries.ts';
import { assertElfLaunchEnvironment, captureElfLibraryEnvironment, type CompilerElfEnvironment } from './compiler-elf-environment.ts';
import { findElfCachedLibrary, parseElfLibraryCache } from './compiler-elf-cache.ts';
import { readPeActivationContext, readPeDirectoryEntries, type CompilerPeDirectoryEntry } from './compiler-pe-activation.ts';
import { assertCapturedPeLibraries } from './compiler-pe-admission.ts';
import { capturePeLibraryEnvironment, readPeProcessState, type CompilerPeEnvironment } from './compiler-pe-environment.ts';

interface NativeLibraryCommands {
  dependencies: string[];
  rpaths: string[];
  sdk?: number;
}

export interface MachOLibraryEnvironment {
  readonly libraryPaths: readonly string[];
  readonly fallbackLibraryPaths: readonly string[] | undefined;
  readonly frameworkPaths: readonly string[];
  readonly fallbackFrameworkPaths: readonly string[] | undefined;
  readonly imageSuffixes: readonly string[];
}

export interface CompilerLibraryEnvironment {
  readonly macho: MachOLibraryEnvironment;
  readonly elf?: CompilerElfEnvironment;
  readonly pe?: CompilerPeEnvironment;
}

export function captureCompilerLibraryEnvironment(env: NodeJS.ProcessEnv = process.env): CompilerLibraryEnvironment {
  return Object.freeze({ macho: captureMachOLibraryEnvironment(env),
    elf: process.platform === 'linux' ? captureElfLibraryEnvironment(env) : undefined,
    pe: process.platform === 'win32' ? capturePeLibraryEnvironment() : undefined });
}

export function assertCapturedCompilerLibraries(entry: string, packageRoot: string, input: {
  read(file: string): Buffer | undefined;
  directoryExists(file: string): boolean;
  readEntries(file: string): readonly CompilerPeDirectoryEntry[] | undefined;
  realpath(file: string): string;
  arch: string;
  environment: CompilerLibraryEnvironment;
}): void {
  if (process.platform === 'darwin') return assertCapturedMachOLibraries(entry, packageRoot, { ...input, environment: input.environment.macho });
  if (process.platform === 'win32') {
    const environment = input.environment.pe;
    if (!environment) throw new Error('Compiler PE library admission requires OS loader metadata');
    const state = readPeProcessState(environment.systemDirectory);
    return assertCapturedPeLibraries(entry, packageRoot, { ...input, environment, executable: process.execPath,
      cwd: process.cwd(), variables: state.environment, loadedLibraries: state.libraries,
      moduleContext: (image, observe) => readPeActivationContext(image, { systemDirectory: environment.systemDirectory, application: process.execPath, resource: 2, observe }) });
  }
  if (process.platform !== 'linux') return;
  const environment = input.environment.elf;
  if (!environment) throw new Error('Compiler ELF library admission requires launch-time loader metadata');
  input.read(environment.loader);
  input.read('/etc/ld.so.preload');
  let cache: ReturnType<typeof parseElfLibraryCache> | undefined;
  assertCapturedElfLibraries(entry, packageRoot, { ...input, environment,
    cachedLibrary(name, machine) {
      if (!cache) {
        const bytes = input.read('/etc/ld.so.cache');
        cache = bytes === undefined ? [] : parseElfLibraryCache(bytes, environment.littleEndian);
      }
      return findElfCachedLibrary(cache, name, machine, environment.hardwareCapabilities, environment.isaLevels);
    },
    loadedLibrary: name => environment.loadedLibraries.find(library => library.name === name)?.file,
  });
}

/** A new runtime resolves its linked libraries before JS; it cannot reuse the parent's loaded images. */
export function assertCompilerRuntimeLibraries(executable: string, runtimeDirectory: string, env: NodeJS.ProcessEnv, cwd: string): void {
  const input = {
    arch: process.arch,
    readEntries: readPeDirectoryEntries,
    directoryExists: (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false,
    realpath: (file: string) => fs.realpathSync.native(file),
    read: (file: string) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : undefined,
  };
  if (process.platform === 'darwin') {
    return assertCapturedMachOLibraries(executable, runtimeDirectory, {
      ...input, executable, cwd, environment: captureMachOLibraryEnvironment(env),
    });
  }
  if (process.platform === 'win32') {
    const environment = capturePeLibraryEnvironment(executable);
    return assertCapturedPeLibraries(executable, runtimeDirectory, {
      ...input, environment, executable, cwd, variables: env, loadedLibraries: [],
      moduleContext: (image, observe) => readPeActivationContext(image, { systemDirectory: environment.systemDirectory, application: executable, resource: 2, observe }),
    });
  }
  if (process.platform !== 'linux') return;
  const elf = captureElfLibraryEnvironment(env, executable, cwd);
  assertCapturedCompilerLibraries(executable, runtimeDirectory, {
    ...input, environment: { macho: captureMachOLibraryEnvironment(env), elf: { ...elf, loadedLibraries: [] } },
  });
}

/** dyld reads these settings at process launch, before user preloads can change process.env. */
export function captureMachOLibraryEnvironment(env: NodeJS.ProcessEnv = process.env): MachOLibraryEnvironment {
  const paths = (name: string) => Object.freeze(env[name] ? env[name].split(':') : []);
  return Object.freeze({
    libraryPaths: paths('DYLD_LIBRARY_PATH'),
    fallbackLibraryPaths: env.DYLD_FALLBACK_LIBRARY_PATH === undefined ? undefined : paths('DYLD_FALLBACK_LIBRARY_PATH'),
    frameworkPaths: paths('DYLD_FRAMEWORK_PATH'),
    fallbackFrameworkPaths: env.DYLD_FALLBACK_FRAMEWORK_PATH === undefined ? undefined : paths('DYLD_FALLBACK_FRAMEWORK_PATH'),
    imageSuffixes: paths('DYLD_IMAGE_SUFFIX'),
  });
}

const systemLibrary = (file: string) => file.startsWith('/usr/lib/') || file.startsWith('/System/Library/');

/** Launch-time overrides run outside JS admission; non-OS libraries must use captured package paths. */
export function assertCompilerLibraryEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (process.platform === 'linux') return assertElfLaunchEnvironment(env);
  if (process.platform !== 'darwin') return;
  for (const variable of ['DYLD_VERSIONED_LIBRARY_PATH', 'DYLD_VERSIONED_FRAMEWORK_PATH', 'DYLD_SHARED_CACHE_DIR'] as const) {
    const value = env[variable];
    if (!value) continue;
    for (const directory of variable === 'DYLD_SHARED_CACHE_DIR' ? [value] : value.split(':')) {
      const normalized = path.resolve(directory);
      const physical = path.isAbsolute(directory) && systemLibrary(normalized + '/')
        && fs.statSync(normalized, { throwIfNoEntry: false })?.isDirectory() ? fs.realpathSync(normalized) : undefined;
      if (!physical || !systemLibrary(physical + '/')) {
        throw new Error(`Cannot launch captured compiler: ${variable} references directory "${directory}" outside operating-system libraries. Native overrides are selected before compiler startup; use captured package-relative libraries instead.`);
      }
    }
  }
  for (const library of env.DYLD_INSERT_LIBRARIES?.split(':').filter(Boolean) ?? []) {
    if (!path.isAbsolute(library) || !systemLibrary(path.normalize(library))) {
      throw new Error(`Cannot launch captured compiler: DYLD_INSERT_LIBRARIES references "${library}" outside its captured installation. Use operating-system libraries or load package libraries through captured compiler modules.`);
    }
    assertCapturedMachOLibraries(library, path.dirname(library), { arch: process.arch,
      environment: captureMachOLibraryEnvironment(env), realpath: file => fs.realpathSync(file),
      read: file => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : undefined,
    });
  }
}

/** Inspect dependency commands, never LC_ID_DYLIB or executable code. */
export function parseMachOLibraryCommands(bytes: Buffer, arch: string): NativeLibraryCommands {
  const invalid = () => new Error('Invalid Mach-O native library commands');
  if (bytes.length < 4) throw invalid();
  const magic = bytes.readUInt32BE(0);
  if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) {
    const little = magic === 0xbebafeca || magic === 0xbfbafeca;
    const wide = magic === 0xcafebabf || magic === 0xbfbafeca;
    const uint = (offset: number) => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    if (bytes.length < 8) throw invalid();
    const count = uint(4), size = wide ? 32 : 20;
    if (count > (bytes.length - 8) / size) throw invalid();
    const cpu = arch === 'arm64' ? 0x100000c : arch === 'x64' ? 0x1000007 : undefined;
    for (let i = 0; i < count; i++) {
      const entry = 8 + i * size;
      if (uint(entry) !== cpu) continue;
      const offset = wide ? Number(little ? bytes.readBigUInt64LE(entry + 8) : bytes.readBigUInt64BE(entry + 8)) : uint(entry + 8);
      const length = wide ? Number(little ? bytes.readBigUInt64LE(entry + 16) : bytes.readBigUInt64BE(entry + 16)) : uint(entry + 12);
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length < 4 || offset < 8 + count * size || offset + length > bytes.length) throw invalid();
      return parseMachOLibraryCommands(bytes.subarray(offset, offset + length), arch);
    }
    throw new Error(`Native library has no Mach-O slice for ${arch}`);
  }
  const little = magic === 0xcefaedfe || magic === 0xcffaedfe;
  const wide = magic === 0xfeedfacf || magic === 0xcffaedfe;
  if (![0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) throw invalid();
  const uint = (offset: number) => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const header = wide ? 32 : 28;
  if (bytes.length < header) throw invalid();
  const count = uint(16), end = header + uint(20);
  if (end > bytes.length || count > (end - header) / 8) throw invalid();
  const result: NativeLibraryCommands = { dependencies: [], rpaths: [] };
  let cursor = header;
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > end) throw invalid();
    const command = uint(cursor) & 0x7fffffff, size = uint(cursor + 4);
    if (size < 8 || cursor + size > end) throw invalid();
    if (command === 0x24 || command === 0x32) {
      if (size < (command === 0x24 ? 16 : 24)) throw invalid();
      if (command === 0x24 || uint(cursor + 8) === 1) result.sdk = uint(cursor + (command === 0x24 ? 12 : 16));
    }
    const target = command === 0x1c ? result.rpaths
      : [0xc, 0x18, 0x1f, 0x20, 0x23].includes(command) ? result.dependencies : undefined;
    if (target) {
      const minimum = command === 0x1c ? 12 : 24;
      if (size < minimum) throw invalid();
      const start = uint(cursor + 8);
      if (start < minimum || start >= size) throw invalid();
      const zero = bytes.indexOf(0, cursor + start);
      if (zero < 0 || zero >= cursor + size) throw invalid();
      target.push(bytes.toString('utf8', cursor + start, zero));
    }
    cursor += size;
  }
  if (cursor !== end) throw invalid();
  return result;
}

/** Refuse identifiable escapes; this is not confinement of native I/O or computed dlopen calls. */
export function assertCapturedMachOLibraries(entry: string, packageRoot: string, input: {
  read(file: string): Buffer | undefined;
  realpath(file: string): string;
  arch: string;
  environment?: MachOLibraryEnvironment;
  executable?: string;
  cwd?: string;
}) {
  const within = (file: string, root = packageRoot) => {
    const relative = path.relative(root, file);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  const environment = input.environment ?? captureMachOLibraryEnvironment();
  const executable = input.executable ?? process.execPath, cwd = input.cwd ?? process.cwd();
  // dyld inserts each suffix before the leaf's last dot, then tries the unsuffixed path.
  const variants = (file: string) => {
    const dot = file.lastIndexOf('.');
    const at = dot > file.lastIndexOf('/') ? dot : file.length;
    return [...environment.imageSuffixes.map(suffix => file.slice(0, at) + suffix + file.slice(at)), file];
  };
  const search = (reference: string, requester: string, fallback = false, sdk = 0) => {
    const framework = reference.match(/(?:^|\/)(([^/]+)\.framework\/(?:Versions\/[^/]+\/)?\2)$/)?.[1];
    // dyld's standard fallbacks apply to pre-macOS-14 SDK images. An explicitly empty
    // fallback variable suppresses them; an absent variable selects the standard list.
    const defaults = sdk < 0xe0000 ? framework
      ? ['/Library/Frameworks', '/System/Library/Frameworks'] : ['/usr/local/lib', '/usr/lib'] : [];
    const fallbackPaths = framework ? environment.fallbackFrameworkPaths : environment.fallbackLibraryPaths;
    const directories = fallback ? fallbackPaths ?? defaults : framework ? environment.frameworkPaths : environment.libraryPaths;
    const variable = fallback && fallbackPaths === undefined ? `standard ${framework ? 'framework' : 'library'} fallback` : framework
      ? fallback ? 'DYLD_FALLBACK_FRAMEWORK_PATH' : 'DYLD_FRAMEWORK_PATH'
      : fallback ? 'DYLD_FALLBACK_LIBRARY_PATH' : 'DYLD_LIBRARY_PATH';
    const candidates = directories.flatMap(directory => variants(path.resolve(cwd, `${directory}/${framework ?? path.basename(reference)}`)));
    for (const file of candidates) {
      const candidate = path.normalize(file);
      if (input.read(candidate) === undefined) continue;
      if (systemLibrary(candidate) && systemLibrary(input.realpath(candidate))) return true;
      throw new Error(`Native compiler image "${requester}" selects "${candidate}" through ${variable} outside its captured package. Use package-relative native libraries or operating-system libraries.`);
    }
    return false;
  };
  // dyld expands @loader_path from where an image really is: a framework's top-level binary is a symlink into
  // Versions/<v>, and the framework's rpaths are written from there (Electron's reach its sibling frameworks
  // through @loader_path/../../..). Rebased onto the package as the caller spells it, so the checks below
  // compare paths in one namespace; an image whose real home is outside keeps that outside directory
  const loaderDirectory = (file: string) => {
    const real = path.dirname(input.realpath(file)), realRoot = input.realpath(packageRoot);
    return within(real, realRoot) ? path.resolve(packageRoot, path.relative(realRoot, real)) : real;
  };
  const visited = new Set<string>();
  function inspect(file: string, inherited: readonly { reference: string; expanded: string }[]) {
    if (visited.has(file)) return true;
    const bytes = input.read(file);
    if (!bytes) return false;
    visited.add(file); // The operating-system loader supplies missing-library diagnostics.
    let commands: NativeLibraryCommands;
    try { commands = parseMachOLibraryCommands(bytes, input.arch); }
    catch (error) { throw new Error(`Cannot inspect native compiler image "${file}"`, { cause: error }); }
    const refuse = (reference: string): never => {
      throw new Error(`Native compiler image "${file}" references "${reference}" outside its captured package. Use package-relative native libraries or operating-system libraries.`);
    };
    const expand = (reference: string): string | undefined => {
      if (reference.startsWith('@loader_path/')) return path.resolve(loaderDirectory(file), reference.slice(13));
      if (reference.startsWith('@executable_path/')) return path.resolve(path.dirname(executable), reference.slice(17));
      if (path.isAbsolute(reference)) return path.resolve(reference);
    };
    const rpaths = [...commands.rpaths.flatMap(reference => {
      const expanded = expand(reference);
      return expanded ? [{ reference, expanded }] : [];
    }), ...inherited];
    for (const reference of commands.dependencies) {
      if (search(reference, file)) continue;
      if (path.isAbsolute(reference)) {
        if (!systemLibrary(path.resolve(reference))) refuse(reference);
        continue;
      }
      if (!reference.startsWith('@') && reference.includes('/')) refuse(reference);
      const bare = !reference.startsWith('@');
      const candidates = variants(reference).flatMap<{ file: string | undefined; search: string | undefined }>(variant => variant.startsWith('@rpath/')
        ? rpaths.map(({ reference: search, expanded }) => ({ file: path.resolve(expanded, variant.slice(7)), search }))
        : [{ file: bare ? path.resolve(cwd, variant) : expand(variant), search: undefined }]);
      let found = false;
      for (const { file: candidate, search } of candidates) {
        if (!candidate || (bare && input.read(candidate) === undefined)) continue;
        if (systemLibrary(candidate)) { found = true; break; }
        if (search && path.isAbsolute(search)) refuse(search);
        if (!within(candidate)) refuse(reference);
        if (input.read(candidate) === undefined) continue;
        if (!within(input.realpath(candidate), input.realpath(packageRoot))) refuse(reference);
        if (inspect(candidate, rpaths)) { found = true; break; }
      }
      if (!found) search(reference, file, true, commands.sdk);
    }
    return true;
  }
  const mainExecutable = entry === executable;
  if (mainExecutable || !search(entry, entry)) {
    for (const candidate of (mainExecutable ? [entry] : variants(entry)).map(file => path.normalize(file))) {
      if (input.read(candidate) === undefined) continue;
      if (!systemLibrary(candidate) && (!within(candidate) || !within(input.realpath(candidate), input.realpath(packageRoot)))) {
        throw new Error(`Native compiler image "${entry}" selects "${candidate}" outside its captured package. Use package-relative native libraries or operating-system libraries.`);
      }
      inspect(candidate, []);
      break;
    }
  }
}
