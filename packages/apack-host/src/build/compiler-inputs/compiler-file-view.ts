import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCompilerInputObservations, hashCompilerInputObservations } from './compiler-observations.ts';
import { isPackInputPath, type BuildInputKind, type BuildInputObserver } from '../pack-inputs.ts';
import { compilerSourcePath, relativeCompilerPath, resolveCompilerPath, type CompilerPathMapping } from './compiler-paths.ts';
import { captureNativeDirectory, type CompilerDirectoryCursor } from './compiler-directories.ts';
import { captureCompilerMetadata, compilerMetadataOperations, type CompilerMetadataKind } from './compiler-metadata.ts';
import { physicalWatchPath, physicalWatchPathListed, type PhysicalListings } from './watch-paths.ts';
import { withoutCompilerFileReads } from './compiler-file-reads.ts';
import { withCompilerFileReads } from './compiler-file-reads.ts';

export interface CompilerFileSystem {
  readFile(file: string, encoding?: string): string | undefined;
  fileExists(file: string): boolean;
  directoryExists(file: string): boolean;
  getDirectories(file: string): string[];
  readDirectory(root: string, extensions?: readonly string[], excludes?: readonly string[],
    includes?: readonly string[], depth?: number): string[];
  realpath(file: string): string;
}

interface FileState {
  physical: string;
  kind: 'file' | 'directory' | 'missing' | 'other';
  mode: number;
}

interface FileInput extends FileState { file: string; slot: string }
export type CompilerDirectoryResult = Array<string | Buffer | fs.Dirent<string> | fs.Dirent<Buffer>>;

const recursiveDirectory = (options: unknown) => options && typeof options === 'object' && 'recursive' in options && options.recursive === true;

/** Keep mutable names, arrays and Dirent fields outside the captured query authority. */
function copyDirectoryResult(result: CompilerDirectoryResult): CompilerDirectoryResult {
  return result.map(entry => {
    if (typeof entry === 'string') return entry;
    if (Buffer.isBuffer(entry)) return Buffer.from(entry);
    const copy = Object.create(Object.getPrototypeOf(entry), Object.getOwnPropertyDescriptors(entry));
    for (const key of Reflect.ownKeys(copy)) if (Buffer.isBuffer(copy[key])) copy[key] = Buffer.from(copy[key]);
    return copy;
  });
}

function directoryResultKey(result: CompilerDirectoryResult, parentPath: (file: string) => string = file => file): string {
  return JSON.stringify(result.map(entry => typeof entry === 'string' || Buffer.isBuffer(entry) ? entry : {
    name: entry.name, parentPath: parentPath(entry.parentPath),
    kind: [entry.isFile(), entry.isDirectory(), entry.isSymbolicLink(), entry.isBlockDevice(),
      entry.isCharacterDevice(), entry.isFIFO(), entry.isSocket()],
  }));
}

interface DirectoryEntry { name: string; kind: string }

/** Match TypeScript's BOM handling while keeping the original bytes as an input. */
function sourceText(bytes: Buffer): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(0, bytes.length & ~1)).swap16().toString('utf16le', 2);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.toString('utf16le', 2);
  return bytes.toString('utf8', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0);
}

/** One scan consumes owned query results and bytes; validation never changes that view. */
export function createCompilerFileView(root: string, options: {
  paths?: readonly CompilerPathMapping[];
  /** The caller owns complete authored membership; dependency and outside glob reads remain observed. */
  authoredFiles?: readonly string[];
  excluded?: (file: string) => boolean;
  observe?: BuildInputObserver;
} = {}) {
  const paths = options.paths?.map(mapping => ({ ...mapping })) ?? [];
  const authoredFiles = options.authoredFiles && [...options.authoredFiles];
  const realRoot = fs.realpathSync.native(root);
  const authoredRoot = path.resolve(root);
  // Normalize OS spelling without erasing the root link that lstat/readlink can observe.
  const rootSlot = fs.lstatSync(authoredRoot).isSymbolicLink()
    ? path.join(fs.realpathSync.native(path.dirname(authoredRoot)), path.basename(authoredRoot)) : realRoot;
  const roots = [...new Set([authoredRoot, realRoot])];
  const rootAliases = roots.map(captured => ({ captured, source: captured === authoredRoot ? rootSlot : realRoot }));
  const authoredPath = (file: string) => {
    if (!authoredFiles) return;
    for (const root of roots) {
      const relative = relativeCompilerPath(root, file);
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
        && !relative.split(path.sep).includes('node_modules')) return relative;
    }
  };
  const excluded = options.excluded ?? (file => {
    const relative = authoredPath(file);
    return relative !== undefined && !isPackInputPath(relative, false);
  });
  const origin = compilerSourcePath(realRoot, paths);
  const observe = options.observe;
  const observeRecursiveEntry = (directory: string, options: unknown, entry: CompilerDirectoryResult[number]) => {
    if (!observe || !recursiveDirectory(options)) return;
    const file = typeof entry === 'string' || Buffer.isBuffer(entry)
      ? path.resolve(directory, entry.toString()) : path.join(entry.parentPath, entry.name.toString());
    observe(path.dirname(file), 'entries');
    // Strings do not carry entry kinds. Subscription discovery checks which targets are directories.
    observe(file, 'entries');
  };
  let disposed = false;
  const assertOpen = () => { if (disposed) throw new Error('Compiler input operation outlived its build'); };
  // The mappings and origin are fixed for the view's lifetime, so each file projects to one name.
  const projected = new Map<string, string>();
  const relative = (file: string) => {
    let value = projected.get(file);
    if (value === undefined) {
      value = relativeCompilerPath(origin, compilerSourcePath(compilerSourcePath(file, rootAliases), paths)).split(path.sep).join('/');
      projected.set(file, value);
    }
    return value;
  };
  // Stored buffers are private and never mutated, so a buffer's digest is computed once.
  const digests = new WeakMap<Buffer, string>();
  const digest = (bytes: Buffer) => {
    let value = digests.get(bytes);
    if (value === undefined) digests.set(bytes, value = createHash('sha256').update(bytes).digest('hex'));
    return value;
  };
  const physical = new Map<string, string>();
  const listings: PhysicalListings = new Map();
  // Outside any compiler's intercepted reads: a listing taken to resolve a path is no directory a compiler read
  const list = (directory: string) => withoutCompilerFileReads(() => fs.readdirSync(directory, { withFileTypes: true }));
  const inputs = new Map<string, FileInput>();
  const contents = new Map<string, Buffer | undefined>();
  const dataStats = new Map<string, { normal: fs.Stats; bigint: fs.BigIntStats }>();
  const directories = new Map<string, { file: string; entries: DirectoryEntry[] }>();
  const globs = new Map<string, { args: Parameters<CompilerFileSystem['readDirectory']>; files: string[]; read: CompilerFileSystem['readDirectory'] }>();
  const included = new Set<string>();
  const metadata = new Map<string, { file: string; kind: CompilerMetadataKind; args: readonly unknown[]; query: ReturnType<typeof captureCompilerMetadata> }>();
  const directoryQueries = new Map<string, { file: string; physical: string; options: unknown; result: CompilerDirectoryResult; key: string }>();
  const directoryCursors = new Map<string, { file: string; options: unknown; cursor: CompilerDirectoryCursor }>();

  function state(file: string, paths: Map<string, string>, listed: PhysicalListings): FileState {
    const target = physicalWatchPathListed(file, paths, listed, list);
    let stat: fs.Stats | undefined;
    try { stat = fs.statSync(target, { throwIfNoEntry: false }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
    return { physical: target, kind: stat?.isFile() ? 'file' : stat?.isDirectory() ? 'directory' : stat ? 'other' : 'missing', mode: stat ? stat.mode & 0o777 : 0 };
  }

  function input(file: string, kind: BuildInputKind): FileInput | undefined {
    assertOpen();
    file = resolveCompilerPath(file);
    observe?.(file, kind);
    if (excluded(file) && !included.has(file)) return;
    let value = inputs.get(file);
    if (!value) {
      value = { file, ...state(file, physical, listings), slot: path.join(physicalWatchPath(path.dirname(file), physical), path.basename(file)) };
      inputs.set(file, value);
    }
    if (included.has(file)) included.add(value.physical);
    return value;
  }

  const bytes = (file: string): Buffer | undefined => {
    try { return fs.readFileSync(file); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  };
  function captureDataStats(file: string, bytes?: Buffer) {
    if (dataStats.has(file)) return;
    const normal = Reflect.apply(compilerMetadataOperations.stat.sync, fs, [file]) as fs.Stats;
    const bigint = Reflect.apply(compilerMetadataOperations.stat.sync, fs, [file, { bigint: true }]) as fs.BigIntStats;
    if ((bytes && normal.size !== bytes.length)
      || ['dev', 'ino', 'mode', 'size'].some(key => Reflect.get(normal, key) !== Number(Reflect.get(bigint, key)))) {
      throw new Error(`Compiler input changed during capture: ${file}`);
    }
    dataStats.set(file, { normal, bigint });
  }
  function readBytes(file: string): Buffer | undefined {
    const node = input(file, 'file');
    if (node?.kind !== 'file') return;
    if (!contents.has(node.physical)) {
      const value = bytes(node.physical);
      if (value !== undefined) captureDataStats(node.physical, value);
      contents.set(node.physical, value);
    }
    const value = contents.get(node.physical);
    return value === undefined ? undefined : Buffer.from(value);
  }
  function includesDirectoryEntry(directory: string, child: string): boolean {
    return (excluded(directory) && included.has(path.resolve(directory))) || !excluded(child);
  }
  function readDirectory(file: string, options: unknown): CompilerDirectoryResult {
    const result = Reflect.apply(fs.readdirSync, fs, [file, options]) as CompilerDirectoryResult;
    return result.filter(entry => includesDirectoryEntry(file, typeof entry === 'string' || Buffer.isBuffer(entry)
      ? path.join(file, String(entry)) : path.join(entry.parentPath, String(entry.name))));
  }
  function entries(file: string, directory: string): DirectoryEntry[] {
    return fs.readdirSync(directory, { withFileTypes: true }).filter(entry => includesDirectoryEntry(file, path.join(file, entry.name)))
      .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other' }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  function listing(file: string): DirectoryEntry[] {
    const node = input(file, 'entries');
    if (node?.kind !== 'directory') return [];
    let value = directories.get(node.physical);
    if (!value) {
      value = { file: node.file, entries: entries(node.file, node.physical) };
      directories.set(node.physical, value);
    }
    return value.entries;
  }

  const fileSystem: Omit<CompilerFileSystem, 'readDirectory'> = {
    readFile(file) {
      const value = readBytes(file);
      return value === undefined ? undefined : sourceText(value);
    },
    fileExists: file => input(file, 'file')?.kind === 'file',
    directoryExists: file => input(file, 'directory')?.kind === 'directory',
    getDirectories(file) {
      return listing(file).filter(entry => entry.kind === 'directory'
        || (entry.kind === 'link' && fileSystem.directoryExists(path.join(file, entry.name)))).map(entry => entry.name);
    },
    realpath: file => input(file, 'file')?.physical ?? path.resolve(file),
  };

  input(root, 'directory');
  const changed = (file: string): never => { throw new Error(`Compiler resolution namespace changed during discovery: ${file}`); };
  const ancestors = (file: string) => {
    assertOpen();
    const values: FileInput[] = [];
    const boundary = paths.find(mapping => {
      const relative = relativeCompilerPath(mapping.captured, path.resolve(file));
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })?.captured;
    if (boundary === path.resolve(file)) return values;
    for (let directory = path.dirname(path.resolve(file)); ; directory = path.dirname(directory)) {
      const value = input(directory, 'directory');
      if (value) values.push({ ...value });
      if (directory === boundary || path.dirname(directory) === directory) break;
    }
    return values;
  };
  // A caller can retain another owner's facts under its identity instead of replaying private copies as sources.
  const observations = (exclude: (file: string) => boolean = () => false) => {
    assertOpen();
    const result = createCompilerInputObservations(origin);
    if (authoredFiles) result.record(['authored-files'], authoredFiles);
    for (const [file, bytes] of contents) if (!exclude(file)) result.record(['file', relative(file)], bytes === undefined ? null : digest(bytes));
    for (const value of inputs.values()) if (!exclude(value.file)) result.record(['namespace', relative(value.slot)], [relative(value.physical), value.kind, value.kind === 'file' ? value.mode & 0o111 : 0]);
    for (const [directory, value] of directories) if (!exclude(value.file)) result.record(['entries', relative(directory)], value.entries);
    for (const query of directoryQueries.values()) if (!exclude(query.file)) result.record(['node-directory', relative(query.file), query.options], JSON.parse(directoryResultKey(query.result, relative)));
    for (const entry of metadata.values()) if (!exclude(entry.file)) for (const [query, value] of entry.query.facts(relative)) result.record(['node-metadata', entry.kind, relative(entry.file), entry.args, ...query], value);
    for (const query of directoryCursors.values()) if (!exclude(query.file)) for (const [index, value] of query.cursor.facts(relative)) result.record(['node-opendir', relative(query.file), query.options, index], value);
    return result.snapshot();
  };
  const view = {
    excluded,
    fileSystem,
    // Keep native capture usable before compiler activation; the compiler owns glob semantics.
    readGlob(read: CompilerFileSystem['readDirectory'], ...args: Parameters<CompilerFileSystem['readDirectory']>): string[] {
      if (input(args[0], 'entries')?.kind !== 'directory') return [];
      const query: Parameters<CompilerFileSystem['readDirectory']> = [path.resolve(args[0]),
        args[1] && [...args[1]], args[2] && [...args[2]], args[3] && [...args[3]], args[4]];
      const key = JSON.stringify(query);
      let value = globs.get(key);
      if (!value) {
        const files = withCompilerFileReads({ compilation: {
          isInput: file => !excluded(file) && authoredPath(file) === undefined,
          readDataPath: file => file,
          readMetadata: (kind, file, args) => view.readMetadata(kind, file, args),
          readDirectory: (file, options) => view.readDirectoryData(file, options),
          openDirectory: (file, options) => view.openDirectoryData(file, options),
          sourcePath: file => compilerSourcePath(file, paths),
          diagnostic: message => message,
          requireParent: file => file,
        } }, () => read(...query));
        value = { args: query, files: files.filter(file => !excluded(file)).sort(), read };
        globs.set(key, value);
      }
      return [...value.files];
    },
    readBytes,
    readDataBytes(file: string) {
      assertOpen();
      included.add(path.resolve(file));
      const value = readBytes(file);
      const node = input(file, 'file');
      if (node?.kind === 'directory') captureDataStats(node.physical);
      return value;
    },
    ancestors,
    readMetadata(kind: CompilerMetadataKind, file: string, args: readonly unknown[]) {
      assertOpen();
      file = path.resolve(file);
      observe?.(file, 'file');
      const key = JSON.stringify([kind, file, args]);
      let entry = metadata.get(key);
      if (!entry) {
        const node = kind === 'stat' ? inputs.get(file) : undefined;
        const stats = node && dataStats.get(node.physical);
        const options = args[0];
        const validOptions = args.length <= 1 && (options == null || (typeof options === 'object' && !Array.isArray(options)
          && ['bigint', 'throwIfNoEntry'].every(key => Reflect.get(options, key) === undefined || typeof Reflect.get(options, key) === 'boolean')));
        const initial = stats && validOptions
          ? { value: options && typeof options === 'object' && Reflect.get(options, 'bigint') ? stats.bigint : stats.normal } : undefined;
        entry = { file, kind, args: args.map(arg => arg && typeof arg === 'object' ? { ...arg } : arg), query: captureCompilerMetadata(kind, file, args, initial) };
        metadata.set(key, entry);
      }
      return entry.query.value();
    },
    readDirectoryData(file: string, options: unknown) {
      assertOpen();
      file = path.resolve(file);
      included.add(file);
      const node = input(file, 'entries');
      const queryOptions = options && typeof options === 'object'
        ? Object.fromEntries(['encoding', 'withFileTypes', 'recursive']
          .filter(key => Object.prototype.propertyIsEnumerable.call(options, key))
          .map(key => [key, (options as Record<string, unknown>)[key]])) : options;
      const key = JSON.stringify([file, queryOptions]);
      let query = directoryQueries.get(key);
      if (!query) {
        // A new representation must agree with earlier observations before joining this view.
        // Cached identical queries still serve their owned result through transient live edits.
        const contains = (parent: string, child: string) => {
          const relative = relativeCompilerPath(parent, child);
          return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        };
        for (const previous of directoryQueries.values()) {
          const physical = node?.physical ?? file;
          if (previous.physical !== physical
            && !(recursiveDirectory(previous.options) && contains(previous.physical, physical))
            && !(recursiveDirectory(queryOptions) && contains(physical, previous.physical))) continue;
          const current = readDirectory(previous.file, previous.options);
          if (directoryResultKey(current) !== previous.key) changed(previous.file);
        }
        if (node) {
          const previous = directories.get(node.physical);
          if (previous && JSON.stringify(entries(previous.file, node.physical)) !== JSON.stringify(previous.entries)) changed(file);
        }
        const result = readDirectory(file, queryOptions);
        query = { file, physical: node?.physical ?? file, options: queryOptions, result: copyDirectoryResult(result), key: directoryResultKey(result) };
        directoryQueries.set(key, query);
      }
      for (const entry of query.result) observeRecursiveEntry(file, queryOptions, entry);
      return copyDirectoryResult(query.result);
    },
    openDirectoryData(file: string, options: unknown) {
      assertOpen();
      file = path.resolve(file);
      included.add(file);
      input(file, 'entries');
      const capturedOptions = options && typeof options === 'object' ? { ...options } : options;
      const key = JSON.stringify([file, capturedOptions]);
      let query = directoryCursors.get(key);
      if (!query) {
        query = { file, options: capturedOptions, cursor: captureNativeDirectory(file, capturedOptions, entry => {
          if (!includesDirectoryEntry(file, path.join(entry.parentPath, String(entry.name)))) return false;
          observeRecursiveEntry(file, capturedOptions, entry);
          return true;
        }) };
        directoryCursors.set(key, query);
      }
      return query.cursor;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const { cursor } of directoryCursors.values()) {
        try { cursor.dispose(); } catch (error) { errors.push(error); }
      }
      for (const state of [physical, listings, inputs, contents, dataStats, directories, globs, included, metadata, directoryQueries, directoryCursors, projected]) state.clear();
      if (errors.length) throw new AggregateError(errors, 'Could not close compiler directory cursors');
    },
    captureLocation(file: string, kind: BuildInputKind) {
      if (kind === 'entries') listing(file);
      const value = input(file, kind);
      return value && { ...value };
    },
    captureDataLocation(file: string, kind: BuildInputKind) {
      assertOpen();
      included.add(path.resolve(file));
      const value = input(file, kind);
      return value && { ...value };
    },
    resolutionDirectory(file: string) {
      const directory = input(file, 'entries');
      const locations: FileInput[] = directory ? [{ ...directory }] : [];
      const files: Array<{ file: string; bytes?: Buffer; mode: number }> = [];
      for (const entry of listing(file)) {
        const child = path.join(file, entry.name);
        if (excluded(file) && included.has(path.resolve(file))) included.add(path.resolve(child));
        const node = input(child, 'file');
        if (!node) continue;
        if (node.kind === 'missing' && entry.kind !== 'link') changed(node.file);
        locations.push({ ...node });
        if (node.kind !== 'file') continue;
        const source = /\.(?:[cm]?[jt]sx?|json)$/.test(node.file);
        files.push({ file: node.physical, mode: node.mode, bytes: source ? readBytes(node.file) : undefined });
      }
      return { files, locations, links: [] };
    },
    /** Admit bytes already consumed by a producer, without rereading its mutable file. */
    captureFile(file: string, value: Buffer) {
      assertOpen();
      included.add(path.resolve(file));
      const node = input(file, 'file');
      const previous = node && contents.get(node.physical);
      if (node?.kind !== 'file' || (contents.has(node.physical) && (previous === undefined || !previous.equals(value)))) {
        throw new Error(`Compiler input changed during capture: ${file}`);
      }
      captureDataStats(node.physical, value);
      contents.set(node.physical, Buffer.from(value));
      return { file: node.physical, bytes: Buffer.from(value), mode: node.mode };
    },
    snapshot() {
      assertOpen();
      // Materialize every positive query and known directory entry, without inventing an ancestor scan.
      for (const value of directories.values()) {
        for (const entry of value.entries) input(path.join(value.file, entry.name), 'file');
      }
      const files = new Map<string, { file: string; bytes: Buffer; mode: number }>();
      for (const value of inputs.values()) {
        if (value.kind !== 'file') continue;
        const data = readBytes(value.file) ?? changed(value.file);
        files.set(value.physical, { file: value.physical, bytes: data, mode: value.mode });
      }
      for (const value of inputs.values()) ancestors(value.file);
      return { files: [...files.values()], locations: [...inputs.values()].map(value => ({ ...value })) };
    },
    assertCurrent() {
      assertOpen();
      const current = new Map<string, string>();
      const listed: PhysicalListings = new Map();
      for (const value of inputs.values()) {
        const next = state(value.file, current, listed);
        if (next.kind !== value.kind || next.physical !== value.physical
          || (value.kind === 'file' && (next.mode & 0o111) !== (value.mode & 0o111))) changed(value.file);
      }
      for (const [file, value] of contents) {
        const next = bytes(file);
        if (value === undefined ? next !== undefined : next === undefined || !value.equals(next)) changed(file);
      }
      for (const [directory, value] of directories) {
        if (JSON.stringify(entries(value.file, directory)) !== JSON.stringify(value.entries)) changed(value.file);
      }
      for (const query of directoryCursors.values()) if (!query.cursor.assertCurrent()) changed(query.file);
      for (const entry of metadata.values()) if (!entry.query.assertCurrent()) changed(entry.file);
      for (const query of directoryQueries.values()) {
        const result = readDirectory(query.file, query.options);
        if (directoryResultKey(result) !== query.key) changed(query.file);
      }
      for (const value of globs.values()) {
        if (JSON.stringify(value.read(...value.args).filter(file => !excluded(file)).sort()) !== JSON.stringify(value.files)) changed(value.args[0]);
      }
    },
    observations,
    hash() { return hashCompilerInputObservations(observations()); },
  };
  return view;
}
