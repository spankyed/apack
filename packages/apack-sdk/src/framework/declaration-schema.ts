import { PackConsumptionSchema, _serviceProviderProblem, _SERVICE_NAME_PATTERN } from './service-consumption.ts';
import { dslDefinitionsProblem } from './dsl-declarations.ts';
import { declarationRecord } from './declaration-record.ts';
import { hasOwn } from '../utils/shared.ts';
import { _eventContractsProblem } from './event-contracts.ts';
import type { PackLifecycleDeclaration } from './lifecycle-declaration.ts';
export { LIFECYCLE_HOOK_NAMES } from './lifecycle-declaration.ts';
import { _packEntities, _packEntityTypes, _packRelationTypes, _packRoles, _SHORT_CODE_PATTERN, _WIRE_NAME_PATTERN, _ENTITY_NAME_PATTERN, _FIELD_NAME_PATTERN, _SEARCH_STEM_LANGUAGES, type PackDataDeclarations } from './data-declaration.ts';
import { _MODULE_REFERENCE_PATTERN, _MODULE_PATH_PATTERN } from './module-reference.ts';
import { z } from 'zod';
import { _PACK_VERSION_PATTERN, _validPackVersion, _validPackRange, parsePackDependency } from './dependency-source.ts';
import { PackChecksSchema } from './pack-checks.ts';
import { SDK_ENTITIES, SDK_REL_KINDS, SDK_ROLES, SDK_SHORT_CODES } from '../types/sdk-entities.ts';
import { RESERVED_ATTRIBUTES, RESERVED_ENTITY_TYPES } from '@apackdev/ears';
import { _reservedEntries } from '../types/reserved-names.ts';
import { HOST_PACK_ID } from '../ids/refs.ts';
import { FEATURE_ID_PATTERN, PACK_ID_PATTERN } from '../ids/refs.ts';
import { _compileSettingsDefinition, _SettingsDefaultsError, _settingsJsonProblems } from './settings-validation.ts';
import type { SettingsDefinition } from './settings-definition.ts';
import type { PackMigrations } from './pack-registration.ts';
import { providerCapabilities, type EmbeddingModelId } from '../services/models.ts';
import type { ReferenceDeclarations } from './reference-declaration.ts';
import { _entityDestinationsProblem, type SurfaceDeclaration } from './surface-declaration.ts';
import type { FrontendDeclaration, TextEditorExtensionsDeclaration } from './frontend-declaration.ts';
import type { StepFrontendDeclaration, StepLayoutDeclaration } from './step-frontend-declaration.ts';

export { FEATURE_ID_PATTERN };

/** Rejects a pack's entries that use a name or value the SDK owns, naming each */
const notSdkOwned = (owned: Record<string, string>) => (declared: Record<string, string>, ctx: z.RefinementCtx) => {
  const taken = _reservedEntries(declared, owned);
  if (taken.length === 0) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${taken.join(', ')} ${taken.length === 1 ? 'is' : 'are'} defined by the SDK and available to every pack: remove ${taken.length === 1 ? 'it' : 'them'}`,
  });
};

/** Check names before Zod decodes records: its object merge discards an own __proto__ key. */
function checkDeclaredNames(raw: unknown, ctx: z.RefinementCtx): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const declaration = raw as Record<string, unknown>;
  try {
    for (const { name, owner } of _packEntities(declaration)) {
      const path = [...owner.split('.'), 'entities'];
      notSdkOwned(SDK_ENTITIES)({ [name]: name }, {
        path: [...ctx.path, ...path],
        addIssue: issue => ctx.addIssue({ ...issue, path: [...path, ...(issue.path ?? [])] }),
      });
      if ((Object.values(RESERVED_ENTITY_TYPES) as string[]).includes(name)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `"${name}" is the engine's own, which its ids are written with (${name}-…): name the entity type something else`,
        });
      }
    }
    // A prefix names one entity type across every pack: the SDK's are taken everywhere
    const sdkPrefixes = new Map(Object.entries(SDK_SHORT_CODES).map(([entity, prefix]) => [prefix as string, entity]));
    for (const { name, owner, shortCode } of _packEntities(declaration)) {
      const sdkEntity = shortCode === undefined ? undefined : sdkPrefixes.get(shortCode);
      if (sdkEntity) {
        ctx.addIssue({
          code: 'custom',
          path: [...owner.split('.'), 'entities', name, 'shortCode'],
          message: `"${shortCode}" is the SDK's ${sdkEntity} prefix, which every pack has: choose another`,
        });
      }
    }
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) });
  }
  return raw;
}

const PackRangeSchema = z.string().refine(_validPackRange, 'Must be a nonempty semver range');
const PackDependencySchema = z.string().superRefine((value, ctx) => {
  try { parsePackDependency(value); }
  catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
});

// ── Sub-schemas ─────────────────────────────────────────────────────

/** A whole module rather than a selected export. */
const ModulePathSchema = z.string().regex(_MODULE_PATH_PATTERN, 'Must name a module path, without an export selector');
/** A named export of a pack source file. */
const ExportTargetSchema = z.string().regex(_MODULE_REFERENCE_PATTERN, 'Must be "path#exportName"');

/** `provider:model` for a provider `services.inference` embeds with */
const _EMBEDDING_MODEL_PATTERN = new RegExp(`^(${Object.entries(providerCapabilities)
  .filter(([, kinds]) => (kinds as readonly string[]).includes('embedding')).map(([provider]) => provider).join('|')}):.+$`);

const EntityDeclarationSchema = z.object({
  shape: ExportTargetSchema.describe('The pack-root-relative TypeScript export of the row\'s shape (path#exportName). Leave it out for an untyped entity, whose fields read as unknown values.').optional(),
  shortCode: z.string().regex(_SHORT_CODE_PATTERN, 'Must be three uppercase letters, e.g. "THR"')
    .describe('The prefix create numbers each row\'s short code with, <prefix>-<n>: three uppercase letters, unique across every pack. The shape declares no shortCode: #generated/ears types the field from this prefix (ShortCodeOf<E>). Leave it out for an entity that isn\'t numbered.').optional(),
  indexes: z.array(z.string().regex(_FIELD_NAME_PATTERN, 'Must be a lowerCamelCase field name')).refine((fields) => new Set(fields).size === fields.length, 'Must not repeat a field').readonly()
    .describe('The fields a where(field, value) on this entity reads an index for: strings up to 256 characters, finite numbers and booleans, and each element of a list. A where on any other field filters the type\'s rows. A shaped entity\'s indexes must be fields its shape declares; role, shortCode and contentKey are always indexed.').optional(),
  search: z.object({
    fields: declarationRecord(z.string().regex(_FIELD_NAME_PATTERN, 'Must be a lowerCamelCase field name'), z.number().positive().finite())
      .refine((fields) => Object.keys(fields).length > 0, 'Must name a field')
      .describe('Each field the text index reads, with its weight: a field of weight 3 counts each of its words three times.'),
    stem: z.enum(_SEARCH_STEM_LANGUAGES).describe('The language whose stems match a word\'s other forms (`en`: "running" matches "runs").').optional(),
  }).strict()
    .describe('A text index: what query(type).search(...) matches, ranked by relevance. A shaped entity\'s fields must be ones its shape declares, holding a string or a list of strings.').optional(),
  embed: z.object({
    from: z.array(z.string().regex(_FIELD_NAME_PATTERN, 'Must be a lowerCamelCase field name')).min(1).readonly()
      .describe('The fields whose text is embedded, in this order.'),
    chunk: z.enum(['whole', 'paragraph', 'heading']).describe('How the text is split, each part embedded on its own: whole (the default), at blank lines, or at Markdown headings.').optional(),
    // The pattern is what the JSON schema states; the guard types the id
    model: z.string().regex(_EMBEDDING_MODEL_PATTERN, 'Must be provider:model, from a provider that embeds')
      .refine((model): model is EmbeddingModelId => _EMBEDDING_MODEL_PATTERN.test(model))
      .describe('The embedding model, as provider:model: services.inference runs it with the user\'s key for its provider.'),
    // elmdb's `MAX_DIMS`
    dims: z.number().int().positive().max(4096).describe('The numbers in each of the model\'s embeddings, at most 4096.'),
  }).strict()
    .describe('A vector index: what query(type).near(...), like(...) and hybrid(...) rank by. A write to its fields leaves the entity\'s chunks pending until embedPending embeds them. A shaped entity\'s fields must be ones its shape declares, holding a string or a list of strings.').optional(),
}).strict().superRefine((entity, ctx) => {
  // Text is read from a row's own fields, never the engine's
  const reserved: readonly string[] = RESERVED_ATTRIBUTES;
  for (const field of Object.keys(entity.search?.fields ?? {})) {
    if (reserved.includes(field)) ctx.addIssue({ code: 'custom', path: ['search', 'fields', field], message: `"${field}" is written by the engine and holds no text to search` });
  }
  for (const [at, field] of (entity.embed?.from ?? []).entries()) {
    if (reserved.includes(field)) ctx.addIssue({ code: 'custom', path: ['embed', 'from', at], message: `"${field}" is written by the engine and holds no text to embed` });
  }
  // The text and vector indexes are named `search` and `embedding`, beside the value indexes named after their fields
  for (const [name, declared] of [['search', entity.search], ['embedding', entity.embed]] as const) {
    const at = entity.indexes?.indexOf(name) ?? -1;
    if (declared && at >= 0) ctx.addIssue({ code: 'custom', path: ['indexes', at], message: `"${name}" names this entity's ${name === 'search' ? 'text' : 'vector'} index: a field indexed for where() can't have that name too` });
  }
}).describe('One entity type: its shape, its short code prefix, its indexes, its text index and its vector index, each optional ({} for an untyped, unnumbered entity).');
const EntitiesSchema = declarationRecord(z.string().regex(_ENTITY_NAME_PATTERN, 'Must be a PascalCase entity wire name'), EntityDeclarationSchema)
  .describe('Entity wire names, each mapped to its declaration: { shape?, shortCode? }, or {} for an untyped, unnumbered entity.');
const RelationDeclarationSchema = z.object({
  acyclic: z.boolean().describe('Refuses a link that would close a cycle through this kind (CYCLE): a tree, a folder hierarchy.').optional(),
  unique: z.boolean().describe('At most one edge of this kind from an entity to another: linking the pair again replaces the edge\'s info.').optional(),
}).strict().describe('One relation kind: the rules its edges are held to, each off unless declared ({} for a kind with none).');
const RelationsSchema = declarationRecord(z.string().regex(_WIRE_NAME_PATTERN, 'Must be a snake_case relation wire name'), RelationDeclarationSchema)
  .superRefine((relations, ctx) => {
    try { notSdkOwned(SDK_REL_KINDS)(_packRelationTypes({ data: { relations } }), ctx); }
    catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
  }).describe('Pack-level relation wire names, each mapped to its declaration; generated EARS constants are their uppercase names. Do not redeclare SDK-owned wires.');
const RolesSchema = z.array(z.string().regex(_WIRE_NAME_PATTERN, 'Must be a snake_case role name'))
  .superRefine((roles, ctx) => {
    try { notSdkOwned(SDK_ROLES)(_packRoles({ data: { roles } }), ctx); }
    catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) }); }
  }).describe('Pack-level role names; generated EARS constants are their uppercase names. Do not repeat or redeclare SDK-owned roles.');
const DataSchema = z.object({ entities: EntitiesSchema.optional(), relations: RelationsSchema.optional(), roles: RolesSchema.optional() }).strict()
  .describe('Pack-level data declarations without a feature owner.');

const FeatureDescriptionSchema = z.string().regex(/\S/, 'Feature description must not be blank')
  .describe('What this feature does, independently of its surface display label.');

/** Zod record decoding drops an own __proto__ key; opaque JSON data must preserve every key. */
const JsonObjectSchema = z.custom<Record<string, unknown>>(value => value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object')
  .superRefine((value, ctx) => {
    for (const problem of _settingsJsonProblems(value)) ctx.addIssue({ code: 'custom', path: [...problem.path],
      message: 'Must contain finite, acyclic JSON data with ordinary data properties' });
  }).transform(value => structuredClone(value));

const SettingsDefinitionShape = {
  schema: declarationRecord(z.unknown()).describe('JSON Schema draft-07 for the effective settings object; references stay within this schema.'),
  defaults: JsonObjectSchema.describe('Complete explicit baseline values, validated without coercion or schema default population.'),
  title: z.string().min(1).describe("Display title for this preference group; falls back to its group ID or feature label.").optional(),
  description: z.string().describe("Explanatory text shown above this group's custom settings form.").optional(),
  form: ModulePathSchema.describe('Source path of the custom settings form; its default export is a component.').optional(),
  access: z.enum(['shared', 'owner']).describe('Shared with declared dependents by default; owner restricts writes and resets.').optional(),
} satisfies Record<keyof SettingsDefinition, z.ZodTypeAny>;

const SettingsDefinitionValueSchema = z.object(SettingsDefinitionShape).strict();
const SettingsDefinitionSchema = z.preprocess((raw, ctx) => {
  // Validate original JSON: record decoding can discard an own __proto__ default before semantic checks.
  if (SettingsDefinitionValueSchema.safeParse(raw).success) {
    try { _compileSettingsDefinition(raw as SettingsDefinition); }
    catch (error) {
      if (error instanceof _SettingsDefaultsError) {
        for (const problem of error.problems) ctx.addIssue({ code: 'custom', path: ['defaults', ...problem.path], message: problem.message });
      } else ctx.addIssue({ code: 'custom', path: ['schema'], message: error instanceof Error ? error.message : String(error) });
    }
  }
  return raw;
}, SettingsDefinitionValueSchema);

function checkDefaultSurfaceClaims(features: Record<string, { surface?: { default?: boolean } }> | undefined, ctx: z.RefinementCtx): void {
  // Which surface opens first is one surface's annotation, so a pack naming two has said nothing
  const claimedDefault = Object.entries(features ?? {}).filter(([, feature]) => feature.surface?.default);
  if (claimedDefault.length > 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['features', claimedDefault[1]![0], 'surface', 'default'],
      message: `Two features claim the default surface: "${claimedDefault[0]![0]}" and "${claimedDefault[1]![0]}". Only one may.`,
    });
  }
}


function checkFrontendClaims(frontend: FrontendDeclaration | undefined, ctx: z.RefinementCtx, prefix: string[]): void {
  const owners = new Map<string, string>();
  for (const [id, contribution] of Object.entries(frontend?.textEditor ?? {})) {
    for (const name of Object.keys(contribution.extensions ?? {})) {
      const previous = owners.get(name);
      if (previous !== undefined) ctx.addIssue({ code: 'custom', path: [...prefix, 'textEditor', id, 'extensions', name],
        message: `Tiptap extension "${name}" declared by both groups "${previous}" and "${id}"` });
      owners.set(name, id);
    }
  }
}

/** @internal Host composition admits shared declaration data independently of executable bindings. */
const PackVersionSchema = z.string().regex(_PACK_VERSION_PATTERN, 'Must be a complete SemVer version').refine(_validPackVersion, 'Must be a complete SemVer version');
const EventNamesSchema = z.array(z.string().min(1)).refine(names => new Set(names).size === names.length, 'Event names must be unique');
export const _EventContractsSchema = declarationRecord(z.string().regex(FEATURE_ID_PATTERN), z.object({
  system: z.object({ incoming: EventNamesSchema, outgoing: EventNamesSchema }).strict().optional(),
  surface: z.object({ receives: EventNamesSchema }).strict().optional(),
}).strict());

export const _NativePackDeclarationSchema = z.preprocess(checkDeclaredNames, z.object({
  id: z.string().regex(PACK_ID_PATTERN),
  version: PackVersionSchema.optional(),
  migrations: z.lazy(() => MigrationsSchema).optional(),
  dependencies: declarationRecord(z.string().regex(PACK_ID_PATTERN), PackRangeSchema).optional(),
  consumes: PackConsumptionSchema.optional(),
  settings: declarationRecord(z.string().regex(FEATURE_ID_PATTERN), SettingsDefinitionSchema).optional(),
  services: z.lazy(() => ServicesSchema).optional(),
  repositories: z.lazy(() => ServicesSchema).optional(),
  data: DataSchema.optional(),
  lifecycle: z.lazy(() => LifecycleConfigSchema).optional(),
  content: z.lazy(() => NativeContentConfigSchema).optional(),
  steps: z.lazy(() => ExtensionsSchema.shape.steps),
  artifacts: z.lazy(() => ExtensionsSchema.shape.artifacts),
  blocks: z.lazy(() => ExtensionsSchema.shape.blocks),
  dsl: z.lazy(() => ExtensionsSchema.shape.dsl),
  dslDefinitions: declarationRecord(z.string()).optional(),
  entityDestinations: declarationRecord(z.string().min(1), z.string().min(1)).optional(),
  eventContracts: _EventContractsSchema.optional(),
  textEditor: z.lazy(() => FrontendConfigSchema.shape.textEditor),
  appExtensions: z.lazy(() => FrontendConfigSchema.shape.appExtensions),
  features: declarationRecord(z.string().regex(FEATURE_ID_PATTERN), z.lazy(() => FeatureEntrySchema.pick({
    description: true, entities: true, designation: true, settings: true, surface: true, references: true, services: true, repositories: true,
  }))).optional(),
}).strict().superRefine((declaration, ctx) => {
  if (Object.keys(declaration.migrations?.pack ?? {}).length && declaration.version === undefined) {
    ctx.addIssue({ code: 'custom', path: ['version'], message: "Native pack-line migrations require the pack's declared version" });
  }
  const eventsProblem = _eventContractsProblem(declaration.eventContracts, declaration.features, true);
  if (eventsProblem) ctx.addIssue({ code: 'custom', path: ['eventContracts'], message: eventsProblem });
  const destinationProblem = _entityDestinationsProblem(declaration.entityDestinations ?? {}, declaration.features);
  if (destinationProblem) ctx.addIssue({ code: 'custom', path: ['entityDestinations'], message: destinationProblem });
  const dslProblem = dslDefinitionsProblem(declaration.dsl, declaration.dslDefinitions);
  if (dslProblem) ctx.addIssue({ code: 'custom', path: ['dslDefinitions'], message: dslProblem });
  checkContentWriterClaims(declaration, ctx);
  checkFrontendClaims(declaration, ctx, []);
  checkReferenceClaims(declaration.features, ctx);
  checkDefaultSurfaceClaims(declaration.features, ctx);
  checkApiClaims(declaration.features, declaration.services, declaration.repositories, ctx);
  checkServiceProviders(declaration, ctx);
}));

/** Validate provider membership before a build needs to resolve its declaration. */
function checkServiceProviders(pack: { id: string; dependencies?: Readonly<Record<string, unknown>>; consumes?: { services: readonly string[] } }, ctx: z.RefinementCtx): void {
  // Zod may run parent refinements after a child's regex fails; syntax errors already have a path.
  if (!pack.consumes || !PackConsumptionSchema.safeParse(pack.consumes).success) return;
  pack.consumes.services.forEach((ref, index) => {
    const message = _serviceProviderProblem(pack, ref);
    if (message) ctx.addIssue({ code: 'custom', path: ['consumes', 'services', index], message });
  });
}

/** API names share one namespace within a pack, even when their declarations have different feature owners. */
function checkApiClaims(features: Record<string, { services?: Record<string, string>; repositories?: Record<string, string> }> | undefined,
  services: Record<string, string> | undefined, repositories: Record<string, string> | undefined, ctx: z.RefinementCtx,
  servicePath = ['services']): void {
  for (const kind of ['services', 'repositories'] as const) {
    const root = kind === 'services' ? services : repositories;
    const path = kind === 'services' ? servicePath : ['repositories'];
    const owners = new Map(Object.keys(root ?? {}).map(name => [name, path.join('.')]));
    for (const [id, feature] of Object.entries(features ?? {})) {
      for (const name of Object.keys(feature[kind] ?? {})) {
        const owner = `features.${id}.${kind}`;
        const previous = owners.get(name);
        if (previous !== undefined) ctx.addIssue({ code: 'custom', path: ['features', id, kind, name],
          message: `${kind === 'services' ? 'Service' : 'Repository'} "${name}" is declared by both "${previous}" and "${owner}"` });
        else owners.set(name, owner);
      }
    }
  }
}

export const StepDSLMetaSchema = z.object({
  references: declarationRecord(z.string().regex(/^[A-Za-z_$][\w$]*$/, 'Must name a DSL field'), z.string().min(1))
    .describe('DSL field to compiled content key, for static dependency and rename inspection. Computed targets are recorded as dynamic.').optional(),
  primaryField: z.string().regex(/^[A-Za-z_$][\w$]*$/, 'Must be a field identifier').describe('The field whose value becomes the step label in the flow editor.').optional(),
  defaultLabel: z.string().describe('Default label argument for the generated label-only helper.').optional(),
  helpers: ModulePathSchema.describe('Pack-root-relative module whose custom flow helpers are re-exported.').optional(),
}).strict();

/**
 * What a step's runtime facet is: the flags the brain reads before it runs anything, and the handler it
 * runs, named as a `"path#exportName"` so the module holding it is loaded on the step's first run rather
 * than at pack load. A step whose whole behaviour is a flag (`subflow`) declares no handler; one with no
 * handler at all is completed for it, so a step that means to wait declares the handler that waits.
 */
const StepRuntimeSchema = z.object({
  handler: ExportTargetSchema.describe('"path#exportName" of the function that runs the step. Loaded on its first run, unless `sync`.').optional(),
  sync: z.literal(true).describe("The handler's sends have to land in the brain's own dispatch, so its module is imported with the pack entry rather than on the step's first run. For a handler that both ends the flow and completes itself, where the two sends must be ordered with the transition that called it.").optional(),
  isAsync: z.literal(true).describe('The handler returns a promise, so the brain reports a rejection as the step\'s error.').optional(),
  waits: z.literal(true).describe('The step holds the flow at this node instead of completing.').optional(),
  spawnsSubflow: z.literal(true).describe('The step runs another flow, which the brain spawns in place of a step node.').optional(),
}).strict().superRefine((runtime, ctx) => {
  if (runtime.sync && runtime.isAsync) {
    ctx.addIssue({ code: 'custom', message: '`sync` and `isAsync` are opposites: a handler whose sends must land in the brain\'s dispatch cannot be awaited' });
  }
  if (runtime.sync && !runtime.handler) {
    ctx.addIssue({ code: 'custom', message: '`sync` describes how a handler is loaded, so it needs one' });
  }
});

const StepBuildSchema = z.object({
  compile: ExportTargetSchema.describe('Exported function that compiles a DSL step into an entity and relations.'),
  validate: ExportTargetSchema.describe('Exported function that validates a DSL step before compilation.'),
  getLabel: ExportTargetSchema.describe('Exported function that computes the label of a compiled step.'),
  decompile: ExportTargetSchema.describe('Exported function that restores a DSL step from a stored node.').optional(),
  branches: ExportTargetSchema.describe('Exported function that lists nested DSL branches.').optional(),
  relation: z.object({
    field: z.string().regex(/\S/).describe('Node field containing the related entity ID.'),
    targetEntity: z.string().regex(/\S/).describe('Entity wire name targeted by the instance_of relation.'),
  }).strict().describe('Static relation metadata, available without loading compiler callbacks.').optional(),
}).strict();

/** Trigger data is independent of compiler callbacks and lazy runtime registration. */
const StepTriggerSchema = z.object({
  trackField: z.string().regex(/^[A-Za-z_$][\w$]*$/, 'Must be a field identifier')
    .refine(value => !RESERVED_FEATURE_IDS.has(value), 'Must not be a reserved identifier')
    .describe('DSL track field owned by this trigger; also names its generated flow helper.'),
  persistent: z.boolean().describe('Whether the flow stays alive after all tracks drain.').optional(),
  queryFields: z.array(z.string().regex(/\S/)).describe('Additional node fields required when querying this trigger.').optional(),
  compile: ExportTargetSchema.describe('Exported function that compiles a DSL track into a trigger node.'),
  decompile: ExportTargetSchema.describe('Exported function that restores DSL track fields from a trigger node.'),
  validateTrack: ExportTargetSchema.describe('Exported function that validates a DSL track before compilation.').optional(),
  validate: ExportTargetSchema.describe('Exported function that validates a trigger node before persistence.').optional(),
  register: ExportTargetSchema.describe('"path#exportName" of the function that starts the trigger. Loaded when it is first registered.').optional(),
}).strict();

/** Node data is shared; executable facets go only to the processes that use them. */
export const StepEntrySchema = z.object({
  kind: z.enum(['step', 'trigger']).describe('Whether this is a regular step or a trigger. "step" is the default.').optional(),
  node: z.object({
    label: z.string().regex(/\S/, 'Node label must not be blank').describe('Label a new node starts with, also shown on its canvas.'),
    defaultLabel: z.string().describe('Palette label when different from the node label.').optional(),
    defaults: JsonObjectSchema.describe('Initial JSON node fields; these must satisfy the step or trigger validation.').optional(),
  }).strict().describe('Node labels and initial values, available without importing step code. Both generated registrations carry this data.'),
  build: StepBuildSchema.describe('Compiler callbacks and static relation metadata. A trigger declares `trigger` instead.').optional(),
  trigger: StepTriggerSchema.describe('Trigger metadata, compiler callbacks and optional lazy registration.').optional(),
  fe: z.lazy(() => StepFrontendSchema).describe('Static editor presentation and explicit component/layout bindings.').optional(),
  types: ModulePathSchema.describe('Type-only module declaring this step’s node and DSL types. No conventional file is inferred.').optional(),
  runtime: StepRuntimeSchema.describe('What the brain runs, and the flags it reads before running it.').optional(),
  dsl: StepDSLMetaSchema.describe('DSL configuration for flow-helper generation.').optional(),
}).strict().superRefine((entry, ctx) => {
  if (entry.kind === 'trigger' && entry.build) {
    ctx.addIssue({ code: 'custom', message: 'A trigger declares `trigger`, not `build`' });
  }
  if (entry.kind !== 'trigger' && entry.trigger) {
    ctx.addIssue({ code: 'custom', message: 'Only a step with `"kind": "trigger"` declares `trigger`' });
  }
});

export const DslEntrySchema = z.object({
  entry: ModulePathSchema.describe('Path to the DSL type definition module.'),
  targets: z.array(z.enum(['monaco'])).describe('Editor targets for intellisense integration.'),
  prefix: z.string().describe('Editor model path prefix selecting this DSL. Omit or use an empty value to require explicit selection.').optional(),
  globals: declarationRecord(z.string(), z.string()).describe('Global type mappings injected into the DSL scope.').optional(),
  inline: z.array(z.string()).describe('Packages whose declarations are bundled into the editor definitions, besides @apackdev/* and the pack\'s own modules. The editor loads no node_modules, so a type it needs from another package belongs here.').optional(),
}).strict();

/**
 * Content keys compiled by the SDK's own compilers; they take a path, as a string or `{ path }`. Each writes
 * entities the SDK owns: `documents` a tree of Documents in Collections, and `commands` the same tree with
 * every Document a command list unless it says otherwise.
 */
export const SPECIALTY_CONTENT_KEYS: readonly string[] = ['actions', 'prompts', 'flows', 'documents', 'commands'];

/**
 * The content key the commands a manifest declares are compiled under.
 *
 * It is reserved rather than named by the pack, because the pack never writes the entry: declaring
 * `extensions.commands` is what creates it. A pack may not declare a source of this name — it would be
 * two entries wanting one compiled file — and it is not `commands`, which is the key a pack's own directory of
 * command documents compiles under, so a pack may declare both.
 */
export const DECLARED_COMMANDS_KEY = 'declared-commands';

/**
 * The content keys a manifest declares: its `content.sources`, plus the reserved one its
 * `extensions.commands` creates.
 *
 * **Every check that asks what a pack declared has to ask this**, because the shorthand declares an entry
 * the pack wrote no source for — the compiled index, the applier keys the runtime may carry, and the
 * installed layout each derived the answer separately, and a reserved key is invisible to all three
 * unless they share one.
 */
export function declaredContentKeys(manifest: { content?: { sources?: Record<string, unknown> }; extensions?: { commands?: unknown } }): string[] {
  return [
    ...Object.keys(manifest.content?.sources ?? {}),
    ...(manifest.extensions?.commands ? [DECLARED_COMMANDS_KEY] : []),
  ];
}

/** A slash command's name: what the user types after the `/` */
const COMMAND_NAME = /^[a-z][a-z0-9-]*$/;

const ContentFieldSpecSchema = z.object({
  from: z.string().regex(/^(body|filename|path|frontmatter\.[\w-]+)$/, 'Must be "body", "filename", "path" or "frontmatter.<name>"')
    .describe('Where the value comes from: the markdown body, the display name of the file or directory, its relative path, or a frontmatter field.'),
  default: z.unknown().describe('Used when the source is absent. The string "filename" means the display name.').optional(),
  type: z.literal('string').describe('Coerce a present value to a string (YAML reads an unquoted 2024 as a number).').optional(),
}).strict();

const ContentTreeSpecSchema = z.object({
  branch: z.string().describe('A directory\'s own markdown file (e.g. "index.md"), giving the directory\'s frontmatter and body.').optional(),
  branchEntity: z.string().describe('The entity type directories become. Defaults to `entity`.').optional(),
  relKind: z.string().describe('The relation from a parent entity to each child. Defaults to "contains".').optional(),
}).strict();

const CONTENT_NAME = /^[a-z][a-z0-9-]*$/;

/** A relative directory: `/`-separated names, none of them `.` or `..` */
const MEDIA_PATH = /^(?!\.{1,2}(?:\/|$))(?!.*\/\.{1,2}(?:\/|$))[^/\\:]+(?:\/[^/\\:]+)*$/;

/** A format name in the pack's own `content.formats`, or `<dependency id>:<name>` */
const CONTENT_FORMAT_REF = /^(?:([a-z][a-z0-9-]*):)?([a-z][a-z0-9-]*)$/;

/** How a source becomes items: a built-in format or a compiler module, with the settings it uses */
export const ContentFormatSchema = z.object({
  format: z.enum(['markdown-tree', 'json']).describe('A built-in format: a directory of markdown, or a JSON array of records.').optional(),
  compiler: ModulePathSchema.describe('A module in this pack whose default export compiles an entry\'s path into records. Used instead of "format".').optional(),
  entity: z.union([z.string(), z.array(z.string()).min(1)])
    .describe('The entity types the format\'s items are written as. Omitted, sources using it are compiled and never written (content.datasets).').optional(),
  identity: z.array(z.string()).min(1)
    .describe('Fields matched to find an existing entity ("parent" = the tree parent). Ignored for entity types whose owning pack registers a content writer with "find".').optional(),
  tree: ContentTreeSpecSchema.describe('Walk subdirectories as parent entities.').optional(),
  fields: declarationRecord(z.string(), ContentFieldSpecSchema).describe('Item fields for markdown-tree: field name → where its value comes from.').optional(),
  media: z.string().regex(MEDIA_PATH, 'Must be a relative directory under the entry\'s path, without "." or ".." segments')
    .describe('A directory under a source\'s path copied with the content; media/<file> links become media://<id>/<file>.').optional(),
}).strict().superRefine((format, ctx) => {
  if (!format.format === !format.compiler) ctx.addIssue({ code: 'custom', message: 'A content format needs "format" or "compiler", not both' });
  if (format.fields && format.format !== 'markdown-tree') ctx.addIssue({ code: 'custom', path: ['fields'], message: '"fields" applies only to format "markdown-tree"' });
  if (format.format === 'markdown-tree' && Array.isArray(format.entity)) {
    ctx.addIssue({ code: 'custom', path: ['entity'], message: 'Format "markdown-tree" writes one entity type: set "entity" to a string, and "tree.branchEntity" for directories' });
  }
});

/**
 * What an apply does about an item of this entry that the user has edited, and the line is whether editing
 * it meant adoption or customisation.
 *
 * **`theirs` is the default, because it is the quiet one.** Where the pack ships a starting point for the
 * user's own writing, their first edit makes the item theirs: never updated again, and never the subject of
 * a badge about their own prose. Where it ships something of the pack's that the user has customised — a
 * flow, an action, a prompt — they still want its bug fixes, so `offer` records what changed and lets them
 * decide. The dangerous option is the one someone has to type.
 *
 * **Neither value ever overwrites the user**, which is why the pair is named for whose the item is rather
 * than for what happens to their edit: under both, what they wrote stays. What differs is whether the pack
 * goes on offering its own version, and nothing here makes a second copy of anything.
 */
export const CONTENT_EDIT_POLICIES = ['theirs', 'offer'] as const;
export type ContentEditPolicy = (typeof CONTENT_EDIT_POLICIES)[number];

const ON_USER_EDIT = z.enum(CONTENT_EDIT_POLICIES)
  .describe('What an apply does about an item the user has edited: "theirs" leaves it theirs for good (the default), "offer" records the newer version so they can take it. Neither overwrites their edit.');

/** A `content.sources` entry: a source and the format that compiles it, a pack applier module, or both */
export const ContentSourceSchema = z.object({
  path: z.string().describe('Source directory or file, relative to the pack root.').optional(),
  format: z.string().regex(CONTENT_FORMAT_REF, 'Must be a content.formats name, or "<dependency id>:<name>"')
    .describe('The format compiling `path`: a name in this pack\'s content.formats, or "<dependency id>:<name>" for a dependency\'s.').optional(),
  applier: ModulePathSchema.describe('A pack module exporting apply(ctx), used instead of the format applier. Alone, the build compiles nothing for the source and the module brings its own data; with "path" and "format", the module writes the compiled items.').optional(),
  onUserEdit: ON_USER_EDIT.optional(),
}).strict();

/** The fields a specialty key's object form may carry: it is the SDK that compiles it, so it names no format */
const SPECIALTY_FIELDS = new Set(['path', 'onUserEdit']);

// Content keys name files and folders in the compiled output (<key>.content.json, media/<key>) and generated identifiers
const CONTENT_KEY_SCHEMA = z.string().regex(CONTENT_NAME, 'Must be a lowercase letter, then lowercase letters, digits and hyphens');

const ContentSourcesSchema = declarationRecord(CONTENT_KEY_SCHEMA, z.union([z.string(), ContentSourceSchema])).superRefine((sources, ctx) => {
  for (const [key, entry] of Object.entries(sources)) {
    if (SPECIALTY_CONTENT_KEYS.includes(key)) {
      if (typeof entry === 'object' && (!entry.path || Object.keys(entry).some((field) => !SPECIALTY_FIELDS.has(field)))) {
        ctx.addIssue({ code: 'custom', path: [key], message: `"${key}" is compiled by the SDK: give its source as a path or { "path": …, "onUserEdit"?: … }` });
      }
    } else if (typeof entry === 'string') {
      ctx.addIssue({ code: 'custom', path: [key], message: `Unknown content key "${key}": only ${SPECIALTY_CONTENT_KEYS.join(', ')} take a path; other sources are { "path", "format" } or { "applier" }` });
    } else if ((entry.path === undefined) !== (entry.format === undefined) || (!entry.path && !entry.applier)) {
      ctx.addIssue({ code: 'custom', path: [key], message: `Content "${key}" must be { "path", "format" }, optionally with "applier", or { "applier" }` });
    }
  }
});

/**
 * A compiled dataset the pack reads back itself, never written to the database: the build produces
 * `<key>.content.json` and the pack's own code reads it.
 *
 * It is a key of its own because the alternative was a `content.sources` entry whose format declared no
 * entity: compiled, indexed, given an applier that could only find nothing to do, and a standing
 * contradiction with "every source a pack declares is applied". The format it names must declare no
 * `entity`, which is the whole of what makes it a dataset rather than content.
 *
 * It is not an `extensions.artifacts` entry, which is a viewer type the app registers. Nothing of a
 * dataset is registered or reachable from another pack: the declaring pack compiles it and reads it.
 */
const ContentDatasetsSchema = declarationRecord(CONTENT_KEY_SCHEMA, ContentSourceSchema).superRefine((datasets, ctx) => {
  for (const [key, entry] of Object.entries(datasets)) {
    if (!entry.path || !entry.format || entry.applier) {
      ctx.addIssue({ code: 'custom', path: [key], message: `Dataset "${key}" must be { "path", "format" }: it is compiled and never written, so it takes no applier` });
    }
    // Nothing of a dataset reaches the database, so there is no edit of the user's for a policy to be about
    if (entry.onUserEdit) {
      ctx.addIssue({ code: 'custom', path: [key], message: `Dataset "${key}" is never written, so "onUserEdit" decides nothing: drop it` });
    }
  }
});


const SystemSchema = z.object({
  entry: ModulePathSchema.describe('Path to the backend system module.'),
  contract: ExportTargetSchema.describe('"path#exportName" of this system\'s contract: a declared type holding its context and its incoming, internal and outgoing events (SystemContract, @apackdev/sdk/framework). It lives in a leaf module of its own (be/contract.ts), so codegen reads it without running anything. Omit only when there are no typed incoming or outgoing events; explicit events.incoming still declares routing additions.').optional(),
  events: z.object({
    incoming: z.array(z.string()).describe('Event types this system listens for.').optional(),
  }).strict().describe('Event routing declarations.').optional(),
}).strict();

const ModuleTargetSchema = z.string().regex(/^[^#]+(?:#[A-Za-z_$][\w$]*)?$/, 'Must be a module path or path#exportName');
const ComponentModuleSchema = z.object({
  entry: ModuleTargetSchema.describe("Pack-root-relative component module, using its default export unless #exportName selects a binding."),
  load: z.literal('lazy').describe("Load the component on demand; omission uses the normal eager component binding.").optional(),
}).strict();
const ComponentTargetSchema = z.union([ModuleTargetSchema, ComponentModuleSchema]);

/** The same feature ownership checks apply to authored and native declarations. */
function checkReferenceClaims(features: Record<string, { references?: ReferenceDeclarations }> | undefined, ctx: z.RefinementCtx): void {
  const referenceClaims = { types: new Map<string, string>(), categories: new Map<string, string>() };
  const claim = (kind: keyof typeof referenceClaims, name: string, feature: string, path: string[]) => {
    const previous = referenceClaims[kind].get(name);
    if (previous !== undefined) ctx.addIssue({ code: 'custom', path,
      message: `Reference ${kind} "${name}" claimed by both features "${previous}" and "${feature}"` });
    else referenceClaims[kind].set(name, feature);
  };
  for (const [feature, entry] of Object.entries(features ?? {})) {
    for (const name of Object.keys(entry.references?.types ?? {})) {
      const path = ['features', feature, 'references', 'types', name];
      claim('types', name, feature, path);
    }
    for (const name of Object.keys(entry.references?.categories ?? {})) {
      claim('categories', name, feature, ['features', feature, 'references', 'categories', name]);
    }
  }
}

const ReferenceNameSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/, 'Must be a lowercase reference name');
const IconSchema = z.union([z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Must name a lucide-vue-next export'), ComponentModuleSchema]);
const StepLayoutShape = {
  getHeight: ExportTargetSchema.describe('Named function calculating node height from the node and layout context.').optional(),
  getPorts: ExportTargetSchema.describe('Named function calculating ports from the node and layout context.').optional(),
  hasInput: z.boolean().describe('Whether this layout has an input port.').optional(),
  usesExitCount: z.boolean().describe('Whether layout calculations consume the track exit count.').optional(),
} satisfies Record<keyof StepLayoutDeclaration, z.ZodTypeAny>;
const StepNodeConfigShape = {
  icon: IconSchema.describe('Lucide export name or declared custom icon component.'),
  connectionRules: z.object({
    inputs: z.number().int().min(-1).describe('Maximum incoming connections; -1 means unlimited.'),
    outputs: z.number().int().min(-1).describe('Maximum outgoing connections; -1 means unlimited.'),
  }).strict().describe('Static connection limits for this node type.'),
  category: z.enum(['trigger', 'action', 'logic', 'data', 'ai']).describe('Palette category for this node type.'),
  isImplemented: z.boolean().describe('Whether the palette offers this node for creation; only true enables it.').optional(),
  isDisabled: z.boolean().describe('Disable this palette entry.').optional(),
} satisfies Record<keyof StepFrontendDeclaration['nodeConfig'], z.ZodTypeAny>;
const StepFrontendShape = {
  nodeConfig: z.object(StepNodeConfigShape).strict().describe('Palette and connection metadata, independent of component activation.'),
  colorKey: z.string().min(1).describe('Editor color token; unknown tokens use the editor’s neutral color.').optional(),
  components: z.object({
    node: ComponentTargetSchema.describe('Custom node component; omission uses the generic node.').optional(),
    form: ComponentTargetSchema.describe('Node configuration form component.').optional(),
  }).strict().describe('Named component slots and their loading modes.').optional(),
  layout: z.object(StepLayoutShape).strict().describe('Static layout flags and executable calculation targets.').optional(),
  handlePrefix: z.string().min(1).describe('Prefix for indexed output handles, such as branch-0.').optional(),
} satisfies Record<keyof StepFrontendDeclaration, z.ZodTypeAny>;
const StepFrontendSchema: z.ZodType<StepFrontendDeclaration> = z.object(StepFrontendShape).strict();
const ReferencesSchema: z.ZodType<ReferenceDeclarations> = z.object({
  types: declarationRecord(ReferenceNameSchema, z.object({
    category: ReferenceNameSchema.describe('Category ID grouping this reference type in the picker.'),
    icon: IconSchema.describe('Lucide icon export name or a declared component module for this reference type.'),
    svgElements: z.array(z.union([
      z.tuple([z.literal('path'), z.object({ d: z.string().describe('SVG path geometry.') }).strict()]),
      z.tuple([z.literal('rect'), declarationRecord(z.string())]),
      z.tuple([z.literal('circle'), declarationRecord(z.string())]),
    ])).describe('Static SVG geometry for rendering this reference in serialized editor content.'),
  }).strict()).describe('Reference type IDs with static presentation and declared navigation bindings.'),
  categories: declarationRecord(ReferenceNameSchema, z.object({
    label: z.string().min(1).refine(value => value.trim().length > 0, 'Must have a visible label')
      .describe('Visible category label in the reference picker.'),
    icon: IconSchema.describe('Lucide icon export name or a declared component module for this category.'),
    useItems: ExportTargetSchema.describe('Named reactive item-provider export; queries execute when the picker requests items.'),
  }).strict()).describe('Reference picker category IDs and their declared item providers.'),
}).strict();

const SurfaceSchema: z.ZodType<SurfaceDeclaration> = z.object({
  label: z.string().min(1).refine(value => value.trim().length > 0, 'Must have a visible label')
    .describe('Surface display name used by shell navigation and menus.'),
  state: ModuleTargetSchema.describe('Machine module, by default export or path#exportName.'),
  icon: z.union([z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Must name a lucide-vue-next export'), ComponentModuleSchema])
    .describe('Lucide icon export name or component module displayed in shell navigation.').optional(),
  canvas: z.union([ComponentTargetSchema, z.object({ routes: declarationRecord(z.string().min(1)
    .refine(route => !['__proto__', 'constructor', 'prototype'].includes(route), 'Reserved route name'), ComponentTargetSchema)
    .refine(routes => Object.keys(routes).length > 0, 'Must declare at least one route')
    .describe('Canvas components keyed by the route names published by this surface.') }).strict()])
    .describe('Main canvas component, or an explicit nonempty map of routed canvas components.').optional(),
  panel: ComponentTargetSchema.describe('Context panel component shown alongside the canvas.').optional(),
  chat: ComponentTargetSchema.describe('Chat component supplied by this surface.').optional(),
  isPinned: z.boolean().describe('Place this surface in the pinned toolbar group.').optional(),
  hotkeys: z.array(z.object({
    action: z.string().min(1).describe('Action name matched against the configured keyboard shortcut.'),
    global: z.boolean().describe('Allow this action while another surface is active; omission limits it to the active surface.').optional(),
  }).strict()).describe('Keyboard actions exposed by this surface; actual shortcuts are configured in settings.').optional(),
  options: z.object({ headerClass: z.string().describe('CSS classes applied to the canvas and popout header.').optional() }).strict()
    .describe('Shell presentation options for this surface.').optional(),
  fallbackPanel: z.object({
    label: z.string().min(1).describe('Shell menu label for toggling this shared context panel.'),
    toggle: z.object({ type: z.string().min(1).describe('Event type sent to this surface machine to toggle its panel.') }).strict()
      .describe('Toggle event delivered to the panel-owning surface.'),
    isShown: ExportTargetSchema.describe('Named predicate export that reads this surface snapshot to decide whether its fallback panel is shown.'),
  }).strict().describe('Offer this surface panel to surfaces without their own panel, with a toggle event and visibility predicate.').optional(),
  defaultVisible: z.boolean().describe('Default navigation visibility, independent of settings values and the startup default claim.').optional(),
  contract: ExportTargetSchema.describe('"path#exportName" of this surface\'s contract: a declared type holding the state it publishes and the inbox other surfaces may send to (SurfaceInbox, @apackdev/sdk/fe). It lives in a leaf module of its own (fe/contract.ts), which the surface\'s machine does not import, so codegen can read it without resolving the machine. Omit it for a surface that publishes nothing: it still receives its own feature\'s system events.').optional(),
  default: z.boolean().describe('Claim initial navigation for this surface. At most one feature per pack may claim it. Enabled native claims precede installed claims, then qualified feature references sort in English lexical order; frontend loading order does not affect selection.').optional(),
} satisfies Record<keyof SurfaceDeclaration, z.ZodTypeAny>).strict();


/** Names a feature id can't take: reserved words, since a feature id becomes an identifier in generated code */
const RESERVED_FEATURE_IDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
  'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in',
  'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'arguments', 'eval',
]);

const IdentifierSchema = z.string().regex(/^[A-Za-z_$][\w$]*$/, 'Must be an identifier');

/**
 * The key of an extension point entry: the *type* a pack contributes, which is data rather than a name in
 * generated code — so unlike a feature id it may hold `_` and `-` (`keep_alive`, `project-select` both
 * exist). An extension point is a map keyed by this, which is what makes a duplicate type unrepresentable:
 * JSON cannot hold one key twice, so nothing has to check for it and nothing can forget to.
 */
const EXTENSION_TYPE_SCHEMA = z.string()
  .regex(/^[a-z][a-z0-9_-]*$/, 'Must be a lowercase letter, then lowercase letters, digits, underscores and hyphens');

/**
 * One message block: what it is, and where the code that draws it lives. `fe` is a path because a `.vue`
 * file's component is its default export, the way `extensions.appExtensions` names one.
 */
export const BlockEntrySchema = z.object({
  kind: z.enum(['display', 'input']).describe('Whether the chat renders it as content or as something the user acts on. Display is the default.').optional(),
  fe: ModulePathSchema.describe('Path to the component that draws it (a .vue file, taken by its default export).').optional(),
  be: ExportTargetSchema.describe('"path#exportName" of its backend facet (BlockBEFacet), for a block that summarises itself in a transcript.').optional(),
}).strict();

/**
 * One artifact type: the icon the chat lists it under, and the viewer that opens it. `icon` is the name of
 * a `lucide-vue-next` export, which is the icon set the host provides every pack's frontend
 * (`SHARED_DEPS`), so a pack names one rather than shipping a component; a name lucide does not export
 * fails the pack's own typecheck on the generated frontend entry.
 */
export const ArtifactEntrySchema = z.object({
  icon: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Must be the name of a lucide-vue-next export, e.g. "ListTodo"')
    .describe('Name of the lucide-vue-next icon shown in the artifact list.'),
  fe: ModulePathSchema.describe('Path to the viewer that opens it (a .vue file, taken by its default export). Without one the host shows the text viewer.').optional(),
}).strict();

export const ContentConfigSchema = z.object({
  sources: ContentSourcesSchema
    .describe('Content this pack writes into the database. Keys name the content; the specialty keys (actions, prompts, flows, documents, commands) take a path, other keys an entry object.').optional(),
  datasets: ContentDatasetsSchema
    .describe('Compiled datasets the pack reads back itself, never written to the database. Each names a format declaring no entity.').optional(),
  formats: declarationRecord(CONTENT_KEY_SCHEMA, ContentFormatSchema)
    .describe('Named formats that turn a source into items. A content source names one; a dependent pack names one of these as "<this pack id>:<name>".').optional(),
  writers: declarationRecord(z.string(), ExportTargetSchema)
    .describe('How one entity type this pack declares is found, created, updated and removed when content is written as it ("path#exportName" of a ContentWriter object). Any pack writing that entity type goes through them.').optional(),
}).strict().describe("A pack's content: what it ships, how it is compiled, and how it reaches the database.");

/** Native appliers consume an explicitly supplied content directory; they do not declare build inputs. */
const NativeContentConfigSchema = z.object({
  writers: ContentConfigSchema.shape.writers,
  sources: declarationRecord(CONTENT_KEY_SCHEMA, ContentSourceSchema.pick({ applier: true }).required()).optional(),
}).strict();

function checkContentWriterClaims(declaration: PackDataDeclarations & { content?: { writers?: Readonly<Record<string, string>> } }, ctx: z.RefinementCtx): void {
  let declared: Set<string>;
  try { declared = new Set(Object.keys(_packEntityTypes(declaration))); }
  catch { return; } // Duplicate homes were diagnosed against the original input above.
  for (const entity of Object.keys(declaration.content?.writers ?? {})) {
    if (!declared.has(entity)) {
      ctx.addIssue({ code: 'custom', path: ['content', 'writers', entity], message: `A content writer for "${entity}": only entity types this pack declares under a feature or data.entities can have one` });
    }
  }
}

export const LifecycleConfigSchema = z.object({
  onInit: ExportTargetSchema.describe('Function called after hydration, before migrations and content.').optional(),
  onShutdown: ExportTargetSchema.describe('Function called when this pack stops.').optional(),
} satisfies Record<keyof PackLifecycleDeclaration, z.ZodTypeAny>).strict().describe('Explicit lifecycle function targets, discoverable without loading their modules.');


const ServicesSchema = declarationRecord(z.string().regex(_SERVICE_NAME_PATTERN, 'Must be an identifier'), ExportTargetSchema);

/**
 * A feature id: the key its entry sits under. It becomes a name in generated code, so unlike a step or
 * block *type* it is an identifier — no hyphens, no underscores — and not a word generated code already
 * uses. Being a key is what makes a duplicate unrepresentable: two features with one id used to collapse
 * last-wins across five generated modules, silently.
 */
const FEATURE_ID_SCHEMA = z.string()
  .regex(FEATURE_ID_PATTERN, 'Must start with a lowercase letter and contain only letters and digits (e.g. "notes", "calendarEvents")')
  .refine((id) => !RESERVED_FEATURE_IDS.has(id), (id) => ({ message: `"${id}" is reserved in generated code: pick another feature id` }));

export const FeatureEntrySchema = z.object({
  description: FeatureDescriptionSchema,
  entities: EntitiesSchema.describe('Entity wire names owned by this feature, each mapped to its declaration: { shape?, shortCode? }, or {} for an untyped, unnumbered entity. Placement does not change wire names.').optional(),
  designation: z.string().describe('Links the system to an EARS designation.').optional(),
  settings: SettingsDefinitionSchema.describe('Declarative feature preferences: effective-value schema and explicit defaults.').optional(),
  types: z.string().min(1).regex(_MODULE_PATH_PATTERN, 'Must name a TypeScript module, not a single export').describe('Pack-root-relative TypeScript module whose public types are re-exported through #generated/types. Only declared modules contribute; no feature-path inference.').optional(),
  system: SystemSchema.describe('Backend system module.').optional(),
  surface: SurfaceSchema.describe('Frontend surface definition.').optional(),
  services: ServicesSchema
    .describe('Services. Keys are service names on `services`, values are "path#exportName" of the service object (an object literal or a class instance, not a factory) in a source file.').optional(),
  repositories: declarationRecord(IdentifierSchema, ExportTargetSchema)
    .describe('Repository objects. Keys are repository names on `repository` (from #generated/repository), values are "path#exportName" of the object in a source file.').optional(),
  views: ExportTargetSchema
    .describe('The feature\'s views: "path#exportName" of the object `defineViews` returns, from @apackdev/sdk/framework. A window subscribes to one with `useView` from #generated/fe; each is a pure read of the engine, run again after every commit that could change its result.').optional(),
  references: ReferencesSchema.describe('Reference identities and presentation, with reactive item-provider exports. Entity opening is declared separately by the destination surface contract.').optional(),
}).strict();

export const PackPermissionSchema = z.enum(['ears', 'llm', 'filesystem', 'network', 'terminal']);

/**
 * How the pack is built. These are settings no part of the app reads — unlike `entities` or `features`,
 * which the host loads at boot — so what belongs here is anything that changes only what `apack pack build`
 * produces or how long it takes.
 */
const BuildConfigSchema = z.object({
  opaqueDeps: z.array(z.string()).describe('Dependencies the frontend bundle includes whole instead of tree-shaking, by package name. For a prebuilt bundle — a dependency shipped as one already-minified file, or compiled from another language — where the shake removes almost nothing and walking it is most of the build. Each ships as it is, so nothing inside it is dead-code eliminated.').optional(),
  bundleUi: z.boolean().describe('Bundle a copy of @apackdev/ui into the pack instead of using the host app\'s. All of @apackdev/ui is bundled, so the pack never mixes the two.').optional(),
}).strict().describe('Build-time configuration: settings that change what the build produces, never what the app loads.');

const TextEditorExtensionsSchema = z.object({
  extensions: declarationRecord(IdentifierSchema, ExportTargetSchema).describe('Tiptap extension name to its exported extension object ("path#exportName"). Each key must match the exported object\'s Tiptap name.').optional(),
  popups: declarationRecord(IdentifierSchema, ModulePathSchema).describe('Popup IDs local to this group, mapped to pack-root-relative Vue component modules.').optional(),
  isSuggestionActive: ExportTargetSchema.describe('Exported predicate ("path#exportName") reporting whether this group has an active suggestion for the current editor state.').optional(),
} satisfies Record<keyof TextEditorExtensionsDeclaration, z.ZodTypeAny>).strict();

const FrontendConfigSchema = z.object({
  textEditor: declarationRecord(IdentifierSchema, TextEditorExtensionsSchema).describe('Named rich-text editor contribution groups. Extensions, popup IDs and the optional suggestion predicate are declared without loading pack code.').optional(),
  appExtensions: declarationRecord(IdentifierSchema, ModulePathSchema).describe('Named app extensions. Keys are extension names (identifiers), values are paths to Vue components.').optional(),
} satisfies Record<keyof FrontendDeclaration, z.ZodTypeAny>).strict().describe('Frontend contributions: what the pack adds to the app\'s own UI.');

/**
 * An extension point keyed by the type it contributes: the key grammar and the clause every one of them
 * repeats, said once. Three records spelling it out is three places it can drift from
 * `EXTENSION_TYPE_SCHEMA` — and the rule is the same rule, since what makes a contribution unique is that
 * JSON cannot hold a key twice.
 *
 * `dsl` is deliberately not one of these: its keys are DSL namespace names rather than contributed types,
 * so they answer to no type grammar.
 */
function extensionPoint<T extends z.ZodTypeAny>(
  entry: T,
  what: string,
  key: z.ZodString = EXTENSION_TYPE_SCHEMA,
) {
  return declarationRecord(key, entry)
    .describe(`${what} The type is the key, so a pack cannot declare one twice.`)
    .optional();
}

/**
 * What the pack gives the host, as against what it is made of (`features`) or what data it ships
 * (`content`). Every entry is a contribution the app registers and some other pack or the shell can
 * reach; a setting that only changes what `apack pack build` produces is `build`, not one of these.
 */
/**
 * Slash commands declared in the manifest, as a shorthand for a content directory.
 *
 * **It seeds documents; it does not provide commands.** The build desugars this into ordinary content
 * under `DECLARED_COMMANDS_KEY`, so what a user gets is a document they own: they may edit a placeholder
 * or delete the document, and a deleted one is not written again. That is weaker than the declaration
 * this key replaced, which came and went with the pack, and it is the price of commands being content.
 *
 * **`list` is nested rather than the key itself** so that `onUserEdit` has somewhere to sit that is not
 * also a command name. A flat record with a reserved sibling parses (no command name can be spelled
 * `onUserEdit`), but its inferred type is a catchall that every consumer of `PackManifest` then carries.
 */
const CommandsExtensionSchema = z.object({
  list: declarationRecord(
    z.string().regex(COMMAND_NAME, 'A command name must be a lowercase letter, then lowercase letters, digits and hyphens'),
    z.object({
      placeholder: z.string().min(1).describe('What the chat shows after the command name, as a hint for what to type.'),
    }).strict(),
  ).describe('The commands, keyed by the name typed after the "/".'),
  onUserEdit: ON_USER_EDIT.optional(),
}).strict().superRefine((commands, ctx) => {
  if (Object.keys(commands.list).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['list'], message: 'extensions.commands declares no command: give it at least one, or leave the key out' });
  }
}).describe('Slash commands this pack seeds. Desugared into ordinary content, so a user owns and may delete what it writes.');

const ExtensionsSchema = z.object({
  commands: CommandsExtensionSchema.optional(),
  settings: declarationRecord(z.string().regex(FEATURE_ID_PATTERN, 'A settings group must start with a lowercase letter and contain only letters and digits'), SettingsDefinitionSchema)
    .describe('Pack-owned preference groups keyed by local group ID; stored under this pack, independently of app and feature settings.').optional(),
  help: z.object({ path: z.string().min(1).describe('Pack-root-relative directory of Markdown help articles compiled during the pack build.') }).strict()
    .describe('Markdown help articles compiled into the snapshot for inspection without loading pack code.').optional(),
  steps: extensionPoint(StepEntrySchema, 'Flow step types this pack contributes. Inline node and editor data with explicit build, component, layout, type and runtime bindings.'),
  artifacts: extensionPoint(ArtifactEntrySchema, 'Artifact types this pack contributes. Each names its icon and viewer.'),
  blocks: extensionPoint(BlockEntrySchema, 'Message blocks this pack contributes. Each names where its code lives.'),
  services: ServicesSchema
    .describe('Pack-level services, belonging to no one feature. Keys are service names on `services`, values are "path#exportName" of the service object (an object literal or a class instance, not a factory) in a source file. A feature\'s own are its `services`.').optional(),
  dsl: declarationRecord(z.string(), DslEntrySchema).describe('DSL type definitions for Monaco editor intellisense.').optional(),
  ...FrontendConfigSchema.shape,
}).strict().describe('What the pack contributes to the app: steps, artifacts, blocks, services, DSL types, help articles and frontend extensions.');


// ── Main manifest schema ────────────────────────────────────────────

/**
 * A migration's key: the version it targets, which is the only place that version is written. Exported
 * because `apack pack add migration` checks a version against it before writing one — the schema is what
 * refuses a bad key, and it cannot do so until the manifest has already been written.
 */
export const MIGRATION_TARGET_PATTERN = /^\d+\.\d+\.\d+$/;

const MIGRATION_TARGET_SCHEMA = z.string()
  .regex(MIGRATION_TARGET_PATTERN, 'Must be the version the migration targets, as "major.minor.patch"');

/**
 * Migrations, keyed by the version each targets, under the **version line** that version belongs to.
 *
 * **Two maps rather than one, because a bare version does not say what it is a version of.** `0.4.0` is
 * either apack's release or the pack's own, and letting the *runner* decide — from the pack's
 * provenance, which is the one thing about a pack that correlates with neither — makes the same key mean
 * both. `default-setup` is the pack that shows why: its own `version` is `0.1.0` while its migrations are
 * keyed `0.3.0`-`0.4.0`, because they are apack's releases, and a user's own build installed at that
 * id would have its versions compared against the app's.
 *
 * - `app` — the data moves when apack moves. A prerelease counts as its release, and a development
 *   build runs every pending one on each boot (`@apackdev/host`'s runners).
 * - `pack` — the data moves when this pack moves, against `version` in this manifest.
 *
 * **A map rather than a field on each entry**, because a field needs a default and whichever default it took
 * would be the next thing silently deciding for an author. The key stays the target, so one line cannot
 * declare the same version twice — JSON cannot hold a key twice.
 */
export const MigrationDeclarationSchema = z.object({
  description: z.string().min(1).describe('What this versioned data change does.'),
  up: ExportTargetSchema.describe('Synchronous function applying the change.'),
}).strict();

export const MigrationsSchema = z.object({
  app: declarationRecord(MIGRATION_TARGET_SCHEMA, MigrationDeclarationSchema)
    .describe('Migrations on apack\'s version line, keyed by the release each targets. For data whose shape follows the app rather than this pack.').optional(),
  pack: declarationRecord(MIGRATION_TARGET_SCHEMA, MigrationDeclarationSchema)
    .describe('Migrations on this pack\'s own version line, keyed by the version each targets, compared against `version` in this manifest.').optional(),
}).strict().describe('Migrations this pack runs, under the version line each targets. The key is the version; the declaration owns its description and names the executable up function.');

/**
 * The version lines, derived from the schema so the list and the keys cannot disagree. Codegen emits a map
 * per line and the runners read one each.
 */
export const MIGRATION_LINES = Object.keys(MigrationsSchema.shape) as MigrationLine[];

/** Which version line a migration's target is a version of */
export type MigrationLine = keyof typeof MigrationsSchema.shape;

/**
 * The lines are one vocabulary written twice — here with the schema's descriptions, and in
 * `PackMigrations` with the doc comments a pack author hovers — because a Zod shape cannot carry the second
 * and a type cannot be built at runtime. This fails the typecheck the moment they part, which is the thing
 * writing it twice costs.
 *
 * @internal
 */
type _Asserted<T extends true> = T;
export type _MigrationLinesMatchRegistration = _Asserted<
  MigrationLine extends keyof PackMigrations
    ? keyof PackMigrations extends MigrationLine ? true : ['the registration declares a line the manifest does not', Exclude<keyof PackMigrations, MigrationLine>]
    : ['the manifest declares a line the registration does not', Exclude<MigrationLine, keyof PackMigrations>]
>;

export const ManifestSchema = z.preprocess(checkDeclaredNames, z.object({
  $schema: z.string().describe('JSON Schema reference for editor validation.').optional(),
  id: z.string().regex(PACK_ID_PATTERN, 'Must be lowercase alphanumeric with hyphens')
    .refine((id) => id !== HOST_PACK_ID, { message: `"${HOST_PACK_ID}" is the app's own pack id: pick another` })
    .describe('Unique pack identifier. Lowercase, alphanumeric with hyphens.'),
  name: z.string().min(1).describe('Human-readable pack name.'),
  version: PackVersionSchema
    .describe('Complete SemVer 2.0 version (major.minor.patch), optionally with prerelease and build metadata.'),
  description: z.string().describe('Short description of the pack\'s purpose.').optional(),
  hostVersion: PackRangeSchema.describe('Nonempty npm semver range for compatible host versions (e.g. ">=0.3.0").').optional(),
  license: z.string().describe('SPDX license identifier.').optional(),
  dependencies: declarationRecord(z.string().regex(PACK_ID_PATTERN), PackDependencySchema)
    .describe('Other packs this pack depends on. Keys are pack IDs, values are nonempty semver ranges, file:<path> or github:<owner>/<repo> [range].').optional(),
  consumes: PackConsumptionSchema.optional(),
  permissions: z.array(PackPermissionSchema).describe('Capabilities this pack requires from the host.').optional(),
  data: DataSchema.optional(),
  features: declarationRecord(FEATURE_ID_SCHEMA, FeatureEntrySchema)
    .describe('Feature definitions, keyed by feature id. Each feature bundles a backend system, frontend surface, services, and settings; the id is the key, so a pack cannot declare one twice.').optional(),
  extensions: ExtensionsSchema.optional(),
  lifecycle: LifecycleConfigSchema.optional(),
  content: ContentConfigSchema.optional(),
  migrations: MigrationsSchema.optional(),
  build: BuildConfigSchema.optional(),
  checks: PackChecksSchema.optional(),
}).strict().superRefine((manifest, ctx) => {
  checkFrontendClaims(manifest.extensions, ctx, ['extensions']);
  checkReferenceClaims(manifest.features, ctx);
  checkApiClaims(manifest.features, manifest.extensions?.services, undefined, ctx, ['extensions', 'services']);
  checkDefaultSurfaceClaims(manifest.features, ctx);
  checkServiceProviders(manifest, ctx);

  // Both kinds of entry name a format, and both are checked against the same two places
  for (const section of ['sources', 'datasets'] as const) {
    for (const [key, entry] of Object.entries(manifest.content?.[section] ?? {})) {
      if (typeof entry !== 'object' || !entry.format) continue;
      const [, pack, name] = CONTENT_FORMAT_REF.exec(entry.format) ?? [];
      if (!name) continue;
      const at = ['content', section, key, 'format'];
      if (pack === undefined && !hasOwn(manifest.content?.formats ?? {}, name)) {
        ctx.addIssue({ code: 'custom', path: at, message: `Content "${key}": no format "${name}" in content.formats` });
      } else if (pack !== undefined && !hasOwn(manifest.dependencies ?? {}, pack)) {
        ctx.addIssue({ code: 'custom', path: at, message: `Content "${key}": format "${entry.format}" names "${pack}", which isn't a dependency` });
      }
    }
  }
  // A key is a file name in the compiled output, so the two sections cannot share one
  for (const key of Object.keys(manifest.content?.datasets ?? {})) {
    if (hasOwn(manifest.content?.sources ?? {}, key)) {
      ctx.addIssue({ code: 'custom', path: ['content', 'datasets', key], message: `"${key}" is both a content source and a dataset: they compile to the same file` });
    }
  }
  checkContentWriterClaims(manifest, ctx);
}));
