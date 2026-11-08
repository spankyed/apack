import fs from 'node:fs';
import { win32 as path } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parsePeLibraryMetadata } from './compiler-pe-libraries.ts';
import { pePath } from './compiler-pe-paths.ts';
import { cliPackageDirectory } from './tool-identity.ts';
import { withoutCompilerFileReads } from '@apackdev/host/build/compiler-inputs';

/**
 * How long a Windows metadata helper may run before it counts as hung. Each call starts PowerShell and compiles
 * the helper's C# with `Add-Type`, a cost set by the machine rather than the query: a cold hosted runner passes
 * five seconds. So this bounds a hang and asserts nothing about speed.
 */
export const PE_HELPER_TIMEOUT_MS = 60_000;

export interface CompilerPeActivationInput {
  readonly file: string;
  readonly kind: 'file' | 'directory' | 'missing' | 'entries';
  readonly hash: string | null;
}

export interface CompilerPeActivationContext {
  readonly image: string;
  readonly inputs: readonly CompilerPeActivationInput[];
  readonly redirections: readonly { name: string; file: string | null }[];
}

export interface CompilerPeDirectoryEntry { readonly name: string; readonly kind: 'file' | 'directory' | 'link' | 'other' }

export function peDirectoryEntriesHash(entries: readonly CompilerPeDirectoryEntry[]): string {
  const value = [...entries].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map(entry => entry.kind + '\0' + entry.name + '\0').join('');
  return createHash('sha256').update(value).digest('hex');
}

/** Live OS metadata; the caller separately records source namespace ownership. */
export function readPeDirectoryEntries(file: string): CompilerPeDirectoryEntry[] | undefined {
  return withoutCompilerFileReads(() => {
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) return;
    return fs.readdirSync(file, { withFileTypes: true }).map<CompilerPeDirectoryEntry>(entry => ({ name: entry.name,
      kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'link' : 'other' }));
  });
}

export interface CompilerPeInputObserver {
  read(file: string): unknown;
  readEntries(file: string): unknown;
}

function isActivationInput(value: unknown): value is CompilerPeActivationInput {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.file === 'string' && path.isAbsolute(item.file) && !item.file.includes('\0')
    && typeof item.kind === 'string' && ['file', 'directory', 'missing', 'entries'].includes(item.kind)
    && (item.kind === 'file' || item.kind === 'entries'
      ? typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash) : item.hash === null);
}

/** Query an executable or DLL context without initializing native pack code. */
export function readPeActivationContext(image: string, { systemDirectory, application, resource, observe }: {
  systemDirectory: string; application: string; resource: 1 | 2; observe?: CompilerPeInputObserver;
}): CompilerPeActivationContext {
  image = pePath(image);
  const inputs: CompilerPeActivationInput[] = [];
  const read = (file: string) => {
    observe?.read(file);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    const bytes = stat?.isFile() ? fs.readFileSync(file) : undefined;
    inputs.push({ file, kind: bytes !== undefined ? 'file' : stat?.isDirectory() ? 'directory' : 'missing',
      hash: bytes === undefined ? null : createHash('sha256').update(bytes).digest('hex') });
    return bytes;
  };
  const bytes = read(image);
  if (!bytes) throw new Error(`Cannot inspect Windows activation image "${image}"`);
  const manifests = parsePeLibraryMetadata(bytes).manifests.filter(item => item.path[1] === resource);
  const external = resource === 1 ? read(image + '.manifest') : undefined;
  const configuration = image + (resource === 1 ? '.config' : '.2.config');
  read(configuration);
  if (!manifests.length && external === undefined) return { image, inputs, redirections: [] };
  try {
    const payload = JSON.stringify({ image, application, resource, configuration, inputs, manifests: manifests.map(item => item.bytes.toString('base64')),
      external: external?.toString('base64') }).replace(/[\u007f-\uffff]/g, value => '\\u' + value.charCodeAt(0).toString(16).padStart(4, '0'));
    const owner = cliPackageDirectory(typeof __filename === 'string' ? pathToFileURL(__filename).href : import.meta.url);
    const text = execFileSync(path.join(systemDirectory, 'WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-File', path.join(owner, 'bin/compiler-pe-context.ps1')],
      { input: payload, encoding: 'utf8', timeout: PE_HELPER_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
    const value = JSON.parse(text.replace(/^\ufeff/, '')) as CompilerPeActivationContext & { error?: number };
    if (typeof value.error === 'number') {
      if (!Array.isArray(value.inputs) || value.inputs.some(item => !isActivationInput(item))) {
        throw new Error('Invalid OS refusal metadata');
      }
      for (const input of value.inputs) {
        if (input.kind === 'entries') observe?.readEntries(input.file);
        else observe?.read(input.file);
      }
      throw Object.assign(new Error('OS context refusal'), { code: `Win32 ${value.error}` });
    }
    if (value.image !== image || !Array.isArray(value.inputs) || !Array.isArray(value.redirections)
      || value.inputs.some(item => !isActivationInput(item))
      || inputs.some(expected => !value.inputs.some(item => item.file === expected.file && item.kind === expected.kind && item.hash === expected.hash))
      || value.redirections.some(item => !item || typeof item.name !== 'string' || !item.name
        || (item.file !== null && (typeof item.file !== 'string' || !path.isAbsolute(item.file))))) throw new Error('Invalid OS metadata');
    if (new Set(value.inputs.map(item => pePath(item.file).toLowerCase())).size !== value.inputs.length
      || new Set(value.redirections.map(item => item.name.toLowerCase())).size !== value.redirections.length) throw new Error('Duplicate OS metadata');
    return value;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number; signal?: string };
    throw new Error(`Cannot inspect Windows activation context for "${image}": ${failure.code ?? failure.signal ?? failure.status ?? 'invalid OS metadata'}`);
  }
}
