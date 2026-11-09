import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import envPaths from 'env-paths';
import { holdExclusiveLock, holdExclusiveLockWaiting } from '@apackdev/host/exclusive-lock';
import { lockIsHeld } from '@apackdev/host/process-liveness';
import { readPackageInputs, readPackageInputsAsync } from '@apackdev/host/build/package-inputs';
import { cliPackageDirectory } from './tool-identity.ts';
import { compilerRuntimeFileSystem as fs, readCompilerRuntimeInputs } from './compiler-runtime.ts';

export interface CompilerInstallation {
  readonly bin: string;
  readonly executable: string;
  readonly runtimeDirectory: string;
  readonly hash: string;
  readonly inputsFile: string;
  readonly environment: Readonly<Pick<NodeJS.ProcessEnv, 'ESBUILD_BINARY_PATH'>>;
  isCurrent(directory: string, options?: CompilerInstallationOptions): boolean;
  dispose(): Promise<void>;
}

interface CompilerInstallationOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

function compilerPackagesHash(directory: string): string {
  return readPackageInputs([{ id: 'compiler', directory, contents: true }]).hash;
}

export function readEsbuildOverride({ cwd = process.cwd(), env = process.env }: CompilerInstallationOptions) {
  const value = env.ESBUILD_BINARY_PATH;
  // esbuild deliberately ignores this system path, even when it exists.
  if (!value || value === '/usr/bin/esbuild') return;
  const file = path.resolve(cwd, value);
  try {
    const source = fs.realpathSync.native(file);
    const stat = fs.statSync(source);
    if (!stat.isFile()) throw new Error(`esbuild executable is not a file: ${file}`);
    return { kind: 'file' as const, file, source, mode: stat.mode & 0o777, bytes: fs.readFileSync(source) };
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    return { kind: 'missing' as const, file };
  }
}

function executableIdentity(root: string, executable: ReturnType<typeof readEsbuildOverride>) {
  if (!executable) return null;
  return [path.relative(root, executable.file), executable.kind === 'missing' ? null
    : [path.relative(root, executable.source), executable.mode & 0o111, createHash('sha256').update(executable.bytes).digest('hex')]];
}

/** A checkout builds the same distributable worker that an installed CLI runs. */
export function compilerPackageDirectory(root = cliPackageDirectory()): string {
  const directory = fs.existsSync(path.join(root, 'dist/cli.js')) ? root : path.join(root, 'dist/package');
  if (!fs.existsSync(path.join(directory, 'dist/build-worker.js'))) {
    throw new Error(`Missing pack compiler at ${directory}; build the CLI package before compiling packs`);
  }
  return fs.realpathSync.native(directory);
}

/**
 * Where captured installations live: one directory per distinct input, shared by every build and process on the
 * machine (`APACK_COMPILER_STORE` overrides it; specs point it at a temporary directory). The cache root is
 * `cliDirs().cache`'s, spelled here because `app/pack-host.ts` is not part of the worker bundle this module is.
 *
 * **Shared so its executables keep one path.** A capture copies the runtime and the compiler's own executables
 * (the esbuild binary, native addons) and every build runs them; macOS security-assesses each new executable path,
 * so a fresh copy per build is a fresh assessment per build. One stable copy per input is assessed once.
 */
export const compilerStoreRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  env.APACK_COMPILER_STORE ?? path.join(envPaths('apack-cli', { suffix: '' }).cache, 'compilers');

/**
 * How many entries the store keeps. A checkout makes a new one on every compiler rebuild, so an unbounded store
 * grows by a runtime copy per edit; three covers the current compiler, the previous one and another runtime.
 * An entry a live process is using is never removed, whatever the count.
 */
export const COMPILER_STORE_ENTRIES = 3;

const isStoreEntry = (name: string) => /^[0-9a-f]{16}$/.test(name);
const usersDirectory = (entry: string) => `${entry}.users`;
const usedFile = (entry: string) => `${entry}.used`;

/**
 * Marks `entry` as used by this process until the returned release runs, and records the use's time. A marker
 * names its pid, so one left by a process that died is ignored rather than holding the entry forever.
 */
function useCompilerStoreEntry(entry: string): () => void {
  fs.mkdirSync(usersDirectory(entry), { recursive: true });
  const marker = path.join(usersDirectory(entry), `${process.pid}-${randomUUID()}`);
  fs.writeFileSync(marker, '');
  fs.writeFileSync(usedFile(entry), '');
  return () => fs.rmSync(marker, { force: true });
}

/** Whether a live process holds a use of `entry`; dead processes' markers are removed on the way */
export function compilerStoreEntryInUse(entry: string): boolean {
  let names: string[];
  try { names = fs.readdirSync(usersDirectory(entry)); }
  catch { return false; }
  let inUse = false;
  for (const name of names) {
    if (lockIsHeld(Number(name.split('-')[0]))) inUse = true;
    else fs.rmSync(path.join(usersDirectory(entry), name), { force: true });
  }
  return inUse;
}

/** Removes an entry and its bookkeeping, unless it is being captured or used; returns whether it went */
export async function removeCompilerStoreEntry(entry: string): Promise<boolean> {
  if (compilerStoreEntryInUse(entry)) return false;
  let lock;
  try { lock = holdExclusiveLock({ file: `${entry}.lock`, what: 'compiler installation removal', refuse: holder => new Error(holder) }); }
  catch { return false; }
  try {
    // A use that began before the lock was taken is still visible here; one that begins after fails its verification
    if (compilerStoreEntryInUse(entry)) return false;
    await removeCompilerStoreDirectory(entry);
    fs.rmSync(usedFile(entry), { force: true });
    // A marker written since the check keeps the directory; the recapture its owner then runs reuses it
    try { fs.rmdirSync(usersDirectory(entry)); } catch { /* not empty or absent */ }
    return true;
  } finally { lock.release(); }
}

const lastUsed = (entry: string) => (fs.statSync(usedFile(entry), { throwIfNoEntry: false }) ?? fs.statSync(entry, { throwIfNoEntry: false }))?.mtimeMs ?? 0;

/** Keeps the most recently used entries besides `kept`, up to `COMPILER_STORE_ENTRIES` in all */
async function pruneCompilerStore(store: string, kept: string): Promise<void> {
  const entries = fs.readdirSync(store).filter(isStoreEntry).map(name => path.join(store, name)).filter(entry => entry !== kept)
    .sort((a, b) => lastUsed(b) - lastUsed(a));
  for (const entry of entries.slice(COMPILER_STORE_ENTRIES - 1)) await removeCompilerStoreEntry(entry);
}

/** Every entry directory in a store, for `apack cache clean` */
export function compilerStoreEntries(store: string): string[] {
  return fs.existsSync(store) ? fs.readdirSync(store).filter(isStoreEntry).map(name => path.join(store, name)) : [];
}

/** What a capture is of, read from the originals before anything is copied */
interface CompilerSources {
  readonly directory: string;
  readonly inputs: Awaited<ReturnType<typeof readPackageInputsAsync>>;
  readonly runtime: ReturnType<typeof readCompilerRuntimeInputs>;
  readonly executable: ReturnType<typeof readEsbuildOverride>;
  readonly executableId: string;
}

/**
 * The store entry a capture of these sources belongs in.
 *
 * **The capturing directory is part of the key, because a captured tree is not portable.** `capturedPathIn`
 * below files every source under its *absolute* path, and the replay resolves them there, so an entry can
 * only ever serve the checkout that made it. Keyed on contents alone — the package graph, the runtime, the
 * esbuild identity — two checkouts sharing one `package-lock.json` agree on a key, and the second replays a
 * tree holding the first one's paths: the build then fails on a module it can see on disk and not in the
 * capture, naming neither checkout. Worktrees are ordinary here, `session:new` and `session:check` both
 * making one, so that is the common case rather than an exotic one.
 *
 * The cost is a capture per checkout rather than per machine, which is what the tree's own shape already
 * implied; `COMPILER_STORE_ENTRIES` bounds what the store keeps, oldest use first.
 */
export function compilerStoreKey(parts: {
  readonly directory: string;
  readonly inputsHash: string;
  readonly runtimeHash: string;
  readonly executableId: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([parts.directory, parts.inputsHash, parts.runtimeHash, parts.executableId]))
    .digest('hex')
    .slice(0, 16);
}

/** The path a source file has inside an installation rooted at `entry`; pure, so a reuse can recompute it */
function capturedPathIn(entry: string, source: string): string {
  const root = path.parse(source).root;
  return path.join(entry, 'tree', Buffer.from(root).toString('hex'), path.relative(root, source));
}

/**
 * The installation an entry holds, verified as a fresh capture's last steps verify it — the copied graph, the
 * captured runtime and esbuild bytes, no aliasing — or `undefined` when the entry is absent or does not match.
 * Both a new capture and a reuse go through this, so a reused entry is held to exactly what a new one is.
 */
async function installationAt(entry: string, sources: CompilerSources, signal?: AbortSignal): Promise<CompilerInstallation | undefined> {
  const { directory, inputs, runtime, executable, executableId } = sources;
  const capturedPath = (source: string) => capturedPathIn(entry, source);
  const inputsFile = path.join(entry, 'compiler-inputs.json');
  let recorded: string;
  try { recorded = (JSON.parse(fs.readFileSync(inputsFile, 'utf8')) as { hash?: unknown }).hash as string; }
  catch { return undefined; }
  const root = capturedPath(inputs.nodes[inputs.roots[0]!.node]!.directory);
  if (!fs.existsSync(root)) return undefined;
  const verified = await readPackageInputsAsync([{ id: 'compiler', directory: root, contents: true }], { signal });
  if (verified.hash !== inputs.hash || verified.nodes.some(node => !node.directory.startsWith(`${entry}${path.sep}`))) return undefined;
  const capturedExecutable = capturedPath(runtime.executable);
  if (!fs.lstatSync(capturedExecutable, { throwIfNoEntry: false })?.isFile()
    || fs.realpathSync.native(capturedExecutable) !== capturedExecutable) return undefined;
  const capturedRuntime = readCompilerRuntimeInputs(capturedExecutable);
  if (capturedRuntime.contentsHash !== runtime.contentsHash) return undefined;
  const hash = createHash('sha256').update(JSON.stringify([inputs.hash, executableId, capturedRuntime.hash])).digest('hex');
  if (hash !== recorded) return undefined;
  const environment = Object.freeze({ ESBUILD_BINARY_PATH: executable?.kind === 'file' ? capturedPath(executable.source) : undefined });
  const executableCurrent = () => {
    if (executable?.kind !== 'file') return true;
    const file = environment.ESBUILD_BINARY_PATH!;
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return !!stat?.isFile() && (stat.mode & 0o111) === (executable.mode & 0o111)
      && fs.readFileSync(file).equals(executable.bytes);
  };
  if (!executableCurrent()) return undefined;
  const capturedRuntimeCurrent = () => !!fs.lstatSync(capturedExecutable, { throwIfNoEntry: false })?.isFile()
    && fs.realpathSync.native(capturedExecutable) === capturedExecutable
    && readCompilerRuntimeInputs(capturedExecutable).hash === capturedRuntime.hash;
  return { bin: path.join(root, 'bin/apack.mjs'), executable: capturedExecutable, runtimeDirectory: capturedPath(runtime.directory),
    hash, inputsFile, environment,
    // The entry is shared and immutable; the caller's use of it ends at dispose
    dispose: async () => {},
    isCurrent(source, options = {}) {
      return fs.realpathSync.native(source) === directory
        && executableId === JSON.stringify(executableIdentity(directory, readEsbuildOverride(options)))
        && executableCurrent() && fs.existsSync(root) && capturedRuntimeCurrent()
        && readCompilerRuntimeInputs(process.execPath).hash === runtime.hash
        && compilerPackagesHash(source) === inputs.hash && compilerPackagesHash(root) === inputs.hash;
    },
  };
}

/** Removes a store directory or entry, which the store holds read-only — a damaged entry is captured again */
export async function removeCompilerStoreDirectory(entry: string): Promise<void> {
  const writable = async (file: string): Promise<void> => {
    const stat = await fs.promises.lstat(file).catch(() => undefined);
    if (!stat?.isDirectory()) return;
    await fs.promises.chmod(file, 0o700);
    await Promise.all((await fs.promises.readdir(file)).map(name => writable(path.join(file, name))));
  };
  await writable(entry);
  await fs.promises.rm(entry, { recursive: true, force: true });
}

/** Copies the sources into `entry`, which does not exist yet; removes it again if anything fails */
async function captureInto(entry: string, sources: CompilerSources, options: CompilerInstallationOptions): Promise<void> {
  const { directory, runtime, executable } = sources;
  const paths = new Map<string, string>();
  const capturedPath = (source: string) => {
    const root = path.parse(source).root;
    paths.set(path.join(entry, 'tree', Buffer.from(root).toString('hex')), root);
    return capturedPathIn(entry, source);
  };
  const copied = new Map<string, string>();
  const directories = new Set<string>();
  const mkdir = (directory: string) => {
    if (directories.has(directory)) return;
    fs.mkdirSync(directory, { recursive: true });
    for (let current = directory; !directories.has(current); current = path.dirname(current)) {
      directories.add(current);
      if (current === entry) break;
    }
  };
  mkdir(entry);
  try {
    const copy = ({ source, mode, hash }: { source: string; mode: number; hash: string }, bytes: Buffer, clone = false) => {
      const identity = `${mode}:${hash}`;
      const previous = copied.get(source);
      if (previous !== undefined) {
        if (previous !== identity) throw new Error(`Compiler input changed during capture: ${source}`);
        return;
      }
      const target = capturedPath(source);
      mkdir(path.dirname(target));
      if (clone) fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      else fs.writeFileSync(target, bytes, { flag: 'wx', mode: mode & ~0o222 });
      fs.chmodSync(target, mode & ~0o222);
      copied.set(source, identity);
    };
    const inputs = await readPackageInputsAsync([{ id: 'compiler', directory, contents: true }], { onFile: copy, signal: options.signal });
    if (inputs.hash !== sources.inputs.hash) throw new Error('Compiler inputs changed during capture');
    options.signal?.throwIfAborted();
    const copiedRuntime = readCompilerRuntimeInputs(process.execPath, !!process.versions.electron, (file, bytes) => copy(file, bytes, true));
    if (copiedRuntime.contentsHash !== runtime.contentsHash) throw new Error('Compiler runtime changed during capture');
    for (const directory of runtime.directories) mkdir(capturedPath(directory));
    if (executable?.kind === 'file') {
      copy({ source: executable.source, mode: executable.mode,
        hash: createHash('sha256').update(executable.bytes).digest('hex') }, executable.bytes);
    } else if (executable) {
      console.warn(`[esbuild] Ignoring bad configuration: ESBUILD_BINARY_PATH=${(options.env ?? process.env).ESBUILD_BINARY_PATH}`);
    }
    const links = new Map<string, string>();
    const addLink = (source: string, target: string) => {
      if (source === target) return;
      const previous = links.get(source);
      if (previous !== undefined && previous !== target) throw new Error(`Compiler link changed during capture: ${source}`);
      links.set(source, target);
    };
    for (const node of inputs.nodes) {
      for (const directory of node.directories) mkdir(capturedPath(directory.source));
      for (const link of node.links) addLink(path.join(node.directory, link.path), link.target);
      for (const [name, index] of Object.entries(node.dependencies)) {
        if (index === null) continue;
        const lookup = node.lookups[name]!;
        addLink(lookup, inputs.nodes[index]!.directory);
        const paths = createRequire(capturedPath(path.join(node.directory, 'package.json'))).resolve.paths(name) ?? [];
        // Node's global search paths are outside the mirrored ancestry; bind those dependencies locally.
        if (!paths.some(directory => path.join(directory, name) === capturedPath(lookup))) {
          addLink(path.join(node.directory, 'node_modules', name), inputs.nodes[index]!.directory);
        }
      }
    }
    const runtimeLinks = new Map(runtime.links.map(link => [link.source, link.text]));
    for (const { source, target } of runtime.links) addLink(source, target);
    // Parent links first: a child lookup may already exist through its captured parent.
    for (const [source, target] of [...links].sort(([a], [b]) => a.length - b.length)) {
      const destination = capturedPath(source);
      const resolved = capturedPath(target);
      mkdir(path.dirname(destination));
      const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
      if (existing) {
        if (existing.isSymbolicLink() && path.resolve(path.dirname(destination), fs.readlinkSync(destination)) === resolved) continue;
        if (fs.realpathSync.native(destination) !== fs.realpathSync.native(resolved)) throw new Error(`Conflicting captured compiler path: ${source}`);
      } else {
        const directoryType = process.platform === 'win32' ? 'junction' : 'dir';
        const text = runtimeLinks.get(source);
        // Relative framework links are sealed by macOS signatures; keep their exact spelling.
        const link = process.platform !== 'win32' && text !== undefined && !path.isAbsolute(text) ? text : resolved;
        fs.symlinkSync(link, destination, fs.statSync(resolved, { throwIfNoEntry: false })?.isDirectory() ? directoryType : 'file');
      }
    }
    if (readCompilerRuntimeInputs(process.execPath).hash !== runtime.hash) throw new Error('Compiler runtime changed during capture');
    const capturedRuntime = readCompilerRuntimeInputs(capturedPath(runtime.executable));
    const hash = createHash('sha256').update(JSON.stringify([inputs.hash, sources.executableId, capturedRuntime.hash])).digest('hex');
    // Written last: an entry without it is one a reuse refuses, so an interrupted capture is never taken as whole
    fs.writeFileSync(path.join(entry, 'compiler-inputs.json'), JSON.stringify({ hash,
      packages: inputs.nodes.map(node => capturedPath(node.directory)),
      paths: [...paths].map(([captured, source]) => ({ captured, source })),
    }), { flag: 'wx', mode: 0o400 });
    for (const directory of directories) fs.chmodSync(directory, directory === entry ? 0o500 : 0o555);
  } catch (error) {
    await removeCompilerStoreDirectory(entry);
    throw error;
  }
}

/** Same-key captures in one process wait for each other; the store lock covers other processes */
const capturing = new Map<string, Promise<unknown>>();

/**
 * The installation for the selected compiler and runtime: the store's entry for these inputs, captured into it when
 * absent or damaged. Normal Node loading reads that copy, never mutable compiler originals.
 */
export async function captureCompilerInstallation(directory = compilerPackageDirectory(), options: CompilerInstallationOptions = {}): Promise<CompilerInstallation> {
  // The graph can be written while it is read — `packages:ensure` rebuilding a workspace's dist beside a capture — and
  // then the copy pass disagrees with the first read. The next attempt reads it settled, under a key derived from what
  // it read; a graph that keeps moving is still refused, naming what moved.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await captureOnce(directory, options);
    } catch (error) {
      if (attempt >= CAPTURE_ATTEMPTS || !(error instanceof Error) || !/changed during capture/.test(error.message)) throw error;
      options.signal?.throwIfAborted();
    }
  }
}

/** How many times a capture reads a graph that changed under it before refusing */
const CAPTURE_ATTEMPTS = 3;

async function captureOnce(directory: string, options: CompilerInstallationOptions): Promise<CompilerInstallation> {
  directory = fs.realpathSync.native(directory);
  const inputs = await readPackageInputsAsync([{ id: 'compiler', directory, contents: true }], { signal: options.signal });
  options.signal?.throwIfAborted();
  const runtime = readCompilerRuntimeInputs(process.execPath, !!process.versions.electron);
  const executable = readEsbuildOverride(options);
  const executableId = JSON.stringify(executableIdentity(directory, executable));
  const sources: CompilerSources = { directory, inputs, runtime, executable, executableId };
  const key = compilerStoreKey({ directory, inputsHash: inputs.hash, runtimeHash: runtime.contentsHash, executableId });
  // Resolved, as every path verification compares against is: on macOS the temporary root is itself a link
  fs.mkdirSync(compilerStoreRoot(options.env), { recursive: true });
  const store = fs.realpathSync.native(compilerStoreRoot(options.env));
  const entry = path.join(store, key);
  // Marked before verifying, so a prune that runs meanwhile either sees this use or removes an entry this then recaptures
  const release = useCompilerStoreEntry(entry);
  const previous = capturing.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const existing = await installationAt(entry, sources, options.signal);
    if (existing) return existing;
    let captured = false;
    const lock = await holdExclusiveLockWaiting({
      file: `${entry}.lock`, what: 'compiler installation capture', waitMs: 10 * 60_000,
      refuse: (holder) => new Error(`Another process is capturing this compiler installation (${holder})`),
    });
    try {
      const reused = await installationAt(entry, sources, options.signal);
      if (reused) return reused;
      if (fs.existsSync(entry)) await removeCompilerStoreDirectory(entry);
      await captureInto(entry, sources, options);
      const installation = await installationAt(entry, sources, options.signal);
      if (!installation) {
        await removeCompilerStoreDirectory(entry);
        throw new Error('Captured compiler installation differs from its inputs');
      }
      captured = true;
      return installation;
    } finally {
      lock.release();
      // Only a new entry grows the store, so only a capture prunes it
      if (captured) await pruneCompilerStore(store, entry);
    }
  });
  capturing.set(key, current);
  try {
    const installation = await current;
    let released = false;
    return { ...installation, dispose: async () => { if (!released) { released = true; release(); } } };
  } catch (error) { release(); throw error; }
  finally { if (capturing.get(key) === current) capturing.delete(key); }
}
