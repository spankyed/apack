import { hash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { encodeCompilerObservation } from './compiler-observations.ts';

export type CompilerMetadataKind = 'stat' | 'lstat' | 'realpath' | 'realpathNative' | 'readlink' | 'access' | 'exists';
type NativeOperation = (...args: never[]) => unknown;

/** Keep the native operations before scoped adapters replace the public builtin exports. */
export const compilerMetadataOperations: Record<CompilerMetadataKind, {
  sync: NativeOperation; callback?: NativeOperation; promise?: NativeOperation;
}> = {
  stat: { sync: fs.statSync, callback: fs.stat, promise: fs.promises.stat },
  lstat: { sync: fs.lstatSync, callback: fs.lstat, promise: fs.promises.lstat },
  realpath: { sync: fs.realpathSync, callback: fs.realpath, promise: fs.promises.realpath },
  realpathNative: { sync: fs.realpathSync.native, callback: fs.realpath.native },
  readlink: { sync: fs.readlinkSync, callback: fs.readlink, promise: fs.promises.readlink },
  access: { sync: fs.accessSync, callback: fs.access, promise: fs.promises.access },
  exists: { sync: fs.existsSync },
};

type MetadataOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

const nativeReadFile = fs.readFileSync;

/**
 * Stat fields that say when a file was touched rather than what it holds. A compiler reading one — Tailwind
 * and Vite key their caches on `mtimeMs` — is asking whether the file's bytes changed, so where the file is
 * a regular file the fact records its content hash: touching an unchanged file leaves a build current, and
 * a record replays on a checkout whose times differ. The compiler still sees the real time.
 */
const TIME_FIELDS: ReadonlySet<PropertyKey> = new Set(['atime', 'mtime', 'ctime', 'birthtime']
  .flatMap(field => [field, `${field}Ms`, `${field}Ns`]));

const contentDigest = (file: string): string | undefined => {
  try { return hash('sha256', nativeReadFile(file), 'hex'); }
  catch { return undefined; }
};

export function copyCompilerValue<T>(value: T): T {
  if (!value || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) if ('value' in descriptor) descriptor.value = copyCompilerValue(descriptor.value);
  const copy = value instanceof Error
    ? value instanceof TypeError ? new TypeError(value.message) : value instanceof RangeError ? new RangeError(value.message) : new Error(value.message)
    : Object.create(Object.getPrototypeOf(value));
  Object.setPrototypeOf(copy, Object.getPrototypeOf(value));
  return Object.defineProperties(copy, descriptors);
}

export function compilerErrorValue(error: unknown, project: (file: string) => string = file => file): unknown {
  if (!(error instanceof Error)) return copyCompilerValue(error);
  const value = Object.fromEntries(Object.getOwnPropertyNames(error)
    .filter(key => key !== 'stack').map(key => [key, copyCompilerValue(Reflect.get(error, key))]));
  for (const key of ['path', 'dest']) {
    const file = value[key];
    if (typeof file !== 'string' || !path.isAbsolute(file)) continue;
    value[key] = project(file);
    if (typeof value.message === 'string') value.message = value.message.split(file).join(String(value[key]));
  }
  return value;
}

const valueKey = encodeCompilerObservation;
function outcomeKey(outcome: MetadataOutcome): string {
  return valueKey(outcome.ok ? { ok: true, value: outcome.value } : { ok: false, error: compilerErrorValue(outcome.error) });
}

/** One native query owns its value; stat validation follows the fields actually consumed. */
export function captureCompilerMetadata(kind: CompilerMetadataKind, file: string, args: readonly unknown[], initial?: { value: unknown }) {
  const options = args.map(arg => arg && typeof arg === 'object' ? { ...arg } : arg);
  const read = (): MetadataOutcome => {
    try { return { ok: true, value: Reflect.apply(compilerMetadataOperations[kind].sync, fs, [file, ...options]) }; }
    catch (error) { return { ok: false, error }; }
  };
  const outcome: MetadataOutcome = initial ? { ok: true, value: copyCompilerValue(initial.value) } : read();
  const fields = new Set<PropertyKey>();
  const isStats = outcome.ok && (kind === 'stat' || kind === 'lstat') && outcome.value !== undefined;
  const stats = outcome.ok && isStats ? outcome.value as fs.Stats : undefined;
  const isRegularFile = stats?.isFile?.() === true;
  /** The file's bytes when a time field was first read, which is what a time fact stands for */
  let contentAtRead: string | undefined;
  const contentIdentified = (key: PropertyKey) => isRegularFile && TIME_FIELDS.has(key);
  const fieldFact = (key: PropertyKey): unknown => contentIdentified(key)
    ? { contentSha256: contentAtRead ?? null }
    : copyCompilerValue(Reflect.get(stats!, key));
  return {
    facts(project: (file: string) => string = file => file): Array<readonly [query: readonly string[], value: unknown]> {
      if (isStats) return [
        [['outcome'], { ok: true, stats: true }],
        ...[...fields].sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
          .map(key => [['field', String(key)], fieldFact(key)] as const),
      ];
      let value = outcome.ok ? copyCompilerValue(outcome.value) : compilerErrorValue(outcome.error, project);
      if (outcome.ok && ['realpath', 'realpathNative', 'readlink'].includes(kind)) {
        const file = Buffer.isBuffer(value) ? value.toString() : value;
        if (typeof file === 'string' && path.isAbsolute(file)) value = Buffer.isBuffer(value) ? Buffer.from(project(file)) : project(file);
      }
      return [[['outcome'], { ok: outcome.ok, value }]];
    },
    value() {
      if (!outcome.ok) throw copyCompilerValue(outcome.error);
      const copy = copyCompilerValue(outcome.value);
      if (!isStats) return copy;
      const getters = new Map<PropertyKey, () => unknown>();
      for (const key of Reflect.ownKeys(copy as object)) {
        const descriptor = Object.getOwnPropertyDescriptor(copy, key)!;
        if (!('value' in descriptor)) continue;
        let value: unknown = descriptor.value;
        let mutated = false;
        const get = () => {
          if (!mutated) {
            fields.add(key);
            if (contentIdentified(key)) contentAtRead ??= contentDigest(file);
          }
          return value;
        };
        getters.set(key, get);
        Object.defineProperty(copy, key, { configurable: descriptor.configurable, enumerable: descriptor.enumerable, get,
          ...(descriptor.writable && { set(next: unknown) { mutated = true; value = next; } }) });
      }
      Object.defineProperty(copy, inspect.custom, { configurable: true, value() {
        const descriptors = Object.getOwnPropertyDescriptors(copy);
        Reflect.deleteProperty(descriptors, inspect.custom);
        for (const key of Reflect.ownKeys(descriptors)) {
          const descriptor = Reflect.get(descriptors, key) as PropertyDescriptor;
          if (descriptor.get === getters.get(key)) Reflect.set(descriptors, key, {
            configurable: descriptor.configurable, enumerable: descriptor.enumerable, writable: true, value: Reflect.get(copy as object, key),
          });
        }
        return Object.create(Object.getPrototypeOf(copy), descriptors);
      } });
      return copy;
    },
    assertCurrent() {
      const current = read();
      if (!current.ok || !isStats) return outcomeKey(current) === outcomeKey(outcome);
      if (!current.value || typeof current.value !== 'object') return false;
      return fields.size === 0 || [...fields].every(key => contentIdentified(key)
        ? (current.value as fs.Stats).isFile?.() === true && contentDigest(file) === contentAtRead
        : valueKey(Reflect.get(current.value as object, key)) === valueKey(Reflect.get(outcome.value as object, key)));
    },
  };
}
