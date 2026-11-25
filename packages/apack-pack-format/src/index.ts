// Layout & host compatibility
export { PACK_LAYOUT, PACK_LAYOUT_VERSION, type PackIntegrity } from './layout.ts';
export { isHostCompatible } from './host-compatibility.ts';

// Manifest, snapshot, content index & native declaration schemas + validators
export {
  ManifestSchema, FeatureEntrySchema, FEATURE_ID_PATTERN, _NativePackDeclarationSchema, _EventContractsSchema,
  LifecycleConfigSchema, ContentSourceSchema, ContentFormatSchema, StepEntrySchema, StepDSLMetaSchema,
  DslEntrySchema, PackPermissionSchema, MigrationDeclarationSchema, MigrationsSchema, LIFECYCLE_HOOK_NAMES,
  type _Exact, type _ExactReadonly, type _DeclarationSchemasMatchPlainTypes,
} from './declaration-schema.ts';
export { declarationRecord, declarationRecordGrammar } from './declaration-record.ts';
export { ALLOWABLE_PACK_CHECKS, PackChecksSchema } from './pack-checks.ts';
export { _namingRefusedValue } from './refused-value.ts';
export { parseManifest } from './parse-manifest.ts';
export { parseSnapshot, parseDependencySnapshot, type PackSnapshotValidation, type PackDependencySnapshotValidation } from './snapshot.ts';
export { parseContentIndex, type ContentIndex, type ContentIndexEntry, type ContentItemIdentity, type ContentReference } from './content-index.ts';
export { _nativePackDeclarationProblem } from './native-declarations.ts';
export { _HelpDocumentsSchema, _helpDataProblem } from './help-data.ts';
export { _declarationRevision, sha256Hex } from './declaration-revision.ts';

// Diagnostics
export { diagnosticPath, packValidation, type PackDiagnostic, type SkippedPackCheck, type PackValidation } from './diagnostics.ts';

// Dependency & service selection
export { _PACK_VERSION_PATTERN, _validPackVersion, _validPackRange, parsePackDependency, type PackDependencySource } from './dependency-source.ts';
export { _packServiceSelection } from './service-selection.ts';

// Pure manifest & provenance helpers
export {
  packFeatures, contentFile, CONTENT_COMPILERS_FILE, CONTENT_INDEX_FILE, PROVENANCE_KINDS, PACK_SNAPSHOT_FORMAT,
  _snapshotFormatMismatch, _cliFormatMismatchMessage, _provenanceRecord, _mergeProvenance, _buildProvenance,
  type SnapshotFormatMismatch, type ProvenanceManifest, type ProvenanceSource, type _ProvenanceKindsExact,
  type ContentFormatConfig, type ContentSourceConfig, type DslEntry, type PackDependencySnapshot,
  type PackFeature, type PackFeatureEntry, type PackFlowHelpers, type PackLifecycleConfig, type PackManifest,
  type PackMigrationDeclaration, type PackPermission, type PackProvenance, type PackSnapshot,
  type PackSurfaceEntry, type PackSystemEntry, type PackTypeManifest, type ProvenanceKind,
  type StepDSLMeta, type StepEntry,
} from './manifest.ts';

// Re-export pure migration constants from SDK for schema callers
export { MIGRATION_LINES, MIGRATION_TARGET_PATTERN, type MigrationLine } from '@apackdev/sdk/framework';
