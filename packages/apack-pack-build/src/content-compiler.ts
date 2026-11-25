import * as fs from 'fs';
import * as path from 'path';
import type { PackConfig, CompilePackOptions, CompilePackResult, PackModuleLoader } from './types.ts';
import type { StepDefinition } from '@apackdev/sdk/steps';
import type { PackContentPreviewItem } from '@apackdev/sdk/framework';
import type { ValidationError, ValidationResult } from '@apackdev/sdk/build';
import { CONTENT_INDEX_FILE, contentFile, parseContentIndex, type ContentIndex, type ContentIndexEntry, type ContentReference } from '@apackdev/pack-format';
import { importPackModule } from './module-loader.ts';
import { EARS } from '@apackdev/sdk/types';
import { COMMANDS_DOCUMENT_TYPE } from '@apackdev/sdk/commands';
import { SPECIALTY_COMPILERS } from './compilers/standard.ts';
import { buildPackConfigFromManifest } from './manifest-bridge.ts';
import { compileMarkdownTree } from './content/markdown-tree.ts';
import {
  checkRecordEntities, compileBuiltinFormat, countRecords, formatEntities, itemLabel, withContentHashes,
  type ContentCompileContext, type ContentCompilerModule, type ContentItem,
} from './content/items.ts';

export type { ContentIndex, ContentIndexEntry, ValidationError, ValidationResult };

// ============================================================================
// Compiler interface
// ============================================================================

export interface CompilationContext {
  /** Another specialty key's compiled data (flows validate against actions and prompts) */
  getCompiled<T = unknown>(key: string): T | undefined;
  /** The step definitions the pack compiles with (flows validate against them) */
  steps: StepDefinition[];
}

export interface SpecialtyCompileContext {
  packDir: string;
  /** The build owner's module loader, shared with formats and step definitions. */
  importModule: PackModuleLoader;
}

/** The SDK's compiler for a specialty content key (actions, prompts, flows, documents, commands) */
export interface SpecialtyCompiler<T = unknown> {
  compile(sourcePath: string, context: SpecialtyCompileContext): Promise<T>;
  /**
   * Hard failures from `compile` that dropped entries. Reported and thrown before validation, so a
   * dropped entry surfaces at its own source rather than as a downstream cross-entry reference error.
   */
  collectErrors?(data: T): string[];
  validate?(data: T, context: CompilationContext): ValidationResult;
  /** What `<key>.content.json` holds; the compiled data itself when omitted */
  output?(data: T): unknown;
  /** The fields an item is matched on when its content key finds nothing; absent for a key matched only by content key */
  identity?: string[];
  /** A directory inside the source whose files are copied to `media/<key>/`, for items that link to them */
  media?: string;
  /** Items compiled, for the build summary */
  count(data: T): number;
  /** The items the import dialog lists, named as include sets name them */
  items(data: T): PackContentPreviewItem[];
  /** Static dependency inspection; absence means analysis is unavailable, never that there are no references. */
  references?(data: T, context: CompilationContext): ContentReference[];
}

export { CONTENT_INDEX_FILE };

// ============================================================================
// Orchestrator
// ============================================================================

/** Ordinary media bytes use the same scoped reads as records; native copying bypasses captured inputs. */
function copyMedia(source: string, destination: string, writeFile: (file: string, bytes: Uint8Array) => void): void {
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) copyMedia(path.join(source, name), path.join(destination, name), writeFile);
    fs.chmodSync(destination, stat.mode);
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    writeFile(destination, fs.readFileSync(source));
    fs.chmodSync(destination, stat.mode);
  } else {
    // Preserve native link/special-file behavior; installed builds still enforce their regular-file layout.
    fs.cpSync(source, destination, { recursive: true });
  }
}

async function loadPackConfig(options: CompilePackOptions): Promise<PackConfig> {
  if (options.packConfig) return options.packConfig;
  const manifestPath = path.join(options.packDir, 'apack.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No apack.json in ${options.packDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return buildPackConfigFromManifest(manifest, options.packDir);
}

/** @internal Removes what compilePack writes, so a key or media dropped from the sources doesn't linger (apack pack build clears it up front) */
export function _clearCompiledContent(outputDir: string): void {
  if (!fs.existsSync(outputDir)) return;
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(contentFile('')) || entry.name === CONTENT_INDEX_FILE)) {
      fs.rmSync(path.join(outputDir, entry.name));
    }
  }
  fs.rmSync(path.join(outputDir, 'media'), { recursive: true, force: true });
}

/** Why a compiler module's output isn't an array of records (`{ entity?, contentHash?, children?, ...fields }`) */
function recordShapeProblems(value: unknown, at: string): string[] {
  const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'an array' : typeof v);
  if (!Array.isArray(value)) return [`${at} is ${kind(value)}, not an array of records`];
  return value.flatMap((record, i): string[] => {
    const where = `${at}[${i}]`;
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      return [`${where} is ${kind(record)}, not a record object`];
    }
    const { entity, contentHash, children } = record as ContentItem;
    return [
      ...(entity !== undefined && typeof entity !== 'string' ? [`${where}.entity isn't a string`] : []),
      ...(contentHash !== undefined && typeof contentHash !== 'string' ? [`${where}.contentHash isn't a string`] : []),
      ...(children !== undefined ? recordShapeProblems(children, `${where}.children`) : []),
    ];
  });
}

/**
 * Compiles a pack's `content.sources` entries into `outputDir`, with the definitions it's given (or its pack config
 * loads): `<key>.content.json` for each entry,
 * `media/<key>/` for entries whose format has media, and `content.json` indexing them. Earlier
 * output there is removed first, including when compiling fails.
 */
export async function compilePack(options: CompilePackOptions): Promise<CompilePackResult> {
  const { packDir, outputDir } = options;
  const writeFile = (file: string, bytes: string | Uint8Array) => {
    fs.writeFileSync(file, bytes);
    options.recordOutput?.(path.resolve(file), bytes);
  };
  _clearCompiledContent(outputDir);
  const importModule = options.importModule ?? importPackModule;
  const log = options.log ?? console.log;
  const packConfig = await loadPackConfig(options);

  const definitions = options.definitions ?? await packConfig.loadDefinitions?.(importModule);

  log(`Compiling pack: ${packConfig.name}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const specialtyData = new Map<string, unknown>();
  const compiled: Array<{ key: string; media?: string; output: unknown; index: ContentIndexEntry }> = [];
  const errors: string[] = [];

  for (const [key, source] of Object.entries(packConfig.sources)) {
    if (source.kind === 'applier') continue; // the pack's applier reads its own sources

    /**
     * The commands the manifest declares: one Document holding one field per command, compiled from the
     * declaration with no source directory to read.
     *
     * **One document per pack**, named by `resolveContentSources` after the pack id. The name is what the
     * user sees wherever documents are shown, and what the merge matches on, so it comes from the id
     * rather than the display name — a display name can be changed, and the content key embeds whatever
     * this is, so a rename would orphan the document and write a second one beside it.
     */
    if (source.kind === 'declared') {
      const records = [{
        entity: EARS.Entity.Document,
        name: source.documentName,
        documentType: COMMANDS_DOCUMENT_TYPE,
        content: [{ type: 'field', fields: source.commands.map(({ name, placeholder }) => ({ key: name, value: placeholder })) }],
      }];
      compiled.push({
        key,
        output: { records },
        index: { key, written: true, identity: ['name'], count: source.commands.length, items: source.commands.map(({ name, placeholder }) => ({ key: name, description: placeholder })) },
      });
      continue;
    }

    const sourcePath = path.resolve(packDir, source.path);
    if (source.kind === 'specialty') {
      const specialty = SPECIALTY_COMPILERS[key];
      if (!fs.existsSync(sourcePath)) throw new Error(`Content "${key}": source path does not exist: ${sourcePath}`);
      const data = await specialty.compile(sourcePath, { packDir, importModule });
      for (const message of specialty.collectErrors?.(data) ?? []) errors.push(`${key}: ${message}`);
      specialtyData.set(key, data);
      compiled.push({
        key,
        ...(specialty.media && { media: path.join(sourcePath, specialty.media) }),
        output: specialty.output ? specialty.output(data) : data,
        index: {
          key,
          written: true,
          ...(specialty.identity && { identity: specialty.identity }),
          count: specialty.count(data),
          items: specialty.items(data),
        },
      });
      continue;
    }

    const { format } = source;
    let records: ContentItem[];
    if (source.compiler) {
      if (!source.compiler.module) {
        throw new Error(`Content "${key}": format "${source.formatRef}" compiles with a module, but its pack's build dir wasn't resolved (build the dependency first)`);
      }
      if (!fs.existsSync(source.compiler.module)) {
        const dependency = source.formatRef.includes(':') ? source.formatRef.split(':')[0] : undefined;
        throw new Error(dependency
          ? `Content "${key}": format "${source.formatRef}" compiles with ${dependency}'s content compilers, but ${source.compiler.module} doesn't exist: build ${dependency} first (apack pack build)`
          : `Content "${key}": compiler module ${source.compiler.module} doesn't exist`);
      }
      const mod = await importModule(source.compiler.module);
      const compile = mod[source.compiler.exportName];
      if (typeof compile !== 'function') {
        throw new Error(`Content "${key}": format "${source.formatRef}" has no compiler export "${source.compiler.exportName}" in ${source.compiler.module}`);
      }
      const context: ContentCompileContext = { key, path: sourcePath, packDir, format, compileMarkdownTree };
      const output: unknown = await (compile as ContentCompilerModule)(context);
      const problems = recordShapeProblems(output, 'output');
      if (problems.length > 0) {
        errors.push(...problems.map((problem) => `${key}: compiler "${source.formatRef}" (${source.compiler!.module}) returned bad records: ${problem}`));
        continue;
      }
      records = withContentHashes(output as ContentItem[]);
    } else {
      records = compileBuiltinFormat(key, format, sourcePath);
    }
    errors.push(...checkRecordEntities(key, format, records));
    // Items are written by the format's applier, or by the source's own pack applier
    const written = formatEntities(format).length > 0 || source.applier !== undefined;
    compiled.push({
      key,
      ...(format.media && { media: path.join(sourcePath, format.media) }),
      output: { records },
      index: {
        key,
        written,
        ...(format.identity && { identity: format.identity }),
        count: countRecords(records),
        items: !written ? [] : records.map((record) => ({
          key: itemLabel(record, format.identity),
          ...(typeof record.description === 'string' && { description: record.description }),
          ...(record.children && { childCount: record.children.length }),
        })),
      },
    });
  }

  if (errors.length > 0) {
    throw new Error(`${errors.length} content source(s) failed to compile:\n${errors.map((e) => `  ✗ ${e}`).join('\n')}`);
  }

  const context: CompilationContext = {
    getCompiled: <T>(key: string) => specialtyData.get(key) as T | undefined,
    steps: definitions?.steps ?? [],
  };
  for (const [key, data] of specialtyData) {
    const compiler = SPECIALTY_COMPILERS[key];
    const result = compiler.validate?.(data, context);
    if (result && !result.valid) {
      throw new Error(`${key} validation errors:\n${result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`);
    }
    if (compiler.references) compiled.find(entry => entry.key === key)!.index.references = compiler.references(data, context);
  }

  const index: ContentIndex = { version: 1, packId: packConfig.name, entries: compiled.map(({ index }) => index) };
  parseContentIndex(index);
  const mediaRoot = path.join(outputDir, 'media');
  for (const { key, media, output, index } of compiled) {
    writeFile(path.join(outputDir, contentFile(key)), `${JSON.stringify(output, null, 2)}\n`);
    if (media && fs.existsSync(media)) copyMedia(media, path.join(mediaRoot, key), writeFile);
    log(`  ${key}: ${index.count}`);
  }
  writeFile(path.join(outputDir, CONTENT_INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);

  return { counts: Object.fromEntries(compiled.map(({ key, index }) => [key, index.count])), warnings: [] };
}
