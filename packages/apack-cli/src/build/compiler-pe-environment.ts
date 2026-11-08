import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { win32 as path } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cliPackageDirectory } from './tool-identity.ts';
import { parsePeApiSets, type PeApiSet } from './compiler-pe-api-sets.ts';
import { parsePeLibraryMetadata, readPeSection } from './compiler-pe-libraries.ts';
import { pePath, type CompilerPeSystemPaths } from './compiler-pe-paths.ts';
import { PE_HELPER_TIMEOUT_MS, readPeActivationContext, type CompilerPeActivationContext } from './compiler-pe-activation.ts';

export interface CompilerPeEnvironment extends CompilerPeSystemPaths {
  readonly safeSearch: boolean;
  readonly devOverride: boolean;
  readonly knownDlls: readonly string[];
  readonly apiSets: readonly PeApiSet[];
  readonly schema: string;
  readonly applicationContext: CompilerPeActivationContext;
  readonly nodeApiExports: readonly string[];
}

// The loaded ntdll location is fixed for this process; DLL inventory, policy and PATH remain live.
let systemDirectoryCache: string | undefined;

function peSystemDirectory(libraries: readonly string[]) {
  const ntdll = libraries.find(file => path.basename(file).toLowerCase() === 'ntdll.dll');
  if (!ntdll) throw new Error('Cannot locate the Windows system directory from loaded ntdll');
  return path.dirname(pePath(fs.realpathSync.native(ntdll)));
}

export function readPeSystemDirectory(): string {
  return systemDirectoryCache ?? peSystemDirectory(readPeLoaderMetadata().libraries);
}

/** Query the actual process without Node's unsafe concurrent diagnostic-report generation. */
export function readPeLoaderMetadata(systemDirectory?: string, pid = process.pid, { environment = false } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Windows loader metadata requires a positive process id');
  const owner = cliPackageDirectory(typeof __filename === 'string' ? pathToFileURL(__filename).href : import.meta.url);
  // GLOBALROOT resolves the OS object-manager root, independently of mutable process environment.
  const inspector = systemDirectory ?? systemDirectoryCache;
  const executable = inspector ? path.join(inspector, 'WindowsPowerShell/v1.0/powershell.exe')
    : fs.realpathSync.native(String.raw`\\?\GLOBALROOT\SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe`);
  let metadata: { libraries: string[]; safeSearch: boolean; devOverride: boolean; knownDlls: string[]; environment: NodeJS.ProcessEnv | null };
  try {
    const text = execFileSync(executable,
      ['-NoProfile', '-NonInteractive', '-File', path.join(owner, 'bin/compiler-pe-process.ps1')],
      { input: JSON.stringify({ pid, environment }), encoding: 'utf8', timeout: PE_HELPER_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true });
    metadata = JSON.parse(text.replace(/^\ufeff/, ''));
    if (typeof metadata.safeSearch !== 'boolean' || typeof metadata.devOverride !== 'boolean' || !Array.isArray(metadata.knownDlls)
      || metadata.knownDlls.some(name => typeof name !== 'string' || path.basename(name) !== name)
      || !Array.isArray(metadata.libraries) || !metadata.libraries.length
      || metadata.libraries.some(file => typeof file !== 'string' || !path.isAbsolute(file)
        || !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
      || (environment && (!metadata.environment || typeof metadata.environment !== 'object' || Array.isArray(metadata.environment)
        || Object.entries(metadata.environment).some(([name, value]) => name !== 'PATH' || typeof value !== 'string')))) throw new Error('Invalid metadata');
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { signal?: string };
    throw new Error(`Cannot read Windows compiler loader policy: ${failure.code ?? failure.signal ?? 'invalid OS metadata'}`);
  }
  if (pid === process.pid) systemDirectoryCache = peSystemDirectory(metadata.libraries);
  return metadata;
}

export function readPeProcessState(systemDirectory: string) {
  const metadata = readPeLoaderMetadata(systemDirectory, process.pid, { environment: true });
  return { libraries: metadata.libraries, environment: metadata.environment! };
}

/** Capture loader policy and the default application context before user preloads. */
export function capturePeLibraryEnvironment(executable = process.execPath): CompilerPeEnvironment {
  const { libraries, safeSearch, devOverride, knownDlls } = readPeLoaderMetadata();
  const systemDirectory = peSystemDirectory(libraries);
  const schema = path.join(systemDirectory, 'apisetschema.dll');
  const section = readPeSection(fs.readFileSync(schema), '.apiset');
  if (!section) throw new Error('Windows API-set schema has no .apiset section');
  const applicationContext = readPeActivationContext(executable, { systemDirectory, application: executable, resource: 1 });
  const bytes = fs.readFileSync(executable);
  if (createHash('sha256').update(bytes).digest('hex') !== applicationContext.inputs.find(input => input.file === applicationContext.image)?.hash) {
    throw new Error(`Windows compiler runtime changed while capturing Node-API exports: ${executable}`);
  }
  return Object.freeze({ systemDirectory, windowsDirectory: path.dirname(systemDirectory), safeSearch, devOverride,
    knownDlls: Object.freeze(knownDlls.map(name => name.toLowerCase())), schema, apiSets: parsePeApiSets(section),
    nodeApiExports: Object.freeze(parsePeLibraryMetadata(bytes).exports
      .flatMap(item => item.forwarder ? [] : item.names.filter(name => /^(napi_|node_api_)/.test(name))).sort()),
    applicationContext });
}

export function peLibraryPaths(env: NodeJS.ProcessEnv): string[] {
  const key = Object.keys(env).sort().find(key => key.toUpperCase() === 'PATH');
  return key && env[key] ? env[key]!.split(';').filter(Boolean).map(directory => directory.replace(/^"(.*)"$/, '$1')) : [];
}
