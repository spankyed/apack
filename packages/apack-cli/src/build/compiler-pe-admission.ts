import { win32 as path } from 'node:path';
import { hash as cryptoHash } from 'node:crypto';
import { parsePeLibraryMetadata, type PeImportedSymbol, type PeLibraryMetadata } from './compiler-pe-libraries.ts';
import { resolvePeApiSet } from './compiler-pe-api-sets.ts';
import { peLibraryPaths, type CompilerPeEnvironment } from './compiler-pe-environment.ts';
import { isPeSystemPath, pePath } from './compiler-pe-paths.ts';
import { peDirectoryEntriesHash, type CompilerPeActivationContext, type CompilerPeDirectoryEntry, type CompilerPeInputObserver } from './compiler-pe-activation.ts';

interface CompilerPeImage {
  metadata: PeLibraryMetadata;
  bindings: ReadonlyMap<string, string | null>;
}

/** Node uses LOAD_WITH_ALTERED_SEARCH_PATH: transitive imports share the top image's directory. */
export function assertCapturedPeLibraries(entry: string, packageRoot: string, input: {
  environment: CompilerPeEnvironment;
  executable: string;
  cwd: string;
  variables: NodeJS.ProcessEnv;
  loadedLibraries: readonly string[];
  arch: string;
  read(file: string): Buffer | undefined;
  directoryExists(file: string): boolean;
  readEntries(file: string): readonly CompilerPeDirectoryEntry[] | undefined;
  realpath(file: string): string;
  moduleContext(image: string, observe: CompilerPeInputObserver): CompilerPeActivationContext;
}): void {
  const environment = input.environment;
  const within = (file: string, root: string) => {
    const relative = path.relative(pePath(root), pePath(file));
    return relative === '' || (relative !== '..' && !relative.startsWith('..\\') && !path.isAbsolute(relative));
  };
  const system = (file: string) => isPeSystemPath(file, environment);
  const root = input.realpath(packageRoot);
  const images = new Map<string, CompilerPeImage>();
  const symbols = new Set<string>();
  const refuse = (requester: string, file: string): never => {
    throw new Error(`Native compiler image "${requester}" selects "${file}" outside its captured package. Use package-contained DLLs or operating-system libraries.`);
  };
  const contextBindings = (context: CompilerPeActivationContext, image: string) => {
    if (pePath(context.image).toLowerCase() !== pePath(image).toLowerCase()) throw new Error(`Windows activation context does not match its image: ${image}`);
    for (const selected of context.inputs) {
      if (selected.kind === 'entries') {
        const entries = input.readEntries(selected.file);
        if (!entries || peDirectoryEntriesHash(entries) !== selected.hash) throw new Error(`Windows activation directory changed during inspection: ${selected.file}`);
        continue;
      }
      const bytes = input.read(selected.file);
      const kind = bytes !== undefined ? 'file' : input.directoryExists(selected.file) ? 'directory' : 'missing';
      const hash = bytes === undefined ? null : cryptoHash('sha256', bytes, 'hex');
      if (kind !== selected.kind || hash !== selected.hash) throw new Error(`Windows activation context changed during inspection: ${selected.file}`);
    }
    return new Map(context.redirections.map(binding => [binding.name.toLowerCase(), binding.file]));
  };
  const bindings = contextBindings(environment.applicationContext, input.executable);
  const marker = input.executable + '.local';
  const markerFile = input.read(marker);
  const markerDirectory = input.directoryExists(marker);
  let redirectionDirectory: string | undefined;
  if (markerFile !== undefined || markerDirectory) {
    const externalManifest = input.read(input.executable + '.manifest');
    const executable = input.read(input.executable);
    if (!executable) throw new Error(`Cannot inspect Windows redirection for "${input.executable}"`);
    const embeddedManifest = parsePeLibraryMetadata(executable).manifests.some(manifest => manifest.path[1] === 1);
    if (environment.devOverride || (!embeddedManifest && externalManifest === undefined)) {
      redirectionDirectory = markerDirectory ? marker : path.dirname(input.executable);
    }
  }
  const redirected = (name: string) => {
    if (!redirectionDirectory) return;
    const file = path.join(redirectionDirectory, path.basename(name));
    return input.read(file) !== undefined ? file : undefined;
  };
  const selectedEntry = pePath(entry).toLowerCase() === pePath(input.executable).toLowerCase() ? entry : redirected(entry) ?? entry;
  const read = (file: string, requester: string, inherited: ReadonlyMap<string, string | null>): CompilerPeImage | undefined => {
    // NAPI imports resolve against the running executable, already owned by the installation.
    // Do not record its private copy as another package's source input.
    if (file !== entry && pePath(file).toLowerCase() === pePath(input.executable).toLowerCase()) return;
    const identity = file.toLowerCase();
    const known = images.get(identity);
    if (known) return known;
    const bytes = input.read(file);
    if (bytes === undefined) return;
    const physical = input.realpath(file);
    if (system(file) && system(physical)) return;
    if (!within(file, packageRoot) || !within(physical, root)) refuse(requester, file);
    let metadata: PeLibraryMetadata;
    try { metadata = parsePeLibraryMetadata(bytes); }
    catch (error) { throw new Error(`Cannot inspect native compiler image "${file}"`, { cause: error }); }
    const machine = input.arch === 'x64' ? 0x8664 : input.arch === 'arm64' ? 0xaa64 : input.arch === 'ia32' ? 0x14c : undefined;
    if (metadata.machine !== machine) throw new Error(`Native compiler image "${file}" has no PE code for ${input.arch}`);
    const active = metadata.manifests.some(manifest => manifest.path[1] === 2)
      ? contextBindings(input.moduleContext(file, { read: candidate => input.read(candidate), readEntries: candidate => input.readEntries(candidate) }), file) : inherited;
    const image = { metadata, bindings: active };
    images.set(identity, image);
    for (const imported of metadata.imports) {
      const requested = imported.symbols.map(symbol => {
        if ('boundAddress' in symbol) throw new Error(`Cannot inspect bound-only PE import from "${file}" into "${imported.name}" without its import names`);
        return symbol;
      });
      // node-gyp's delay hook binds this Node-API reference to the running host, even when renamed.
      // A shared libnode host still needs ownership checks; other symbols use ordinary resolution.
      if (imported.delayed && imported.name.toLowerCase() === 'node.exe' && requested.length
        && requested.every(symbol => 'name' in symbol && /^(napi_|node_api_)/.test(symbol.name))) {
        const sharedHost = input.loadedLibraries.find(file => path.basename(file).toLowerCase() === 'libnode.dll');
        if (sharedHost) inspect(sharedHost, requested, file, active);
        else {
          const missing = requested.find(symbol => 'name' in symbol && !environment.nodeApiExports.includes(symbol.name));
          if (missing && 'name' in missing) throw new Error(`Windows compiler host "${input.executable}" does not export Node-API symbol "${missing.name}" requested by "${file}"`);
        }
        continue;
      }
      const target = resolve(imported.name, file, active);
      if (target) inspect(target, requested, file, active);
    }
    return image;
  };
  const resolve = (reference: string, requester: string, active: ReadonlyMap<string, string | null>): string | undefined => {
    let name = reference.replace(/ +$/, '');
    if (!path.extname(name)) name += '.dll';
    const local = redirected(name);
    if (local) return local;
    const mapped = resolvePeApiSet(environment.apiSets, name, path.basename(requester));
    if (mapped !== undefined) {
      if (!mapped) throw new Error(`Native compiler image "${requester}" references unavailable Windows API set "${name}"`);
      name = mapped;
    }
    if (path.basename(name) === name && active.has(name.toLowerCase())) {
      const file = active.get(name.toLowerCase());
      if (!file) throw new Error(`Windows activation context cannot locate native compiler library "${name}" requested by "${requester}"`);
      return file;
    }
    // Copying an image cannot relocate an absolute import encoded in its bytes.
    if (path.isAbsolute(name) && !system(name)) refuse(requester, name);
    const bare = path.basename(name) === name;
    const loaded = [input.executable, ...input.loadedLibraries].find(file => bare && path.basename(file).toLowerCase() === name.toLowerCase());
    if (loaded) return loaded;
    if (bare && environment.knownDlls.includes(name.toLowerCase())) return path.join(environment.systemDirectory, name);
    const systemDirectories = [environment.systemDirectory, path.join(environment.windowsDirectory, 'System'), environment.windowsDirectory];
    const directories = [path.dirname(selectedEntry), ...(environment.safeSearch ? systemDirectories : [input.cwd, ...systemDirectories]),
      ...(environment.safeSearch ? [input.cwd] : []), ...peLibraryPaths(input.variables)];
    const candidates = path.isAbsolute(name) ? [name] : directories.map(directory => path.resolve(input.cwd, directory, name));
    return candidates.find(file => input.read(file) !== undefined);
  };
  const inspect = (file: string, requested: readonly Exclude<PeImportedSymbol, { boundAddress: bigint }>[], requester: string, active: ReadonlyMap<string, string | null>) => {
    const image = read(file, requester, active);
    if (!image) return;
    const { metadata } = image;
    for (const symbol of requested) {
      const key = `${file.toLowerCase()}\0${'name' in symbol ? symbol.name : '#' + symbol.ordinal}`;
      if (symbols.has(key)) continue;
      symbols.add(key);
      const exported = metadata.exports.find(exported => 'name' in symbol ? exported.names.includes(symbol.name) : exported.ordinal === symbol.ordinal);
      if (!exported?.forwarder) continue;
      const split = exported.forwarder.lastIndexOf('.');
      if (split <= 0 || split === exported.forwarder.length - 1) throw new Error(`Invalid PE export forwarder in "${file}"`);
      const name = exported.forwarder.slice(split + 1), target = resolve(exported.forwarder.slice(0, split), file, image.bindings);
      if (name.startsWith('#') && !/^#\d+$/.test(name)) throw new Error(`Invalid PE export ordinal in "${file}"`);
      if (target) inspect(target, [name.startsWith('#') ? { ordinal: Number(name.slice(1)) } : { name }], file, image.bindings);
    }
  };
  // The schema is an input even when this particular addon uses only ordinary DLL names.
  input.read(environment.schema);
  inspect(selectedEntry, [{ name: 'napi_register_module_v1' }, { name: `node_register_module_v${process.versions.modules}` }], entry, bindings);
}
