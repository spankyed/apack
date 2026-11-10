// Takes a site to the definition it means, from what the syntax says and nothing else. First that answers wins, and
// there is no fuzzy matching: a site none of these reach makes no edge and is counted as unresolved.
import * as nodePath from 'node:path/posix';
import type { ImportBinding, Reexport, Site } from './sites.ts';

export type ResolveStrategy = 'import' | 'same-module';

/**
 * How much an edge from each strategy counts for, its precision against TypeScript's compiler over this repository,
 * opencode and tutanota (2026-11-03, `scripts/code-index-evaluate.ts`). Matching a bare name against the project's
 * definitions read 0 to 12% there, mostly a global such as `Error` linked to a story of that name, so nothing does it.
 */
export const STRATEGY_CONFIDENCE: Readonly<Record<ResolveStrategy, number>> = { import: 0.99, 'same-module': 1 };

export interface DefinitionRef {
  path: string;
  local: string;
}

/** What a resolver can ask of a project: the file table the sync keeps, or a whole index in the evaluation */
export interface ProjectTable {
  hasFile(path: string): boolean;
  /** Whether a file defines exactly this local name at its first ordinal */
  defines(path: string, local: string): boolean;
  reexports(path: string): readonly Reexport[];
  /** The local name of what a file's default export is */
  defaultOf(path: string): string | null;
  /** `package.json` that governs a directory, walking up */
  packageAt(directory: string): PackageInfo | null;
  /** A workspace package by its name */
  packageNamed(name: string): PackageInfo | null;
}

export interface PackageInfo {
  directory: string;
  name?: string;
  imports?: Record<string, unknown>;
  exports?: unknown;
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue'];
const JS_TO_TS: Readonly<Record<string, readonly string[]>> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

function fileAt(table: ProjectTable, candidate: string): string | null {
  if (table.hasFile(candidate)) return candidate;
  const extension = nodePath.extname(candidate);
  for (const replacement of JS_TO_TS[extension] ?? []) {
    const swapped = candidate.slice(0, -extension.length) + replacement;
    if (table.hasFile(swapped)) return swapped;
  }
  for (const added of EXTENSIONS) if (table.hasFile(candidate + added)) return candidate + added;
  for (const added of EXTENSIONS) if (table.hasFile(`${candidate}/index${added}`)) return `${candidate}/index${added}`;
  return null;
}

/** Every path an exports or imports target could mean, in the order conditions would try them, sources first */
function targetPaths(target: unknown): string[] {
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) return target.flatMap(targetPaths);
  if (target && typeof target === 'object') {
    const entries = Object.entries(target as Record<string, unknown>);
    const sources = entries.filter(([condition]) => condition.includes('source'));
    return [...sources, ...entries.filter(entry => !sources.includes(entry))].flatMap(([, value]) => targetPaths(value));
  }
  return [];
}

function matchSubpath(map: Record<string, unknown>, key: string): string[] {
  if (key in map) return targetPaths(map[key]);
  let best: { prefix: string; suffix: string; value: unknown } | undefined;
  for (const [pattern, value] of Object.entries(map)) {
    const star = pattern.indexOf('*');
    if (star === -1) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (key.startsWith(prefix) && key.endsWith(suffix) && (!best || prefix.length > best.prefix.length)) best = { prefix, suffix, value };
  }
  if (!best) return [];
  const middle = key.slice(best.prefix.length, key.length - best.suffix.length);
  return targetPaths(best.value).map(target => target.replaceAll('*', middle));
}

/** The file a module specifier names from a file, or `null` for one outside the project */
export function resolveModule(table: ProjectTable, from: string, specifier: string): string | null {
  const directory = nodePath.dirname(from);
  if (specifier.startsWith('.')) return fileAt(table, nodePath.normalize(nodePath.join(directory, specifier)));
  if (specifier.startsWith('/')) return null;
  const inPackage = (info: PackageInfo, targets: readonly string[]) => {
    for (const target of targets) {
      const found = fileAt(table, nodePath.normalize(nodePath.join(info.directory, target)));
      if (found) return found;
    }
    return null;
  };
  if (specifier.startsWith('#')) {
    const info = table.packageAt(directory);
    return info?.imports ? inPackage(info, matchSubpath(info.imports, specifier)) : null;
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  const info = table.packageNamed(name);
  if (!info) return null;
  const subpath = `.${specifier.slice(name.length)}`;
  const exportsMap = typeof info.exports === 'object' && info.exports !== null && !Array.isArray(info.exports) && Object.keys(info.exports).some(key => key.startsWith('.'))
    ? info.exports as Record<string, unknown>
    : { '.': info.exports };
  return inPackage(info, matchSubpath(exportsMap, subpath));
}

/** The definition a file's export of `name` is, following re-exports */
function followExport(table: ProjectTable, file: string, name: string, seen: Set<string> = new Set()): DefinitionRef | null {
  const key = `${file}\0${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const local = name === 'default' ? table.defaultOf(file) ?? name : name;
  if (table.defines(file, local)) return { path: file, local };
  const reexports = table.reexports(file);
  for (const reexport of reexports) {
    if (reexport.exported !== name) continue;
    const target = resolveModule(table, file, reexport.source);
    if (!target) return null;
    return reexport.imported === '*' ? null : followExport(table, target, reexport.imported, seen);
  }
  if (name === 'default') return null;
  for (const reexport of reexports) {
    if (reexport.exported !== '*') continue;
    const target = resolveModule(table, file, reexport.source);
    const found = target && followExport(table, target, name, seen);
    if (found) return found;
  }
  return null;
}

export interface FileScope {
  path: string;
  imports: ReadonlyMap<string, ImportBinding>;
  /** The local name of the definition a site is in, when it has one */
  callerLocal(site: Site): string | null;
}

export type Resolution =
  | { status: 'resolved'; target: DefinitionRef; strategy: ResolveStrategy }
  /** Names something outside the project: a package, or a global */
  | { status: 'external' }
  /** May well be something in the project, and syntax can't say what */
  | { status: 'unresolved' };

const EXTERNAL: Resolution = { status: 'external' };
const UNRESOLVED: Resolution = { status: 'unresolved' };

export function resolveSite(table: ProjectTable, scope: FileScope, site: Site): Resolution {
  const [head, ...rest] = site.path as [string, ...string[]];
  if (head === '?') return UNRESOLVED;

  if (head === 'this') {
    const caller = scope.callerLocal(site);
    const owner = caller?.includes('.') ? caller.slice(0, caller.lastIndexOf('.')) : null;
    if (owner && rest.length === 1 && table.defines(scope.path, `${owner}.${rest[0]}`)) {
      return { status: 'resolved', target: { path: scope.path, local: `${owner}.${rest[0]}` }, strategy: 'same-module' };
    }
    return UNRESOLVED;
  }

  const binding = scope.imports.get(head);
  if (binding) {
    const file = resolveModule(table, scope.path, binding.source);
    if (!file) return EXTERNAL;
    const named = binding.imported === '*' ? rest[0] : binding.imported;
    if (named === undefined) return UNRESOLVED;
    const remaining = binding.imported === '*' ? rest.slice(1) : rest;
    const exported = followExport(table, file, named);
    if (!exported) return UNRESOLVED;
    if (remaining.length === 0) return { status: 'resolved', target: exported, strategy: 'import' };
    const member = `${exported.local}.${remaining.join('.')}`;
    return table.defines(exported.path, member)
      ? { status: 'resolved', target: { path: exported.path, local: member }, strategy: 'import' }
      : UNRESOLVED;
  }

  const local = site.path.join('.');
  if (table.defines(scope.path, local)) return { status: 'resolved', target: { path: scope.path, local }, strategy: 'same-module' };
  // `x.f()` where `x` is this file's own: something of a type syntax can't read. A bare name it doesn't hold is a global
  return rest.length > 0 && table.defines(scope.path, head) ? UNRESOLVED : EXTERNAL;
}
