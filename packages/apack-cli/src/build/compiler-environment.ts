import { hash } from 'node:crypto';
import path from 'node:path';
import { compilerSourcePath, type CompilerPathMapping } from '@apackdev/host/build/compiler-inputs';
import type { CompilerLibraryEnvironment } from './compiler-native-libraries.ts';

// These select private transport/cache locations, not authored compiler inputs.
const PRIVATE_ENVIRONMENT = new Set([
  'NODE_OPTIONS', 'TMPDIR', 'TMP', 'TEMP', 'ELECTRON_RUN_AS_NODE', 'TSX_DISABLE_CACHE',
  'APACK_BUILD_WORKER', 'APACK_FRONTEND_WORKER', 'APACK_FRONTEND_DIRECTORY',
  'APACK_COMPILER_INPUTS', 'APACK_COMPILER_NODE_OPTIONS', 'APACK_COMPILER_PROCESS_GROUP',
  'APACK_BUILD_INPUTS_DIRECTORY', 'APACK_BUILD_INPUTS_IPC', 'APACK_NO_BUILD_READS',
]);

/** Record initial environment influence without storing values or private capture locations. */
export function compilerEnvironmentIdentity(env: NodeJS.ProcessEnv = process.env, paths: readonly CompilerPathMapping[] = []): string {
  const entries = Object.entries(env).filter(([key, value]) => value !== undefined && !PRIVATE_ENVIRONMENT.has(key))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => [key, paths.reduce((value, { captured, source }) => value === captured ? source
      : value.split(captured + path.sep).join(path.join(source, path.sep)), value!)]);
  return hash('sha256', JSON.stringify(entries), 'hex');
}


/** Canonical captured loader state; ordered search paths retain their precedence. */
export function compilerLibraryEnvironmentIdentity(environment: CompilerLibraryEnvironment, paths: readonly CompilerPathMapping[] = []): string {
  const sourcePath = (value: string) => path.isAbsolute(value) ? compilerSourcePath(value, paths) : value;
  const normalize = (value: unknown): unknown => {
    if (typeof value === 'string') return sourcePath(value);
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, normalize(entry)]));
    return value;
  };
  const pe = environment.pe;
  const normalized = normalize({ ...environment, pe: pe && { ...pe,
    knownDlls: [...pe.knownDlls].sort(), nodeApiExports: [...pe.nodeApiExports].sort(),
    applicationContext: { ...pe.applicationContext,
      inputs: [...pe.applicationContext.inputs].sort((a, b) => sourcePath(a.file) < sourcePath(b.file) ? -1 : sourcePath(a.file) > sourcePath(b.file) ? 1 : 0),
      redirections: [...pe.applicationContext.redirections].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    },
  } });
  return hash('sha256', JSON.stringify(normalized), 'hex');
}
