import nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { hash as cryptoHash } from 'node:crypto';
import type { PackageInputFile } from '@apackdev/host/build/package-inputs';
import type { BuildInputObserver } from '@apackdev/host/build/pack-inputs';
import { readPeActivationContext } from './compiler-pe-activation.ts';
import { readPeSystemDirectory, readPeLoaderMetadata } from './compiler-pe-environment.ts';
import { isPeSystemPath, pePath } from './compiler-pe-paths.ts';

// Runtime distributions contain physical ASAR files; Electron's patched fs expands them as directories.
const fs: typeof nodeFs = process.versions.electron ? createRequire(import.meta.url)('original-fs') : nodeFs;

export { fs as compilerRuntimeFileSystem };

interface CompilerRuntimeInputs {
  executable: string;
  directory: string;
  /** Copied files and topology, independent of live OS bindings. */
  contentsHash: string;
  /** Distribution plus this executable's effective selection and OS policy inputs. */
  hash: string;
  directories: string[];
  links: Array<{ source: string; target: string; text: string }>;
}

/** Node needs its executable; Electron also needs its distribution's native libraries and resources.
 * onFile supplies copy bytes; observe also reports uncopied OS selectors and missing candidates.
 */
export function readCompilerRuntimeInputs(
  executable = process.execPath,
  electron = !!process.versions.electron,
  onFile?: (file: PackageInputFile, bytes: Buffer) => void,
  observe?: BuildInputObserver,
): CompilerRuntimeInputs {
  executable = fs.realpathSync.native(executable);
  const root = path.dirname(executable);
  const directories = new Set<string>();
  const links: CompilerRuntimeInputs['links'] = [];
  const files: Array<[string, number, string]> = [];
  const visited = new Set<string>();
  const relative = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const walk = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      const text = fs.readlinkSync(file);
      const target = path.resolve(path.dirname(file), text);
      links.push({ source: file, target, text });
      // Preserve dangling links, without inventing a target's contents.
      if (fs.existsSync(target)) walk(fs.realpathSync.native(target));
    } else if (stat.isDirectory()) {
      directories.add(file);
      for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name));
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(file);
      const hash = cryptoHash('sha256', bytes, 'hex');
      files.push([relative(file), stat.mode & 0o111, hash]);
      onFile?.({ path: relative(file), source: file, mode: stat.mode & 0o777, hash }, bytes);
    } else {
      throw new Error(`Unsupported compiler runtime input: ${file}`);
    }
  };
  walk(executable);
  if (!electron && process.platform === 'win32') {
    const marker = executable + '.local';
    const stat = fs.statSync(marker, { throwIfNoEntry: false });
    if (stat) {
      walk(marker);
      // A file marker redirects any requested basename to the executable directory.
      // A directory marker instead owns its own subtree; unrelated directories are not runtime inputs.
      if (stat.isFile()) {
        directories.add(root);
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          const file = path.join(root, entry.name);
          if (entry.isFile() || (entry.isSymbolicLink() && !fs.statSync(file, { throwIfNoEntry: false })?.isDirectory())) walk(file);
        }
      }
    }
  }
  let activation: unknown;
  if (process.platform === 'win32') {
    const bytes = fs.readFileSync(executable);
    // Inventory still fingerprints opaque/damaged files; launch admission validates executable format.
    if (bytes.length >= 2 && bytes.readUInt16LE(0) === 0x5a4d) {
      const systemDirectory = readPeSystemDirectory();
      const { safeSearch, devOverride, knownDlls } = readPeLoaderMetadata(systemDirectory);
      const environment = { systemDirectory, windowsDirectory: path.dirname(systemDirectory) };
      const context = readPeActivationContext(executable, { systemDirectory, application: executable, resource: 1,
        observe: observe && { read: file => observe(file, 'file'), readEntries: file => observe(file, 'entries') } });
      // Selection inputs include OS policy and missing candidates, independently of files copied below.
      for (const input of context.inputs) observe?.(input.file,
        input.kind === 'entries' ? 'entries' : input.kind === 'directory' ? 'directory' : 'file');
      const within = (file: string) => {
        const value = path.relative(pePath(root), pePath(file));
        return value === '' || (value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value));
      };
      const system = (file: string) => isPeSystemPath(file, environment);
      const own = (file: string) => {
        const stat = fs.lstatSync(file, { throwIfNoEntry: false });
        const physical = stat && fs.existsSync(file) ? fs.realpathSync.native(file) : file;
        if (system(file) && system(physical)) return;
        if (!within(file) || !within(physical)) throw new Error(`Windows runtime context selects "${file}" outside its runtime directory. Use runtime-contained private assemblies or operating-system libraries.`);
        if (stat?.isDirectory()) directories.add(file);
        else { directories.add(path.dirname(file)); if (stat) walk(file); }
      };
      // Absent candidates affect identity without inventing directories in the copied runtime.
      for (const input of context.inputs) if (input.kind !== 'missing') own(input.file);
      for (const binding of context.redirections) if (binding.file) own(binding.file);
      const identity = (file: string) => system(file) ? ['system', pePath(file).toLowerCase()] : ['runtime', relative(file)];
      const ordered = (rows: unknown[]) => rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
      // OS namespace membership invalidates selection even when Windows retains an older binding.
      // Private listings guard inspection; selective copies omit unrelated installation files.
      activation = [ordered(context.inputs.map(input => [identity(input.file), input.kind, input.kind === 'entries' && !system(input.file) ? null : input.hash])),
        ordered(context.redirections.map(binding => [binding.name.toLowerCase(), binding.file ? identity(binding.file) : null])),
        [safeSearch, devOverride, knownDlls.map(name => name.toLowerCase()).sort()]];
    }
  }
  // The macOS executable is inside Contents/MacOS. Keep the signed distribution together,
  // including Info.plist and sealed resources, as on the other Electron platforms.
  if (electron) walk(process.platform === 'darwin' ? path.dirname(root) : root);
  const identity: unknown[] = [relative(executable), files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    [...directories].map(relative).sort(), links.map(({ source, target, text }) => [relative(source), relative(target),
      process.platform === 'win32' || path.isAbsolute(text) ? null : text]).sort()];
  const contentsHash = cryptoHash('sha256', JSON.stringify(identity), 'hex');
  if (activation !== undefined) identity.push(activation);
  return { executable, directory: electron && process.platform === 'darwin' ? path.dirname(root) : root,
    directories: [...directories], links, contentsHash, hash: cryptoHash('sha256', JSON.stringify(identity), 'hex') };
}
