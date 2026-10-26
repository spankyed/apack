import { type DeclarationData, type NativePackDeclaration, _stepBackendParts } from '@apackdev/sdk/framework';
import { _packEntityTypes, _packRelationTypes, _packRoles, declaredContentKeys } from '@apackdev/sdk/framework';
import { lifecycleBindingProblem } from './lifecycle-binding.ts';
import type { PackManifest, StepEntry } from '@apackdev/sdk/build';
import { isPlainObject } from '@apackdev/sdk/utils/pure';
import { namedBindings, sameKeys, sameNames } from './binding-shape.ts';
import { isDeepStrictEqual } from 'node:util';
import { eventBindingProblem } from './event-binding.ts';
import type { PackEventContracts } from '@apackdev/sdk/framework';

interface ApiOwnerDeclaration {
  readonly services?: Readonly<Record<string, string>>;
  readonly repositories?: Readonly<Record<string, string>>;
}

/** Declared ownership is independent of constructing services or calling repository methods. */
export function apiBindingProblem(features: Readonly<Record<string, ApiOwnerDeclaration>> | undefined,
  pack: ApiOwnerDeclaration, registration: unknown): string | undefined {
  if (!isPlainObject(registration)) return 'registration';
  const runtimeFeatures = registration.features === undefined ? {} : registration.features;
  if (!isPlainObject(runtimeFeatures)) return 'features';
  for (const [id, feature] of Object.entries(features ?? {})) {
    const runtime = runtimeFeatures[id];
    if (!isPlainObject(runtime)) return `features.${id}`;
    if (!sameNames(runtime.services === undefined ? [] : runtime.services, Object.keys(feature.services ?? {}))) return `features.${id}.services`;
  }
  for (const kind of ['services', 'repositories'] as const) {
    const names = [...Object.keys(pack[kind] ?? {}), ...Object.values(features ?? {}).flatMap(feature => Object.keys(feature[kind] ?? {}))];
    if (!sameKeys(registration[kind] === undefined ? {} : registration[kind], names)) return kind;
  }
}

/** Content bindings provide data operations, independently of backend activation. */
export function contentBindingProblem(manifest: PackManifest, runtime: unknown, appliers?: unknown): string | undefined {
  const problem = (path: string) => `Pack "${manifest.id}" content runtime ${path} does not match its accepted declarations`;
  if (!isPlainObject(runtime)) return problem('registration');
  if (!isDeepStrictEqual(runtime.entities, _packEntityTypes(manifest))) return problem('entities');
  if (!isDeepStrictEqual(runtime.relKinds, _packRelationTypes(manifest))) return problem('relKinds');
  if (!isDeepStrictEqual(runtime.roles, _packRoles(manifest))) return problem('roles');
  const repositories = Object.values(manifest.features ?? {}).flatMap(feature => Object.keys(feature.repositories ?? {}));
  if (!sameKeys(runtime.repositories, repositories)) return problem('repositories');
  if (!sameKeys(runtime.contentWriters, Object.keys(manifest.content?.writers ?? {}))) return problem('contentWriters');
  if (appliers !== undefined) {
    const declared = declaredContentKeys(manifest);
    if (!Array.isArray(appliers) || appliers.some(applier => !applier || typeof applier !== 'object' || Array.isArray(applier)
      || typeof applier.key !== 'string' || !declared.includes(applier.key))) return problem('appliers');
    if (new Set(appliers.map(applier => applier.key)).size !== appliers.length) return problem('appliers');
  }
}

/** Check contributed identities before any runtime object enters the registry. */
export function backendBindingProblem(manifest: PackManifest, registration: unknown, eventContracts?: Readonly<PackEventContracts>): string | undefined {
  const problem = (path: string) => `Pack "${manifest.id}" runtime ${path} does not match its accepted declarations`;
  if (!isPlainObject(registration)) return problem('registration');
  const declared = manifest.features ?? {};
  const features = registration.features === undefined ? {} : registration.features;
  if (!sameKeys(features, Object.keys(declared))) return problem('features');
  if (!isPlainObject(features)) return problem('features');
  for (const [id, declaration] of Object.entries(declared)) {
    const feature = features[id];
    if (!isPlainObject(feature)) return problem(`features.${id}`);
    if (feature.designation !== declaration.designation) return problem(`features.${id}.designation`);
    for (const kind of ['system', 'surface'] as const) {
      if ((feature[kind] !== undefined) !== (declaration[kind] !== undefined)) return problem(`features.${id}.${kind}`);
      if (declaration[kind] && !isPlainObject(feature[kind])) return problem(`features.${id}.${kind}`);
    }
    if ((feature.views !== undefined) !== (declaration.views !== undefined)) return problem(`features.${id}.views`);
    if (feature.views !== undefined && (!isPlainObject(feature.views)
      || Object.values(feature.views).some(view => typeof view !== 'function'))) return problem(`features.${id}.views`);
  }
  const eventsProblem = eventBindingProblem(eventContracts, features);
  if (eventsProblem) return problem(eventsProblem);
  const apiProblem = apiBindingProblem(declared, { services: manifest.extensions?.services }, registration);
  if (apiProblem) return problem(apiProblem);

  const ears = registration.ears === undefined ? {} : registration.ears;
  if (!isPlainObject(ears)) return problem('ears');
  if (!isDeepStrictEqual(ears.entities === undefined ? {} : ears.entities, _packEntityTypes(manifest))) return problem('ears.entities');
  if (!isDeepStrictEqual(ears.relKinds === undefined ? {} : ears.relKinds, _packRelationTypes(manifest))) return problem('ears.relKinds');
  if (!isDeepStrictEqual(ears.roles === undefined ? {} : ears.roles, _packRoles(manifest))) return problem('ears.roles');
  const contentProblem = backendContentBindingProblem(manifest, registration);
  if (contentProblem) return problem(contentProblem);

  const viewerProblem = backendViewerBindingProblem(manifest.extensions ?? {}, registration);
  if (viewerProblem) return problem(viewerProblem);

  const stepProblem = backendStepBindingProblem(manifest.extensions?.steps, registration.steps);
  if (stepProblem) return problem(stepProblem);

  const migrationProblem = migrationBindingProblem(manifest.migrations, registration.migrations);
  if (migrationProblem) return problem(migrationProblem);
  const lifecycleProblem = lifecycleBindingProblem(manifest.lifecycle, registration.lifecycle);
  if (lifecycleProblem) return problem(lifecycleProblem);
}

/** Compare declared step data and executable slot membership without invoking any facet. */
export function backendStepBindingProblem(declarations: DeclarationData<Record<string, StepEntry>> | undefined, actual: unknown): string | undefined {
  const steps = namedBindings(actual, 'type', Object.keys(declarations ?? {}));
  if (!steps) return 'steps';
  for (const [type, declaration] of Object.entries(declarations ?? {})) {
    const step = steps.get(type)!;
    if ((step.kind === undefined ? 'step' : step.kind) !== (declaration.kind ?? 'step')) return `steps.${type}.kind`;
    if (step.fe !== undefined) return `steps.${type}.fe`;
    if (!isDeepStrictEqual(step.node, declaration.node)) return `steps.${type}.node`;
    const parts = _stepBackendParts(declaration);
    for (const facet of ['build', 'trigger'] as const) {
      const expected = parts[facet];
      const actual = step[facet];
      if ((actual !== undefined) !== (expected !== undefined)) return `steps.${type}.${facet}`;
      if (!expected) continue;
      if (!isPlainObject(actual)) return `steps.${type}.${facet}`;
      const declaredKeys = [...Object.keys(expected.data), ...Object.keys(expected.callbacks)];
      for (const [name, value] of Object.entries(expected.data)) {
        if (!isDeepStrictEqual(actual[name], value)) return `steps.${type}.${facet}.${name}`;
      }
      for (const name of Object.keys(expected.callbacks)) {
        if (typeof actual[name] !== 'function') return `steps.${type}.${facet}.${name}`;
      }
      const extra = Object.keys(actual).find(name => !declaredKeys.includes(name));
      if (extra !== undefined) return `steps.${type}.${facet}.${extra}`;
    }
    const runtime = declaration.runtime;
    const hasRuntime = Boolean(runtime?.handler || runtime?.isAsync || runtime?.waits || runtime?.spawnsSubflow);
    if ((step.runtime !== undefined) !== hasRuntime) return `steps.${type}.runtime`;
    if (hasRuntime) {
      if (!isPlainObject(step.runtime)) return `steps.${type}.runtime`;
      if ((step.runtime.handler !== undefined) !== (runtime?.handler !== undefined)
        || (step.runtime.handler !== undefined && typeof step.runtime.handler !== 'function')) return `steps.${type}.runtime.handler`;
      for (const flag of ['isAsync', 'waits', 'spawnsSubflow'] as const) {
        if ((step.runtime[flag] === undefined ? false : step.runtime[flag]) !== (runtime?.[flag] ?? false)) return `steps.${type}.runtime.${flag}`;
      }
    }
  }
}

/** Backend viewers share declared identities and facets across native and built packs. */
export function backendViewerBindingProblem(declarations: DeclarationData<Pick<NativePackDeclaration, 'artifacts' | 'blocks'>>,
  registration: unknown): string | undefined {
  if (!isPlainObject(registration)) return 'registration';
  const artifacts = namedBindings(registration.artifacts, 'type', Object.keys(declarations.artifacts ?? {}));
  if (!artifacts) return 'artifacts';
  for (const [type, artifact] of artifacts) if (artifact.fe !== undefined) return `artifacts.${type}.fe`;

  const blocks = namedBindings(registration.blocks, 'type', Object.keys(declarations.blocks ?? {}));
  if (!blocks) return 'blocks';
  for (const [type, declaration] of Object.entries(declarations.blocks ?? {})) {
    const block = blocks.get(type)!;
    if ((block.kind === undefined ? 'display' : block.kind) !== (declaration.kind ?? 'display')) return `blocks.${type}.kind`;
    if (block.fe !== undefined) return `blocks.${type}.fe`;
    if ((block.be !== undefined) !== (declaration.be !== undefined)) return `blocks.${type}.be`;
    if (block.be !== undefined && (!block.be || typeof block.be !== 'object' || Array.isArray(block.be))) return `blocks.${type}.be`;
  }
}

/** Match executable content operations to their declared names without applying content. */
export function backendContentBindingProblem(
  /** The declaration, not just its content: a declared content key can come from `extensions.commands` */
  declaration: { content?: Pick<NonNullable<PackManifest['content']>, 'sources' | 'writers'>; extensions?: { commands?: unknown } } | undefined,
  registration: unknown,
): string | undefined {
  if (!isPlainObject(registration)) return 'registration';
  if (!sameKeys(registration.contentWriters === undefined ? {} : registration.contentWriters,
    Object.keys(declaration?.content?.writers ?? {}))) return 'contentWriters';
  if (!namedBindings(registration.appliers, 'key', declaredContentKeys(declaration ?? {}))) return 'appliers';
}

/** Match version-line targets, descriptions and callable bindings without executing migrations. */
export function migrationBindingProblem(declarations: DeclarationData<PackManifest['migrations']>, actual: unknown): string | undefined {
  const migrations = actual === undefined ? {} : actual;
  if (!isPlainObject(migrations) || Object.keys(migrations).some(line => line !== 'app' && line !== 'pack')) return 'migrations';
  for (const line of ['app', 'pack'] as const) {
    const entries = namedBindings(migrations[line], 'target', Object.keys(declarations?.[line] ?? {}));
    if (!entries) return `migrations.${line}`;
    for (const [target, entry] of entries) {
      if (typeof entry.up !== 'function' || entry.description !== declarations![line]![target].description) return `migrations.${line}.${target}`;
    }
  }
}
