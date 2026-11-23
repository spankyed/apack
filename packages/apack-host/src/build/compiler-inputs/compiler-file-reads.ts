import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import module, { syncBuiltinESMExports, type ResolveHookContext } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isInternalThread } from 'node:worker_threads';
import { openCapturedDirectory } from './compiler-directories.ts';
import { capturedDescriptor, descriptorStats, releaseDescriptor, instrumentFileHandle, rememberDescriptor } from './compiler-descriptors.ts';
import { compilerMetadataOperations, type CompilerMetadataKind } from './compiler-metadata.ts';
import type { CompilerDirectoryCursor } from './compiler-directories.ts';
import type { CompilerDirectoryResult } from './compiler-file-view.ts';
import { observeCompilerModuleResolution } from './compiler-module-probes.ts';
import { parseNodeOptions } from '../node-options.js';

/** Filesystem interception is usable before compiler configuration or module activation. */
export interface CompilerFileReadInputs {
  isInput(file: string): boolean;
  readDataPath(file: string): string;
  readMetadata(kind: CompilerMetadataKind, file: string, args: readonly unknown[]): unknown;
  readDirectory(file: string, options: unknown): CompilerDirectoryResult;
  openDirectory(file: string, options: unknown): CompilerDirectoryCursor;
  sourcePath(file: string): string;
  diagnostic(message: string): string;
  requireParent(file: string): string;
  /** Executable scopes own native images; filesystem-only query scopes defer to startup ownership. */
  nativeModule?(file: string): string;
}

interface CompilerFileReadScope {
  compilation: CompilerFileReadInputs;
  outputDirectory?: string;
  asyncLoader?: string;
}

interface CompilerReadState {
  readonly scopes: AsyncLocalStorage<CompilerFileReadScope | null>;
  startup?: CompilerFileReadScope;
  nativeModule?: (file: string) => string;
  observeResolution?: (specifier: string, context: ResolveHookContext) => void;
  installed: boolean;
}
// The native bootstrap and ESM compiler bundle must share interception, including cached preload APIs.
const READS = Symbol.for('apack.compiler.file-reads');
const state: CompilerReadState = Reflect.get(globalThis, READS) ?? {
  scopes: new AsyncLocalStorage<CompilerFileReadScope | null>(), installed: false,
};
if (!Reflect.has(globalThis, READS)) Object.defineProperty(globalThis, READS, { value: state });
const scopes = state.scopes;
const currentScope = () => {
  const scope = scopes.getStore();
  return scope === undefined ? state.startup : scope ?? undefined;
};

function readScope(file: fs.PathOrFileDescriptor) {
  const scope = currentScope();
  if (!scope || (typeof file !== 'string' && !(file instanceof URL) && !Buffer.isBuffer(file))) return;
  const absolute = path.resolve(file instanceof URL ? fileURLToPath(file) : file.toString());
  if (!scope.compilation.isInput(absolute)) return;
  if (scope.outputDirectory) {
    const relative = path.relative(scope.outputDirectory, absolute);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  }
  return { scope, absolute };
}

function readPath(file: fs.PathOrFileDescriptor): fs.PathOrFileDescriptor {
  const input = readScope(file);
  // Capture itself reads the original filesystem; those internal reads must not re-enter the adapter.
  return input ? withoutCompilerFileReads(() => input.scope.compilation.readDataPath(input.absolute)) : file;
}

function sourceError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const scope = currentScope();
  if (!scope) return error;
  error.message = scope.compilation.diagnostic(error.message);
  if ('path' in error && typeof error.path === 'string') {
    const source = scope.compilation.sourcePath(error.path);
    error.message = error.message.split(error.path).join(source);
    Object.assign(error, { path: source });
  }
  return error;
}

function readOnly(flags: unknown): boolean {
  if (flags === undefined) return true;
  if (typeof flags === 'string') return ['r', 'rs', 'sr'].includes(flags);
  const mutating = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;
  return typeof flags === 'number' && (flags & mutating) === 0;
}

function callbackRead<T extends (...args: never[]) => unknown>(operation: T,
  file: fs.PathOrFileDescriptor, args: unknown[], capture = true, opened?: (fd: number) => void): unknown {
  const callback = args.pop();
  if (typeof callback !== 'function') return Reflect.apply(operation, fs, [file, ...args, callback]);
  let captured: fs.PathOrFileDescriptor;
  try { captured = capture ? readPath(file) : file; }
  catch (error) { queueMicrotask(() => callback(sourceError(error))); return; }
  return Reflect.apply(operation, fs, [captured, ...args,
    (error: unknown, data: unknown) => {
      if (!error && opened) {
        try { opened(data as number); }
        catch (error) { callback(sourceError(error)); return; }
      }
      callback(error ? sourceError(error) : null, data);
    }]);
}

function metadataRead(kind: CompilerMetadataKind, file: fs.PathLike, args: readonly unknown[]) {
  const input = readScope(file);
  return input
    ? withoutCompilerFileReads(() => input.scope.compilation.readMetadata(kind, input.absolute, args))
    : Reflect.apply(compilerMetadataOperations[kind].sync, fs, [file, ...args]);
}

function metadataSync(kind: CompilerMetadataKind) {
  return (file: fs.PathLike, ...args: unknown[]) => {
    try { return metadataRead(kind, file, args); }
    catch (error) { throw sourceError(error); }
  };
}

function metadataCallback(kind: CompilerMetadataKind) {
  return (file: fs.PathLike, ...args: unknown[]) => {
    const callback = args.pop();
    if (!currentScope() || typeof callback !== 'function') {
      return Reflect.apply(compilerMetadataOperations[kind].callback!, fs, [file, ...args, callback]);
    }
    try {
      const value = metadataRead(kind, file, args);
      queueMicrotask(() => callback(null, value));
    } catch (error) { queueMicrotask(() => callback(sourceError(error))); }
  };
}

function descriptorInput(file: fs.PathLike, flags: unknown) {
  const input = readOnly(flags) ? readScope(file) : undefined;
  return input && { readStats: (args: readonly unknown[]) =>
    withoutCompilerFileReads(() => input.scope.compilation.readMetadata('stat', input.absolute, args)) };
}

function capturedDirectory(file: fs.PathLike, options: unknown) {
  const input = readScope(file);
  if (!input) return;
  return withoutCompilerFileReads(() => {
    const cursor = input.scope.compilation.openDirectory(input.absolute, options);
    return openCapturedDirectory(input.scope.compilation.readDataPath(input.absolute), input.absolute, file, options, index => withoutCompilerFileReads(() => cursor.read(index)));
  });
}

function install() {
  if (state.installed) return;
  state.installed = true;
  const dlopen = process.dlopen;
  // Node selects default flags by argument count; explicit undefined is a different native call.
  process.dlopen = (module, filename, ...flags) => {
    const scope = currentScope();
    try {
      const target = withoutCompilerFileReads(() => scope?.compilation.nativeModule?.(filename)
        ?? state.nativeModule?.(filename) ?? filename);
      return Reflect.apply(dlopen, process, [module, target, ...flags]);
    } catch (error) { throw sourceError(error); }
  };
  const readSync = fs.readFileSync, read = fs.readFile, readPromise = fs.promises.readFile;
  fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
    try { return Reflect.apply(readSync, fs, [readPath(file), ...args]); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.readFileSync;
  fs.readFile = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => callbackRead(read, file, args)) as typeof fs.readFile;
  fs.promises.readFile = (async (file: fs.PathLike | fs.promises.FileHandle, ...args: unknown[]) => {
    // A FileHandle already owns its descriptor; its lifetime belongs to the opening operation.
    if (typeof file === 'object' && !(file instanceof URL) && !Buffer.isBuffer(file)) return Reflect.apply(readPromise, fs.promises, [file, ...args]);
    try { return await Reflect.apply(readPromise, fs.promises, [readPath(file), ...args]); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.promises.readFile;
  const openSync = fs.openSync, open = fs.open, openPromise = fs.promises.open;
  fs.openSync = ((file: fs.PathLike, flags: fs.OpenMode, ...args: unknown[]) => {
    try {
      const owner = descriptorInput(file, flags);
      const fd = Reflect.apply(openSync, fs, [readOnly(flags) ? readPath(file) : file, flags, ...args]);
      rememberDescriptor(fd, owner);
      return fd;
    } catch (error) { throw sourceError(error); }
  }) as typeof fs.openSync;
  fs.open = ((file: fs.PathLike, ...args: unknown[]) => {
    const flags = typeof args[0] === 'function' ? undefined : args[0];
    const owner = descriptorInput(file, flags);
    return callbackRead(open, file, args, readOnly(flags), fd => rememberDescriptor(fd, owner));
  }) as typeof fs.open;
  fs.promises.open = (async (file, flags, ...args) => {
    try {
      const owner = descriptorInput(file, flags);
      const handle = await Reflect.apply(openPromise, fs.promises, [readOnly(flags) ? readPath(file) : file, flags, ...args]);
      rememberDescriptor(handle.fd, owner);
      return owner ? instrumentFileHandle(handle) : handle;
    } catch (error) { throw sourceError(error); }
  }) as typeof fs.promises.open;
  const fstatSync = fs.fstatSync, fstat = fs.fstat, closeSync = fs.closeSync, close = fs.close;
  fs.fstatSync = ((fd: number, ...args: unknown[]) => {
    const captured = capturedDescriptor(fd);
    try { return descriptorStats(fd, Reflect.apply(fstatSync, fs, [fd, ...args]), args, captured); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EBADF') releaseDescriptor(fd, captured); throw sourceError(error); }
  }) as typeof fs.fstatSync;
  fs.fstat = ((fd: number, ...args: unknown[]) => {
    const callback = args.pop(), captured = capturedDescriptor(fd);
    if (typeof callback !== 'function') return Reflect.apply(fstat, fs, [fd, ...args, callback]);
    return Reflect.apply(fstat, fs, [fd, ...args, (error: NodeJS.ErrnoException | null, actual: fs.Stats | fs.BigIntStats) => {
      if (error) {
        if (error.code === 'EBADF') releaseDescriptor(fd, captured);
        callback(sourceError(error));
      } else {
        let value: unknown;
        try { value = descriptorStats(fd, actual, args, captured); }
        catch (error) { callback(sourceError(error)); return; }
        callback(null, value);
      }
    }]);
  }) as typeof fs.fstat;
  fs.closeSync = (fd => { const captured = capturedDescriptor(fd); closeSync(fd); releaseDescriptor(fd, captured); }) as typeof fs.closeSync;
  fs.close = ((fd: number, callback: (error: NodeJS.ErrnoException | null) => void) => {
    const captured = capturedDescriptor(fd);
    if (typeof callback !== 'function') return close(fd, callback);
    return close(fd, error => { if (!error || error.code === 'EBADF') releaseDescriptor(fd, captured); callback(error); });
  }) as typeof fs.close;
  const readdirSync = fs.readdirSync, readdir = fs.readdir, readdirPromise = fs.promises.readdir;
  fs.readdirSync = ((file: fs.PathLike, options: unknown) => {
    const input = readScope(file);
    if (!input) return Reflect.apply(readdirSync, fs, [file, options]);
    try { return withoutCompilerFileReads(() => input.scope.compilation.readDirectory(input.absolute, options)); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.readdirSync;
  fs.readdir = ((file: fs.PathLike, ...args: unknown[]) => {
    const callback = args.pop();
    const input = readScope(file);
    if (!input || typeof callback !== 'function') return Reflect.apply(readdir, fs, [file, ...args, callback]);
    try {
      const result = withoutCompilerFileReads(() => input.scope.compilation.readDirectory(input.absolute, args[0]));
      queueMicrotask(() => callback(null, result));
    } catch (error) { queueMicrotask(() => callback(sourceError(error))); }
  }) as typeof fs.readdir;
  fs.promises.readdir = (async (file, options) => {
    const input = readScope(file);
    if (!input) return Reflect.apply(readdirPromise, fs.promises, [file, options]);
    try { return withoutCompilerFileReads(() => input.scope.compilation.readDirectory(input.absolute, options)); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.promises.readdir;
  const opendirSync = fs.opendirSync, opendir = fs.opendir, opendirPromise = fs.promises.opendir;
  fs.opendirSync = ((file: fs.PathLike, options: unknown) => {
    try { return capturedDirectory(file, options) ?? Reflect.apply(opendirSync, fs, [file, options]); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.opendirSync;
  fs.opendir = ((file: fs.PathLike, ...args: unknown[]) => {
    const callback = args.pop();
    if (!currentScope() || typeof callback !== 'function') return Reflect.apply(opendir, fs, [file, ...args, callback]);
    try {
      const directory = capturedDirectory(file, args[0]);
      if (!directory) return Reflect.apply(opendir, fs, [file, ...args, callback]);
      queueMicrotask(() => callback(null, directory));
    } catch (error) { queueMicrotask(() => callback(sourceError(error))); }
  }) as typeof fs.opendir;
  fs.promises.opendir = (async (file, options) => {
    try { return capturedDirectory(file, options) ?? await Reflect.apply(opendirPromise, fs.promises, [file, options]); }
    catch (error) { throw sourceError(error); }
  }) as typeof fs.promises.opendir;
  const builtins = fs as unknown as Record<string, unknown>;
  const promises = fs.promises as unknown as Record<string, unknown>;
  for (const kind of ['stat', 'lstat', 'realpath', 'readlink', 'access'] as const) {
    builtins[`${kind}Sync`] = metadataSync(kind);
    builtins[kind] = metadataCallback(kind);
    promises[kind] = async (file: fs.PathLike, ...args: unknown[]) => {
      if (!currentScope()) return Reflect.apply(compilerMetadataOperations[kind].promise!, fs.promises, [file, ...args]);
      try { return metadataRead(kind, file, args); }
      catch (error) { throw sourceError(error); }
    };
  }
  fs.realpathSync.native = metadataSync('realpathNative') as typeof fs.realpathSync.native;
  fs.realpath.native = metadataCallback('realpathNative') as typeof fs.realpath.native;
  const exists = compilerMetadataOperations.exists.sync;
  fs.existsSync = ((file: fs.PathLike) => {
    try { return metadataRead('exists', file, []); }
    catch (error) {
      if (error instanceof TypeError) return Reflect.apply(exists, fs, [file]);
      throw sourceError(error);
    }
  }) as typeof fs.existsSync;
  const existsCallback = fs.exists;
  const capturedExists = ((file: fs.PathLike, callback: (exists: boolean) => void) => {
    if (!currentScope() || typeof callback !== 'function') return existsCallback(file, callback);
    const value = fs.existsSync(file);
    queueMicrotask(() => callback(value));
  }) as typeof fs.exists;
  for (const key of Object.getOwnPropertySymbols(existsCallback)) {
    Object.defineProperty(capturedExists, key, Object.getOwnPropertyDescriptor(existsCallback, key)!);
  }
  fs.exists = capturedExists;
  const createRequire = module.createRequire;
  module.createRequire = (filename => {
    const scope = currentScope();
    if (!scope) return createRequire(filename);
    const url = filename instanceof URL ? filename : typeof filename === 'string' && filename.startsWith('file:') ? new URL(filename) : undefined;
    if (url ? url.protocol !== 'file:' : typeof filename !== 'string' || !path.isAbsolute(filename)) return createRequire(filename);
    const file = url ? fileURLToPath(url) : filename as string;
    return withoutCompilerFileReads(() => {
      // Existing owned module/compiler paths already have their correct native resolution context.
      if (scope.compilation.sourcePath(file) !== file) return createRequire(filename);
      // Match Node's directory-parent convention without admitting the directory above it.
      const parent = file.endsWith('/') || (process.platform === 'win32' && file.endsWith('\\'))
        ? path.join(file, 'noop.js') : file;
      return createRequire(scope.compilation.requireParent(parent));
    });
  }) as typeof module.createRequire;
  syncBuiltinESMExports();
}

/** Content code owns file bytes through its build scope; unrelated tasks and output reads stay native. */
export function withCompilerFileReads<T>(scope: CompilerFileReadScope, operation: () => T): T {
  install();
  return scopes.run(scope, operation);
}

/** Input validation must inspect the live filesystem, even when invoked from captured execution. */
export function withoutCompilerFileReads<T>(operation: () => T): T {
  return scopes.run(null, operation);
}

/** Startup runs outside an application-owned async context; explicit scopes still take precedence. */
export function beginCompilerStartupReads(scope: CompilerFileReadScope): () => void {
  if (state.startup) throw new Error('Compiler startup reads already have an owner');
  install();
  state.startup = scope;
  const preloadParent = pathToFileURL(process.cwd() + path.sep).href;
  const observeResolution = (specifier: string, context: ResolveHookContext) => {
    const current = currentScope();
    if (current && current === state.startup && !Array.from(context.conditions).includes('require')) {
      withoutCompilerFileReads(() => observeCompilerModuleResolution(current.compilation, specifier, {
        parentURL: context.parentURL ?? preloadParent, conditions: context.conditions,
      }));
    }
  };
  state.observeResolution = observeResolution;
  // Async loader hooks omit createRequire; this native CJS lookup also supplies resolve({ paths }).
  const commonjs = module as typeof module & {
    _findPath: (...args: unknown[]) => unknown; _resolveFilename: (...args: unknown[]) => unknown;
  };
  const findPath = commonjs._findPath;
  const findObserved = new Proxy(findPath, {
    apply(target, receiver, args) {
      const [specifier, lookupPaths] = args;
      const current = currentScope();
      if (current && current === state.startup && typeof specifier === 'string'
        && (lookupPaths == null || (Array.isArray(lookupPaths) && lookupPaths.every(file => typeof file === 'string')))) {
        withoutCompilerFileReads(() => observeCompilerModuleResolution(current.compilation, specifier, {
          parentURL: preloadParent, conditions: ['require'],
          lookupPaths: path.isAbsolute(specifier) ? [process.cwd()] : lookupPaths ?? [],
        }));
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  commonjs._findPath = findObserved;
  const resolveFilename = commonjs._resolveFilename;
  const resolveObserved = new Proxy(resolveFilename, {
    apply(target, receiver, args) {
      const [specifier, parent] = args as [unknown, { filename?: unknown } | undefined];
      const current = currentScope();
      if (current && current === state.startup && typeof specifier === 'string') {
        withoutCompilerFileReads(() => observeCompilerModuleResolution(current.compilation, specifier, {
          parentURL: typeof parent?.filename === 'string' ? pathToFileURL(parent.filename).href : preloadParent,
          conditions: ['require'],
        }));
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  commonjs._resolveFilename = resolveObserved;

  // Node reads package declarations internally, bypassing the public fs adapters.
  // Observe lookup candidates, including missing nearer packages, without replacing resolution.
  // Node's asynchronous loader worker has no synchronous resolve implementation.
  const hooks = !isInternalThread ? module.registerHooks({
    resolve(specifier, context, next) {
      observeResolution(specifier, context);
      return next(specifier, context);
    },
  }) : undefined;
  const register = module.register;
  const loader = scope.asyncLoader;
  let observingLoader = !!loader && [...process.execArgv, ...parseNodeOptions(process.env.NODE_OPTIONS)].includes(loader);
  const registerObserved: typeof register = (...args) => {
    if (state.startup === scope && loader && !observingLoader) { register(loader); observingLoader = true; }
    return Reflect.apply(register, module, args);
  };
  if (loader && !isInternalThread) {
    // Wait for the user's first registration: creating an earlier loader replays require preloads.
    module.register = registerObserved;
    syncBuiltinESMExports();
  }
  return () => {
    if (state.startup === scope) {
      state.startup = undefined;
      state.observeResolution = undefined;
      if (commonjs._findPath === findObserved) commonjs._findPath = findPath;
      if (commonjs._resolveFilename === resolveObserved) commonjs._resolveFilename = resolveFilename;
      hooks?.deregister();
      if (module.register === registerObserved) { module.register = register; syncBuiltinESMExports(); }
    }
  };
}

/** Native admission lasts through compiler execution, independently of startup filesystem interception. */
export function beginCompilerNativeModules(admit: (file: string) => string): () => void {
  if (state.nativeModule) throw new Error('Compiler native modules already have an owner');
  install();
  state.nativeModule = admit;
  return () => { if (state.nativeModule === admit) state.nativeModule = undefined; };
}
