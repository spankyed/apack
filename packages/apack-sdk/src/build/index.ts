export { _parseModuleReference } from '../framework/module-reference.ts';
export { findSourceModule, SCRIPT_MODULE_EXTENSIONS, TYPE_MODULE_EXTENSIONS } from './source-module.ts';
export { compileHelp } from './help.ts';
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
export { parseContentIndex } from './content-index.ts';
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

// Pack preview types
export type { PackContentPreview, PackContentPreviewItem } from './preview.ts';

// Manifest bridge
export { buildPackConfigFromManifest } from './manifest-bridge.ts';

// Pack manifest types
export type {
  PackManifest, PackTypeManifest, PackSnapshot, PackDependencySnapshot, PackFlowHelpers, PackPermission,
  PackProvenance, ProvenanceKind, ProvenanceManifest, ProvenanceSource,
  PackSystemEntry, PackSurfaceEntry,
  PackFeatureEntry, PackFeature, PackLifecycleConfig, PackMigrationDeclaration, ContentSourceConfig, ContentFormatConfig,
  StepEntry, StepDSLMeta,
} from './manifest.ts';
export { packFeatures, contentFile, contentPath, CONTENT_COMPILERS_FILE, PROVENANCE_KINDS, PACK_SNAPSHOT_FORMAT, _snapshotFormatMismatch, _cliFormatMismatchMessage, type SnapshotFormatMismatch, _mergeProvenance, _buildProvenance, _provenanceRecord } from './manifest.ts';

// Flow DSL helpers (track builders)
export { entry, on } from './flow-helpers.ts';

// Content authoring types
export type { ActionMeta, PromptMeta } from './content-types.ts';

// Entry codegen
export {
  generatePackFiles, GENERATED_ENTITY_DESTINATIONS_FILE, GENERATED_EVENT_CONTRACTS_FILE, emitEARS, mergeRegistries, entitiesWithoutShapes, PACK_TYPES_FACADE, STEPS_BUILD_MODULE,
  _depTypesFile, _depTypesVersion,
} from './generate-entries.ts';
export type { GenerateEntriesOptions } from './generate-entries.ts';

// Resolve conditions for building pack code against a linked checkout

// Pack validation
export { validateManifest, validatePackSources, parseManifest } from './validate.ts';
export { packValidation } from './diagnostics.ts';
export type { PackDiagnostic, SkippedPackCheck, PackValidation } from './diagnostics.ts';
export { generateSettingsTypes } from './settings-types.ts';
export { parseSnapshot, parseDependencySnapshot } from './snapshot.ts';
export { _helpDataProblem } from './help-data.ts';
export { _declarationRevision } from './declaration-revision.ts';
export type { PackSnapshotValidation, PackDependencySnapshotValidation } from './snapshot.ts';

// Manifest schema (Zod — single source of truth for types, validation, and JSON schema generation)
export {
  ManifestSchema, FeatureEntrySchema, FEATURE_ID_PATTERN, _NativePackDeclarationSchema,
  LifecycleConfigSchema, ContentSourceSchema, ContentFormatSchema, StepEntrySchema, StepDSLMetaSchema,
  DslEntrySchema, PackPermissionSchema, MigrationDeclarationSchema, MigrationsSchema, MIGRATION_LINES, LIFECYCLE_HOOK_NAMES, MIGRATION_TARGET_PATTERN,
} from '../framework/declaration-schema.ts';
export type { MigrationLine } from '../framework/declaration-schema.ts';

// FE bundler — not re-exported here (uses import.meta which some
// consumer tsconfigs reject). Import directly from './fe-bundler'.

export { _packEntities, _packEntityTypes, _packShortCodes, _shortCodeTypes, _SHORT_CODE_PATTERN, _packRelationTypes, _packRelationRules, _packRoles, type PackDataDeclarations, type PackEntityDeclaration, type PackRelationDeclaration, type _PackEntityDeclaration } from '../framework/data-declaration.ts';

export { ALLOWABLE_PACK_CHECKS, PackChecksSchema } from '../framework/pack-checks.ts';
export { _namingRefusedValue } from '../framework/refused-value.ts';

export { parsePackDependency, type PackDependencySource } from '../framework/dependency-source.ts';
