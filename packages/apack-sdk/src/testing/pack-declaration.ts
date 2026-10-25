import type { StepEntry } from '../build/manifest.ts';
import type { NativePackDeclaration } from '../framework/pack-catalog.ts';
import type { PackRegistration } from '../framework/pack-registration.ts';

/**
 * Compose declaration data before registering runtime stand-ins. Supply the native version as metadata
 * for pack-line migrations; executable registration does not own that version.
 */
export function nativePackDeclarationFixture(fixture: PackRegistration, metadata: Pick<NativePackDeclaration, 'version'> = {}): NativePackDeclaration {
  const featureServices = new Set(Object.values(fixture.features ?? {}).flatMap(feature => feature.services ?? []));
  const target = (kind: string, names: readonly string[]) => Object.fromEntries(names.map(name =>
    [name, `fixtures/${kind}.ts#${name}`]));
  return {
    id: fixture.id,
    ...(metadata.version !== undefined && { version: metadata.version }),
    ...(fixture.migrations !== undefined && { migrations: Object.fromEntries((['app', 'pack'] as const).flatMap(line => {
      const entries = fixture.migrations?.[line];
      return entries === undefined ? [] : [[line, Object.fromEntries(entries.map(({ target, description }) => [target, {
        description, up: `fixtures/migrations/${line}.ts#up_${target.replace(/[^A-Za-z0-9_$]/g, '_')}`,
      }]))]];
    })) }),
    eventContracts: Object.fromEntries(Object.entries(fixture.features ?? {})
      .filter(([, feature]) => feature.system || feature.surface).map(([id, feature]) => [id, {
        ...(feature.system && { system: { incoming: [...feature.system.receives], outgoing: [] } }),
        ...(feature.surface && { surface: { receives: [...feature.surface.receives] } }),
      }])),
    ...((fixture.contentWriters !== undefined || fixture.appliers !== undefined) && { content: {
      ...(fixture.contentWriters !== undefined && { writers: target('writers', Object.keys(fixture.contentWriters)) }),
      ...(fixture.appliers !== undefined && { sources: Object.fromEntries(fixture.appliers.map(({ key }) => [key, { applier: `fixtures/content/${key}.ts` }])) }),
    } }),
    ...(fixture.artifacts !== undefined && { artifacts: Object.fromEntries(fixture.artifacts.map(({ type }) => [type, { icon: 'File' }])) }),
    ...(fixture.blocks !== undefined && { blocks: Object.fromEntries(fixture.blocks.map(block => [block.type, {
      ...(block.kind !== undefined && { kind: block.kind }),
      ...(block.be !== undefined && { be: `fixtures/blocks.ts#${block.type.replace(/[^A-Za-z0-9_$]/g, '_')}` }),
    }])) }),
    ...(fixture.lifecycle && { lifecycle: Object.fromEntries(Object.keys(fixture.lifecycle).map(name =>
      [name, `fixtures/lifecycle.ts#${name}`])) }),
    ...(fixture.ears && { data: {
      // Each entity as its registration numbers it: the prefix it registers is the one its declaration carries
      entities: Object.fromEntries(Object.keys(fixture.ears.entities ?? {}).map((name) => {
        const shortCode = fixture.ears?.rowRules?.[name]?.shortCode;
        return [name, shortCode ? { shortCode } : {}];
      })),
      relations: Object.fromEntries(Object.values(fixture.ears.relKinds ?? {}).map((kind) => [kind, fixture.ears?.relationRules?.[kind] ?? {}])),
      roles: Object.values(fixture.ears.roles ?? {}),
    } }),
    ...(fixture.steps !== undefined && { steps: Object.fromEntries(fixture.steps.map(step => {
      const prefix = `fixtures/steps.ts#${step.type.replace(/[^A-Za-z0-9_$]/g, '_')}`;
      const runtime = step.runtime;
      const node = step.node;
      if (node === undefined) throw new Error(`Native step fixture "${fixture.id}/${step.type}" needs declared node data`);
      return [step.type, {
        node, ...(step.kind !== undefined && { kind: step.kind }),
        ...(step.build && { build: {
          compile: `${prefix}Compile`, validate: `${prefix}Validate`, getLabel: `${prefix}GetLabel`,
          ...(step.build.decompile && { decompile: `${prefix}Decompile` }),
          ...(step.build.branches && { branches: `${prefix}Branches` }),
          ...(step.build.relation !== undefined && { relation: step.build.relation }),
        } }),
        ...(step.trigger && { trigger: {
          trackField: step.trigger.trackField, compile: `${prefix}Compile`, decompile: `${prefix}Decompile`,
          ...(step.trigger.persistent !== undefined && { persistent: step.trigger.persistent }),
          ...(step.trigger.queryFields !== undefined && { queryFields: step.trigger.queryFields }),
          ...(step.trigger.validateTrack && { validateTrack: `${prefix}ValidateTrack` }),
          ...(step.trigger.validate && { validate: `${prefix}Validate` }),
          ...(step.trigger.register && { register: `${prefix}Register` }),
        } }),
        ...(runtime && { runtime: {
          ...(runtime.handler && { handler: `${prefix}Handler` }),
          ...(runtime.isAsync && { isAsync: true }), ...(runtime.waits && { waits: true }),
          ...(runtime.spawnsSubflow && { spawnsSubflow: true }),
        } }),
      } satisfies StepEntry];
    })) }),
    ...(fixture.dependencies !== undefined && { dependencies: fixture.dependencies }),
    ...(fixture.settings !== undefined && { settings: fixture.settings }),
    ...(fixture.services !== undefined && { services: target('services', Object.keys(fixture.services).filter(name => !featureServices.has(name))) }),
    ...(fixture.repositories !== undefined && { repositories: target('repositories', Object.keys(fixture.repositories)) }),
    features: Object.fromEntries(Object.entries(fixture.features ?? {}).map(([id, feature]) => [id,
      { description: `Test fixture for ${id}.`, ...(feature.settings !== undefined && { settings: feature.settings }),
        ...(feature.designation !== undefined && { designation: feature.designation }),
        ...(feature.services !== undefined && { services: target('services', feature.services) }) }])),
  };
}
