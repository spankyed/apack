import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseElfInterpreter, parseElfLibraryCommands, type ElfLibraryEnvironment } from './compiler-elf-libraries.ts';

export interface CompilerElfEnvironment extends ElfLibraryEnvironment {
  readonly loader: string;
  readonly littleEndian: boolean;
  readonly isaLevels: number;
  readonly loadedLibraries: readonly { name: string; file: string }[];
}

export const isElfSystemLibrary = (file: string) => ['/lib/', '/lib64/', '/usr/lib/', '/usr/lib64/'].some(root => file.startsWith(root));

/** Launch-time code injection must be rejected by the parent, before any worker can initialize it. */
export function assertElfLaunchEnvironment(env: NodeJS.ProcessEnv): void {
  let preload: string | undefined;
  try { preload = fs.readFileSync('/etc/ld.so.preload', 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const [variable, references] of [
    ['LD_PRELOAD', env.LD_PRELOAD?.split(/[: ]/).filter(Boolean) ?? []],
    ['LD_AUDIT', env.LD_AUDIT?.split(':').filter(Boolean) ?? []],
    ['/etc/ld.so.preload', preload?.replace(/#[^\n]*/g, '').split(/\s+/).filter(Boolean) ?? []],
  ] as const) {
    for (const reference of references) {
      if (!path.isAbsolute(reference) || !isElfSystemLibrary(path.normalize(reference))
        || !isElfSystemLibrary(fs.realpathSync(reference))) {
        throw new Error(`Cannot launch captured compiler: ${variable} references "${reference}" outside operating-system libraries.`);
      }
    }
  }
}

/** Decode only named loader metadata, never its environment dump (which may contain credentials). */
export function parseElfLoaderDiagnostics(text: string) {
  const values = new Map(text.split('\n').map(line => {
    const equals = line.indexOf('=');
    return [line.slice(0, equals), line.slice(equals + 1)];
  }));
  const invalid = (name: string) => new Error(`Cannot read ELF loader diagnostic "${name}"`);
  const string = (name: string, nullable = false): string => {
    const encoded = values.get(name);
    if (nullable && encoded === '0x0') return '';
    if (!encoded?.startsWith('"') || !encoded.endsWith('"')) throw invalid(name);
    return encoded.slice(1, -1).replace(/\\([0-7]{3}|["\\])/g, (_match, escaped: string) =>
      escaped.length === 3 ? String.fromCharCode(Number.parseInt(escaped, 8)) : escaped);
  };
  const integer = (name: string) => {
    const value = values.get(name);
    if (!value || !/^0x[0-9a-f]+$/i.test(value)) throw invalid(name);
    return BigInt(value);
  };
  const names = string('dl_hwcaps_subdirs').split(':').filter(Boolean);
  const active = integer('dl_hwcaps_subdirs_active');
  const hardwareCapabilities = names.filter((_name, index) => (active & (1n << BigInt(names.length - index - 1))) !== 0n);
  const systemDirectories = [...values.keys()].filter(name => /^path\.system_dirs\[0x[0-9a-f]+\]$/.test(name)).map(name => string(name));
  if (!systemDirectories.length || systemDirectories.some(directory => !path.isAbsolute(directory))) throw invalid('path.system_dirs');
  const isaLevels = values.has('x86.cpu_features.isa_1') ? Number(integer('x86.cpu_features.isa_1')) : 0;
  return { libraryToken: string('dl_dst_lib'), platformToken: string('dl_platform', true), hardwareCapabilities, systemDirectories, isaLevels };
}

/** Query the selected OS interpreter itself; no pack image is passed to or initialized by it. */
export function captureElfLibraryEnvironment(env: NodeJS.ProcessEnv = process.env,
  executable = process.execPath, cwd = process.cwd()): CompilerElfEnvironment {
  assertElfLaunchEnvironment(env);
  const bytes = fs.readFileSync(executable);
  const loader = parseElfInterpreter(bytes);
  if (!isElfSystemLibrary(loader) || !isElfSystemLibrary(fs.realpathSync(loader))) {
    throw new Error(`Cannot inspect compiler ELF interpreter outside operating-system libraries: ${loader}`);
  }
  let diagnostic: string;
  try { diagnostic = execFileSync(loader, ['--list-diagnostics'], { env, cwd, encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 }); }
  catch (error) {
    // execFileSync errors retain stdout; this command includes an environment dump. Never publish it.
    const failure = error as NodeJS.ErrnoException & { signal?: string };
    throw new Error(`Cannot query compiler ELF loader metadata: ${failure.code ?? failure.signal ?? 'loader failed'}`);
  }
  const metadata = parseElfLoaderDiagnostics(diagnostic);
  const report = process.report.getReport() as { sharedObjects?: string[] };
  const loadedLibraries = (report.sharedObjects ?? []).filter(isElfSystemLibrary).flatMap(file => {
    const soname = parseElfLibraryCommands(fs.readFileSync(file)).soname;
    return soname ? [{ name: soname, file }] : [];
  });
  const commands = parseElfLibraryCommands(bytes);
  return Object.freeze({ ...metadata, hardwareCapabilities: Object.freeze(metadata.hardwareCapabilities),
    systemDirectories: Object.freeze(metadata.systemDirectories), loader,
    littleEndian: bytes[5] === 1, loadedLibraries: Object.freeze(loadedLibraries),
    cwd, executable, libraryPaths: Object.freeze(env.LD_LIBRARY_PATH ? env.LD_LIBRARY_PATH.split(/[:;]/) : []),
    executableRpath: Object.freeze(commands.runpath !== undefined || commands.rpath === undefined ? [] : [commands.rpath]),
  });
}
