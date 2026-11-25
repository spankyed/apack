import * as path from 'node:path';
import { hasOwn } from '../../utils/shared.ts';
import { DECLARED_COMMANDS_KEY, SPECIALTY_CONTENT_KEYS, type ContentEditPolicy } from '../../framework/declaration-types.ts';
import { CONTENT_COMPILERS_FILE, type PackManifest, type ContentFormatConfig } from '../manifest.ts';

/** What resolving a dependency's formats needs: its manifest, and its build dir for compiler modules */
export interface ContentDependency {
  manifest: PackManifest;
  /** The dependency's build dir, holding content-compilers.mjs (absent when only settings are resolved) */
  buildDir?: string;
}

/** Where a format's compiler module loads from, and which export compiles */
export interface ContentCompilerModuleRef {
  /** Absolute module path: the pack's own source module, or a dependency's content-compilers.mjs (unknown without its build dir) */
  module?: string;
  exportName: string;
}

/** A `content.sources` entry with its format's settings */
export type ResolvedContentSource =
  | { kind: 'specialty'; path: string; onUserEdit?: ContentEditPolicy }
  /**
   * The commands a manifest declares, which have no path: the records come from the declaration itself.
   * Synthesized under `DECLARED_COMMANDS_KEY` — the pack writes no `content.sources` entry for it.
   */
  | {
    kind: 'declared';
    /** The document the commands are written into, named here because this is where the pack id is known */
    documentName: string;
    commands: Array<{ name: string; placeholder: string }>;
    onUserEdit?: ContentEditPolicy;
  }
  | { kind: 'applier'; applier: string }
  | {
    kind: 'format';
    onUserEdit?: ContentEditPolicy;
    /** Source path, relative to the writing pack */
    path: string;
    /** The format reference as written: `name` or `pack:name` */
    formatRef: string;
    format: ContentFormatConfig;
    /** Set when the format compiles with a compiler module */
    compiler?: ContentCompilerModuleRef;
    /** The pack module writing the compiled items instead of the format applier */
    applier?: string;
  };

const FORMAT_REF = /^(?:([a-z][a-z0-9-]*):)?([a-z][a-z0-9-]*)$/;

/**
 * Resolves each `content.sources` entry: specialty keys to their path, pack appliers to their module, and
 * format entries (with their pack applier, if any) to the settings of the format they name, in this pack's `content.formats` or a
 * dependency's. A dependency's compiler module is its bundled content-compilers.mjs export.
 */
export function resolveContentSources(
  manifest: PackManifest,
  packDir: string,
  dependencies: ReadonlyMap<string, ContentDependency> = new Map(),
  section: 'sources' | 'datasets' = 'sources',
): Record<string, ResolvedContentSource> {
  const resolved: Record<string, ResolvedContentSource> = {};
  if (section === 'sources') {
    const declared = declaredCommands(manifest, dependencies);
    if (declared) resolved[DECLARED_COMMANDS_KEY] = declared;
  }
  for (const [key, entry] of Object.entries(manifest.content?.[section] ?? {})) {
    if (key === DECLARED_COMMANDS_KEY) {
      throw new Error(`Content "${key}" is the key the commands in extensions.commands compile under: declare them there, or name this source something else`);
    }
    if (SPECIALTY_CONTENT_KEYS.includes(key)) {
      const sourcePath = typeof entry === 'string' ? entry : entry.path;
      if (!sourcePath) throw new Error(`Content "${key}": give its source as a path`);
      resolved[key] = { kind: 'specialty', path: sourcePath, ...(typeof entry === 'object' && entry.onUserEdit && { onUserEdit: entry.onUserEdit }) };
    } else if (typeof entry === 'string') {
      throw new Error(`Unknown content key "${key}": only ${SPECIALTY_CONTENT_KEYS.join(', ')} take a path`);
    } else if (entry.applier && entry.path === undefined && entry.format === undefined) {
      resolved[key] = { kind: 'applier', applier: entry.applier };
    } else {
      if (!entry.path || !entry.format) throw new Error(`Content "${key}" must be { "path", "format" }, optionally with "applier", or { "applier" }`);
      const found = resolveFormat(key, entry.format, manifest, packDir, dependencies);
      /**
       * **A source whose format writes no entity is a dataset, and says so.** Compiled, indexed, given an
       * applier that could only find nothing to do — the contradiction `content.datasets` exists to close,
       * so the two sections are kept apart here rather than left to produce a key that does nothing.
       */
      const writesNothing = found.format.entity === undefined;
      if (section === 'sources' && !entry.applier && writesNothing) {
        throw new Error(`Content "${key}": format "${entry.format}" declares no entity, so nothing is written — declare it under content.datasets instead`);
      }
      if (section === 'datasets' && !writesNothing) {
        throw new Error(`Dataset "${key}": format "${entry.format}" declares an entity, so it is content — declare it under content.sources instead`);
      }
      resolved[key] = {
        kind: 'format', path: entry.path, formatRef: entry.format,
        ...(entry.onUserEdit && { onUserEdit: entry.onUserEdit }),
        ...found,
        ...(entry.applier && { applier: entry.applier }),
      };
    }
  }
  return resolved;
}

function resolveFormat(
  key: string,
  ref: string,
  manifest: PackManifest,
  packDir: string,
  dependencies: ReadonlyMap<string, ContentDependency>,
): { format: ContentFormatConfig; compiler?: ContentCompilerModuleRef } {
  const [, pack, name] = FORMAT_REF.exec(ref) ?? [];
  if (!name) throw new Error(`Content "${key}": "${ref}" isn't a format name or "<dependency id>:<name>"`);

  if (pack === undefined) {
    const formats = manifest.content?.formats ?? {};
    const format = hasOwn(formats, name) ? formats[name] : undefined;
    if (!format) throw new Error(`Content "${key}": no format "${name}" in content.formats`);
    return { format, ...(format.compiler && { compiler: { module: path.resolve(packDir, format.compiler), exportName: 'default' } }) };
  }

  const dependency = dependencies.get(pack);
  if (!dependency) throw new Error(`Content "${key}": format "${ref}" names "${pack}", which isn't a resolved dependency`);
  const formats = dependency.manifest.content?.formats ?? {};
  const format = hasOwn(formats, name) ? formats[name] : undefined;
  if (!format) throw new Error(`Content "${key}": dependency "${pack}" has no format "${name}"`);
  if (!format.compiler) return { format };
  return { format, compiler: { ...(dependency.buildDir && { module: path.join(dependency.buildDir, CONTENT_COMPILERS_FILE) }), exportName: name } };
}

/**
 * `extensions.commands` as a content source, or none when the pack declares no commands.
 *
 * **A name a dependency already declares is refused here**, which is what is left of the loud collision
 * the old `extensions.commands` had. A dependency's names are knowable at build time, from the manifest
 * resolution this function already has, so the pack author hears about it while building rather than
 * finding their command quietly losing a first-wins race in someone's database. Across packs that know
 * nothing of each other it stays first-wins, because nothing at build time can see them both.
 */
function declaredCommands(
  manifest: PackManifest,
  dependencies: ReadonlyMap<string, ContentDependency>,
): Extract<ResolvedContentSource, { kind: 'declared' }> | undefined {
  const declaration = manifest.extensions?.commands;
  if (!declaration) return undefined;
  const { onUserEdit, list } = declaration;

  const fromDependencies = new Map<string, string>();
  for (const [id, dependency] of dependencies) {
    for (const name of Object.keys(dependency.manifest.extensions?.commands?.list ?? {})) {
      if (!fromDependencies.has(name)) fromDependencies.set(name, id);
    }
  }

  const commands = Object.entries(list).map(([name, value]) => {
    const owner = fromDependencies.get(name);
    if (owner !== undefined) {
      throw new Error(`Command "${name}": dependency "${owner}" already declares it — a dependency's commands are already in the app, so rename yours`);
    }
    return { name, placeholder: (value as { placeholder: string }).placeholder };
  });
  return { kind: 'declared', documentName: `${manifest.id} commands`, commands, ...(onUserEdit && { onUserEdit }) };
}
