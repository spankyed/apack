import { _entityDestinationsProblem } from '../framework/surface-declaration.ts';
import { SDK_ENTITIES } from '../types/sdk-entities.ts';
import { dslDefinitionsProblem } from '../framework/dsl-declarations.ts';
import { declarationRecord } from '../framework/declaration-record.ts';
import { z } from 'zod';
import { ManifestSchema, _EventContractsSchema } from '../framework/declaration-schema.ts';
import { _eventContractsProblem } from '../framework/event-contracts.ts';
import { PACK_SNAPSHOT_FORMAT, PROVENANCE_KINDS, _snapshotFormatMismatch, type PackSnapshot, type PackDependencySnapshot, type ProvenanceKind } from './manifest.ts';
import { diagnosticPath, packValidation, type PackValidation } from './diagnostics.ts';
import { _declarationRevision } from './declaration-revision.ts';
import { _HelpDocumentsSchema, _helpDataProblem } from './help-data.ts';
import { _namingRefusedValue } from '../framework/refused-value.ts';

/** The complete compiled snapshot; executable pack modules are never needed to validate it. */
const SnapshotShape = {
  declarationRevision: z.string().regex(/^[a-f0-9]{64}$/, 'Must be a SHA-256 declaration revision'),
  format: z.number().int().nonnegative(),
  sdkVersion: z.string().optional(),
  manifest: ManifestSchema,
  help: _HelpDocumentsSchema.optional(),
  dslDefinitions: declarationRecord(z.string()).optional(),
  types: z.object({ entities: declarationRecord(z.string()), relKinds: declarationRecord(z.string()), roles: declarationRecord(z.string()) }).strict(),
  facades: declarationRecord(z.string().regex(/^[a-z][a-z0-9-]*$/, 'Facade names must be lowercase identifiers with hyphens, suitable for cache filenames'), z.string()),
  entityDestinations: declarationRecord(z.string().min(1), z.string().min(1)),
  eventContracts: _EventContractsSchema.optional(),
  provenance: declarationRecord(z.enum(Object.keys(PROVENANCE_KINDS) as [ProvenanceKind, ...ProvenanceKind[]]), declarationRecord(z.string())).optional(),
  flowHelpers: z.object({ exports: z.array(z.string()), module: z.string(), types: z.string() }).strict().optional(),
} satisfies Record<keyof PackSnapshot, z.ZodTypeAny>;
const SnapshotSchema: z.ZodType<PackSnapshot, unknown> = z.object(SnapshotShape).strict();
const DependencySnapshotSchema: z.ZodType<PackDependencySnapshot, unknown> = z.object({
  ...SnapshotShape, format: SnapshotShape.format.optional(),
}).strict();

export type PackSnapshotValidation = PackValidation & { snapshot?: PackSnapshot };

/** Validate data before any consumer reads declarations or resolves executable bindings. */
export function parseSnapshot(raw: unknown): PackSnapshotValidation {
  const mismatch = _snapshotFormatMismatch(raw);
  if (mismatch) return packValidation([{
    code: 'snapshot.format', severity: 'error', path: ['format'], source: 'snapshot.json',
    message: `${mismatch.problem}; this reader requires format ${PACK_SNAPSHOT_FORMAT}`,
    suggestion: mismatch.newer ? 'Update apack to use this build' : 'Rebuild with the matching apack CLI',
  }]);
  return parseSnapshotData(raw, SnapshotSchema);
}

/** Current-contract type data and diagnostic context, independent of execution eligibility. */
export type PackDependencySnapshotValidation = PackValidation & { snapshot?: PackDependencySnapshot };

/** Validate the current type-data contract without converting fields or inventing an execution stamp. */
export function parseDependencySnapshot(raw: unknown): PackDependencySnapshotValidation {
  const result = parseSnapshotData(raw, DependencySnapshotSchema);
  if (!result.snapshot) return result;
  const mismatch = _snapshotFormatMismatch(result.snapshot);
  return mismatch ? { ...result, diagnostics: [...result.diagnostics, {
    code: 'dependency.format', severity: 'warning', path: ['format'], source: 'snapshot.json',
    message: `${mismatch.problem}; type-data use depends on consumed facade capabilities; execution requires format ${PACK_SNAPSHOT_FORMAT}`,
  }] } : result;
}

function parseSnapshotData<T extends PackDependencySnapshot>(raw: unknown, schema: z.ZodType<T, unknown>): PackValidation & { snapshot?: T } {
  const result = schema.safeParse(raw, { error: _namingRefusedValue });
  if (!result.success) return packValidation(result.error.issues.map(issue => ({
    code: `snapshot.${issue.code}`, severity: 'error', path: diagnosticPath(issue.path), source: 'snapshot.json',
    message: `snapshot.json ${issue.path.join('.') || 'root'}: ${issue.message}`,
  })));
  const snapshot = result.data;
  const eventsProblem = _eventContractsProblem(snapshot.eventContracts, snapshot.manifest.features);
  if (eventsProblem) return packValidation([{ code: 'snapshot.eventContracts', severity: 'error',
    path: ['eventContracts'], source: 'snapshot.json', message: `${eventsProblem}; rebuild the complete pack` }]);
  const destinationProblem = _entityDestinationsProblem(snapshot.entityDestinations, snapshot.manifest.features,
    new Set([...Object.values(SDK_ENTITIES), ...Object.keys(snapshot.types.entities)]));
  if (destinationProblem) return packValidation([{ code: 'snapshot.entityDestinations', severity: 'error',
    path: ['entityDestinations'], source: 'snapshot.json', message: destinationProblem }]);
  const dslProblem = dslDefinitionsProblem(snapshot.manifest.extensions?.dsl, snapshot.dslDefinitions);
  if (dslProblem) return packValidation([{
    code: 'snapshot.dslDefinitions', severity: 'error', path: ['dslDefinitions'], source: 'snapshot.json', message: dslProblem,
  }]);
  if (snapshot.manifest.extensions?.help && snapshot.help === undefined) return packValidation([{
    code: 'snapshot.help.incomplete', severity: 'error', path: ['help'], source: 'snapshot.json',
    message: 'snapshot.json is missing declared help data; rebuild the complete pack',
  }]);
  const helpProblem = snapshot.help === undefined ? undefined : _helpDataProblem(snapshot.help, Object.keys(snapshot.manifest.features ?? {}));
  if (helpProblem || (snapshot.help !== undefined && !snapshot.manifest.extensions?.help)) return packValidation([{
    code: 'snapshot.help', severity: 'error', path: ['help'], source: 'snapshot.json',
    message: helpProblem ?? 'snapshot.json contains undeclared help data',
  }]);
  if (snapshot.declarationRevision !== _declarationRevision(snapshot.manifest)) return packValidation([{
    code: 'snapshot.declarations', severity: 'error', path: ['declarationRevision'], source: 'snapshot.json',
    message: 'snapshot.json declarations do not match their revision; rebuild the complete pack',
  }]);
  return { ...packValidation(), snapshot };
}
