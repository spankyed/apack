export { findSourceModule, SCRIPT_MODULE_EXTENSIONS, TYPE_MODULE_EXTENSIONS } from './source-module.ts';
export { compileHelp } from './help.ts';
export { contentPath } from './content-path.ts';

// Types
export type { PackConfig, PackBuildDefinitions, CompilePackOptions, CompilePackResult, PackModuleLoader } from './types.ts';

// Content compiler framework
export { _clearCompiledContent, compilePack, CONTENT_INDEX_FILE } from './content-compiler.ts';
export { compileMarkdownTree, parseMarkdownFile, toDisplayName, type MarkdownItem, type MarkdownTreeOptions } from './content/markdown-tree.ts';
export {
  compileBuiltinFormat, checkRecordEntities, itemLabel, formatEntities, withContentHashes, defaultSourceHash, RECORD_KEYS,
  type ContentItem, type CompiledContentFile, type ContentFieldSource, type ContentFieldSpec, type ContentTreeSpec,
  type ContentCompileContext, type ContentCompilerModule,
} from './content/items.ts';
export { resolveContentSources, type ResolvedContentSource, type ContentDependency, type ContentCompilerModuleRef } from './content/resolve.ts';
export type { SpecialtyCompiler, SpecialtyCompileContext, CompilationContext, ValidationError, ValidationResult, ContentIndex, ContentIndexEntry } from './content-compiler.ts';
export { inspectContentReferences, findContentDependents, type ContentReference, type ContentItemIdentity, type ContentReferenceInspection } from './content-references.ts';

// Compile utilities
export { compileSourceDir, bundleFile, contentHash } from './compile-utils.ts';
export type { CompileConfig, CompiledEntry, CompileResult } from './compile-utils.ts';

// Compilers: standard instances, build utilities, types
export {
  actionsCompiler, promptsCompiler, flowsCompiler, SPECIALTY_COMPILERS,
  loadFlowsFromDir, validateFlows, hashFlows,
  isFlowConfig, resolveTracks,
  validateFlowDSL,
  compileFlowDSL,
  exportFlowsToDSL,
} from './compilers/index.ts';
export type {
  FlowDSL, FlowConfig, Track, DSLNodeBase, DSLStepNode,
  CompilerContext, CompiledRows, ExportFlowsOptions, CompiledContentEntry,
} from './compilers/index.ts';

// Manifest bridge
export { buildPackConfigFromManifest } from './manifest-bridge.ts';

// Entry codegen
export {
  generatePackFiles, GENERATED_ENTITY_DESTINATIONS_FILE, GENERATED_EVENT_CONTRACTS_FILE, emitEARS, mergeRegistries, entitiesWithoutShapes, PACK_TYPES_FACADE, STEPS_BUILD_MODULE, WORKERS_DIR,
  _depTypesFile, _depTypesVersion,
} from './generate-entries.ts';
export type { GenerateEntriesOptions } from './generate-entries.ts';

// Pack validation & settings codegen
export { validateManifest, validatePackSources } from './validate.ts';
export { generateSettingsTypes } from './settings-types.ts';
