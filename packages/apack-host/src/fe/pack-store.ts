// The packs whose frontends the renderer registered, as an instance: the renderer creates one and binds its read
// face for the SDK's frontend lookups (`bindFeHost({ packs })`). It holds the only writes to it.
import type { DeclarationData, SurfaceDeclaration } from '@apackdev/sdk/framework';
import type { ReferenceTypeConfig, ReferenceBindings, ReferenceBinding } from '@apackdev/sdk/fe/references';
import type { Surface, PackFERegistration, TextEditorExtensions, TextEditorExtensionsBinding, SettingsPort, StepFrontendBinding, ArtifactFrontendBinding, BlockFrontendBinding } from '@apackdev/sdk/fe';
import type { FePackRegistryView } from '@apackdev/sdk/runtime';
import { createDesignationStore, createOwnedStepStore } from '../packs/extensions.ts';
import { resolveName, type FeatureRef } from '@apackdev/sdk/ids';
import { createFrontendSettingsBinding } from './settings-binding.ts';
import { checkFeatureIds } from '../packs/feature-ids.ts';
import { settingsTargetPath, type SettingsTarget } from '@apackdev/sdk/types';
import { createLogger } from '@apackdev/sdk/logger';
import { captureFrontendAdmission, frontendIdentityProblem, type FrontendAdmission, type AcceptedFrontendAdmission } from './frontend-admission.ts';
import { captureFrontendBindings } from './binding-snapshot.ts';
import { frontendBindingProblem } from './declaration-binding.ts';

type OwnedReferenceBindings = {
  types: Record<string, ReferenceBinding<ReferenceTypeConfig>>;
  categories: Record<string, ReferenceBinding<ReferenceBindings['categories'][string]>>;
};

type SettingsForm = NonNullable<PackFERegistration['settingsForms']>[string];

const formKey = (target: SettingsTarget): string => settingsTargetPath(target).join('/');

/** Host-owned settings resource for one accepted frontend, including transport cleanup. */
export interface FrontendSettingsBinding {
  port: SettingsPort;
  dispose(): void;
}

/** An accepted app-slot component and the pack whose frontend owns it. */
export interface AppExtensionFrontendBinding {
  readonly packId: string;
  readonly component: NonNullable<PackFERegistration['appExtensions']>[string];
}

/** The renderer's registered pack frontends */
export interface FePackRegistry extends FePackRegistryView {
  /** Registers a pack's frontend, and returns its surfaces as registered: each at its feature's ref */
  registerPackFE(admission: FrontendAdmission, registration: PackFERegistration, settings?: FrontendSettingsBinding): Surface[];
  /** Prepare a fresh or replacement frontend without publishing it; disposal cancels only this candidate. */
  preparePackFE(admission: FrontendAdmission, registration: PackFERegistration, settings?: FrontendSettingsBinding, replacing?: boolean): PreparedFrontend;
  /** Replace an existing owner; failure preserves its accepted resources. */
  replacePackFE(admission: FrontendAdmission, registration: PackFERegistration, settings?: FrontendSettingsBinding): Surface[];
  hasPackFE(packId: string): boolean;
  prepareUnregisterPackFE(packId: string): PreparedFrontend;
  /** Unregisters a pack's frontend; returns the surfaces it had added */
  unregisterPackFE(packId: string): Surface[];
  /** Every registered surface, in registration order */
  getRegisteredSurfaces(): Surface[];
  surfaceBindings(): ReadonlyMap<string, SurfaceFrontendBinding>;
  /** Identity of this accepted frontend instance; replacement changes it even when components are reused. */
  frontendIdentity(packId: string): Readonly<Pick<AcceptedFrontendAdmission, 'declarationRevision' | 'registrationId' | 'buildRevision'>> | undefined;
  getAppExtension(slot: string): ReturnType<FePackRegistryView['appExtension']>;
  appExtensionBinding(slot: string): AppExtensionFrontendBinding | undefined;
  /** Lookup of an accepted form; installed declarations remain separate from executable availability. */
  settingsForm(target: SettingsTarget): SettingsForm | undefined;
}

/**
 * A registration addressed once: each surface at its feature's ref, with its default claim, and each role at the ref of
 * the feature that plays it, that feature's surface or not
 */
type AddressedRegistration = PackFERegistration & {
  addressed: Array<{ surface: Surface; default?: true }>;
  roles: Record<string, FeatureRef>;
};

function addressed(registration: PackFERegistration): AddressedRegistration {
  const features = Object.entries(registration.features ?? {}).map(([id, feature]) => [id, { ...feature }] as const);
  const defaults = features.filter(([, feature]) => feature.default);
  if (defaults.length > 1) throw new Error(`Pack "${registration.id}" declares default surfaces "${defaults[0]![0]}" and "${defaults[1]![0]}"; only one may be claimed`);
  if (defaults[0] && !defaults[0][1].surface) throw new Error(`Pack "${registration.id}" declares a default for feature "${defaults[0][0]}" without a surface`);
  const roles = new Map<string, FeatureRef>();
  for (const [id, feature] of features) {
    if (!feature.designation) continue;
    if (roles.has(feature.designation)) throw new Error(`Pack "${registration.id}" declares designation "${feature.designation}" twice`);
    roles.set(feature.designation, resolveName(id, registration.id));
  }
  return {
    ...registration,
    features: Object.fromEntries(features),
    addressed: features.flatMap(([featureId, feature]) => feature.surface
      ? [{ surface: Object.freeze({ ...feature.surface, id: resolveName(featureId, registration.id) }) as Surface, default: feature.default }]
      : []),
    roles: Object.fromEntries(roles),
  };
}

/** A staged frontend cannot change the published view until its commit. */
export interface PreparedFrontend {
  surfaces: Surface[];
  /** Commit other prepared host resources after revision checks, before publishing the lookup view. */
  commit(beforePublish?: () => void): Surface[];
  dispose(): void;
}

/** A surface implementation admitted against a captured declaration and backend generation. */
export interface SurfaceFrontendBinding {
  readonly opens?: readonly string[];
  readonly packId: string;
  readonly declaration: DeclarationData<SurfaceDeclaration>;
  readonly declarationRevision?: string;
  readonly registrationId?: string;
  readonly buildRevision?: string;
  readonly binding: Surface;
}

type DefinitionEntry<T> = readonly [string, T];
interface FrontendContributions {
  id: string;
  identity: Readonly<Pick<AcceptedFrontendAdmission, 'declarationRevision' | 'registrationId' | 'buildRevision'>>;
  addressed: AddressedRegistration['addressed'];
  surfaceBindings: SurfaceFrontendBinding[];
  roles: Record<string, FeatureRef>;
  forms: Array<readonly [string, SettingsForm]>;
  steps: Array<DefinitionEntry<StepFrontendBinding>>;
  artifacts: Array<DefinitionEntry<ArtifactFrontendBinding>>;
  blocks: Array<DefinitionEntry<BlockFrontendBinding>>;
  textEditor: Array<[string, TextEditorExtensions]>;
  appExtensions: Array<readonly [string, SettingsForm]>;
  references: OwnedReferenceBindings[];
  bindSettings: PackFERegistration['bindSettings'];
}

function captureReferenceType(type: ReferenceTypeConfig): ReferenceTypeConfig {
  const svgElements = structuredClone(type.svgElements);
  for (const element of svgElements) { Object.freeze(element[1]); Object.freeze(element); }
  return Object.freeze({ ...type, svgElements: Object.freeze(svgElements) });
}

function capture(registration: PackFERegistration, identity: AcceptedFrontendAdmission): FrontendContributions {
  const reg = addressed({ ...registration });
  const revisions = {
    ...(identity.declarationRevision !== undefined && { declarationRevision: identity.declarationRevision }),
    ...(identity.registrationId !== undefined && { registrationId: identity.registrationId }),
    ...(identity.buildRevision !== undefined && { buildRevision: identity.buildRevision }),
  };
  checkFeatureIds(reg.id, Object.keys(reg.features ?? {}));
  checkFeatureIds(reg.id, Object.keys(reg.settingsForms ?? {}));
  return {
    id: reg.id, identity: Object.freeze(revisions), addressed: reg.addressed, roles: reg.roles, bindSettings: reg.bindSettings,
    surfaceBindings: reg.addressed.map(({ surface }) => Object.freeze({ packId: reg.id, ...revisions,
      ...(identity.entityDestinations && { opens: Object.freeze(Object.keys(identity.entityDestinations)
        .filter(entity => identity.entityDestinations![entity] === surface.id.slice(reg.id.length + 1)).sort()) }),
      declaration: identity.declarations.features![surface.id.slice(reg.id.length + 1)]!.surface!, binding: surface })),
    forms: [
      ...Object.entries(reg.features ?? {}).flatMap(([id, feature]) => feature.settingsForm
        ? [[formKey({ kind: 'feature', featureRef: resolveName(id, reg.id) }), feature.settingsForm] as const] : []),
      ...Object.entries(reg.settingsForms ?? {}).map(([id, component]) => [formKey({ kind: 'pack', packId: reg.id, groupId: id }), component] as const),
    ],
    references: Object.entries(reg.features ?? {}).flatMap(([id, feature]) => {
      const references = feature.references;
      if (!references) return [];
      const owner = { featureRef: resolveName(id, reg.id), ...revisions };
      return [{
        types: Object.fromEntries(Object.entries(references.types).map(([name, type]) => [name,
          Object.freeze({ ...owner, binding: captureReferenceType(type) })])),
        categories: Object.fromEntries(Object.entries(references.categories).map(([name, category]) => [name,
          Object.freeze({ ...owner, binding: Object.freeze({ ...category }) })])),
      }];
    }),
    steps: (reg.steps ?? []).map(value => [value.type, Object.freeze({ packId: reg.id, ...revisions,
      declaration: identity.declarations.extensions!.steps![value.type]!, binding: value })]),
    artifacts: (reg.artifacts ?? []).map(value => [value.type, Object.freeze({ packId: reg.id, ...revisions,
      declaration: identity.declarations.extensions!.artifacts![value.type]!, binding: value })]),
    blocks: (reg.blocks ?? []).map(value => [value.type, Object.freeze({ packId: reg.id, ...revisions,
      declaration: identity.declarations.extensions!.blocks![value.type]!, binding: value })]),
    textEditor: Object.entries(reg.textEditor ?? {}),
    appExtensions: Object.entries(reg.appExtensions ?? {}),
  };
}

function buildTables(packs: Iterable<FrontendContributions>) {
  const surfaces: Surface[] = [];
  const surfaceBindings = new Map<string, SurfaceFrontendBinding>();
  const designations = createDesignationStore();
  const steps = createOwnedStepStore<StepFrontendBinding>();
  const artifacts = new Map<string, ArtifactFrontendBinding>();
  const blocks = new Map<string, BlockFrontendBinding>();
  const appExtensions = new Map<string, AppExtensionFrontendBinding>();
  const forms = new Map<string, SettingsForm>();
  const textEditor: TextEditorExtensionsBinding[] = [];
  const editorOwners = new Map<string, string>();
  const referenceTypes = new Map<string, ReferenceBinding<ReferenceTypeConfig>>();
  const referenceCategories = new Map<string, ReferenceBinding<ReferenceBindings['categories'][string]>>();
  const referenceOwners = { types: new Map<string, FeatureRef>(), categories: new Map<string, FeatureRef>() };
  const claim = (kind: keyof typeof referenceOwners, name: string, owner: FeatureRef) => {
    const previous = referenceOwners[kind].get(name);
    if (previous !== undefined) throw new Error(`Reference ${kind} "${name}" claimed by both features "${previous}" and "${owner}"`);
    referenceOwners[kind].set(name, owner);
  };
  for (const pack of packs) {
    for (const references of pack.references) {
      for (const [name, type] of Object.entries(references.types)) {
        claim('types', name, type.featureRef);
        referenceTypes.set(name, type);
      }
      for (const [name, category] of Object.entries(references.categories)) {
        claim('categories', name, category.featureRef);
        referenceCategories.set(name, category);
      }
    }
    designations.register(pack.roles);
    surfaces.push(...pack.addressed.map(({ surface }) => surface));
    for (const binding of pack.surfaceBindings) surfaceBindings.set(binding.binding.id, binding);
    for (const [key, value] of pack.forms) forms.set(key, value);
    for (const [key, value] of pack.steps) { steps.set(key, value, pack.id); }
    for (const [key, value] of pack.artifacts) artifacts.set(key, value);
    for (const [key, value] of pack.blocks) blocks.set(key, value);
    for (const [key, component] of pack.appExtensions) appExtensions.set(key, Object.freeze({ packId: pack.id, component }));
    for (const [id, contribution] of pack.textEditor) {
      const owner = `${pack.id}/${id}`;
      for (const name of Object.keys(contribution.extensions ?? {})) {
        const previous = editorOwners.get(name);
        if (previous !== undefined) throw new Error(`Tiptap extension "${name}" declared by both "${previous}" and "${owner}"`);
        editorOwners.set(name, owner);
      }
      textEditor.push(Object.freeze({ packId: pack.id, groupId: id, binding: contribution }));
    }
  }
  return { surfaces, surfaceBindings, designations, steps, artifacts, blocks, appExtensions, forms, textEditor, referenceTypes, referenceCategories };
}

/** Published lookup data and executable resource lifetime have separate commit/retirement paths. */
export function createFePackRegistry(): FePackRegistry {
  const logger = createLogger('pack-frontends');
  let accepted = new Map<string, FrontendContributions>();
  let tables = buildTables(accepted.values());
  const bindings = new Map<string, ReturnType<typeof createFrontendSettingsBinding>>();
  const listeners = new Set<(packId: string) => void>();
  let revision = 0;
  let changing = false;
  function mutate<T>(operation: () => T): T {
    if (changing) throw new Error('A frontend registry change is already in progress');
    changing = true;
    try { return operation(); } finally { changing = false; }
  }
  function publishChange(packId: string) {
    for (const listener of listeners) {
      try { listener(packId); }
      catch (error) { logger.error('Frontend registry listener failed', error instanceof Error ? error : new Error(String(error))); }
    }
  }
  function retire(binding: ReturnType<typeof createFrontendSettingsBinding> | undefined) {
    const errors = binding?.dispose() ?? [];
    if (errors.length) logger.error('Frontend resource retirement failed', new AggregateError(errors, 'Frontend resource retirement failed'));
  }
  function prepareChange(id: string, next: Map<string, FrontendContributions>, projected: ReturnType<typeof buildTables>,
    binding: ReturnType<typeof createFrontendSettingsBinding> | undefined, surfaces: Surface[]): PreparedFrontend {
    const before = revision;
    let state: 'pending' | 'committed' | 'disposed' = 'pending';
    const discard = () => {
      if (state !== 'pending') return;
      state = 'disposed';
      retire(binding);
    };
    const dispose = () => { if (changing) discard(); else mutate(discard); };
    return {
      surfaces,
      commit(beforePublish) {
        try { return mutate(() => {
          if (state !== 'pending') throw new Error('Only a pending frontend may commit');
          if (revision !== before) throw new Error('The frontend registry changed while this candidate was prepared');
          // Before beforePublish, which commits the stylesheet irreversibly: activation runs pack code that may
          // throw, and must do so while the incumbent's styles are still in place. A refusal after it revokes the
          // binding in this same turn, so nothing the candidate wrote while activating is sent.
          binding?.activate();
          beforePublish?.();
          if (state !== 'pending') throw new Error('Frontend preparation was disposed before publication');
          const previous = bindings.get(id);
          accepted = next;
          tables = projected;
          if (binding) bindings.set(id, binding); else bindings.delete(id);
          state = 'committed';
          revision++;
          retire(previous);
          publishChange(id);
          return surfaces;
        }); } catch (error) { dispose(); throw error; }
      },
      dispose,
    };
  }
  function prepareUnregisterPackFE(id: string): PreparedFrontend {
    return mutate(() => {
      if (!accepted.has(id)) throw new Error(`Pack "${id}" frontend is not registered`);
      const next = new Map(accepted);
      next.delete(id);
      return prepareChange(id, next, buildTables(next.values()), undefined, []);
    });
  }
  function preparePackFE(authority: FrontendAdmission, registration: PackFERegistration, settings?: FrontendSettingsBinding, replacing = false): PreparedFrontend {
    const binding = createFrontendSettingsBinding(settings);
    try {
      return mutate(() => {
        const admission = captureFrontendAdmission(authority);
        registration = captureFrontendBindings(registration, admission.declarations);
        const problem = frontendIdentityProblem(admission, registration) ?? frontendBindingProblem(admission.declarations, registration);
        if (problem) throw new Error(problem);
        const { id, ...definition } = registration;
        if (accepted.has(id) !== replacing) throw new Error(replacing
          ? `Pack "${id}" frontend is not registered` : `Pack "${id}" frontend is already registered`);
        const candidate = capture({ ...definition, id }, admission);
        const next = new Map(accepted);
        next.set(id, candidate);
        const projected = buildTables(next.values());
        binding.bind(candidate.bindSettings);
        return prepareChange(id, next, projected, binding, candidate.addressed.map(({ surface }) => surface));
      });
    } catch (error) {
      if (changing) retire(binding); else mutate(() => retire(binding));
      throw error;
    }
  }
  const accept = (admission: FrontendAdmission, registration: PackFERegistration, settings: FrontendSettingsBinding | undefined, replacing: boolean) => {
    const prepared = preparePackFE(admission, registration, settings, replacing);
    try { return prepared.commit(); } finally { prepared.dispose(); }
  };
  function unregisterPackFE(id: string): Surface[] {
    const previous = accepted.get(id);
    if (!previous) return [];
    const prepared = prepareUnregisterPackFE(id);
    try { prepared.commit(); } finally { prepared.dispose(); }
    return previous.addressed.map(({ surface }) => surface);
  }

  return {
    preparePackFE,
    prepareUnregisterPackFE,
    hasPackFE: id => accepted.has(id),
    registerPackFE: (admission, registration, settings) => accept(admission, registration, settings, false),
    replacePackFE: (admission, registration, settings) => accept(admission, registration, settings, true),
    unregisterPackFE,
    getRegisteredSurfaces: () => [...tables.surfaces],
    getAppExtension: key => tables.appExtensions.get(key)?.component,
    appExtensionBinding: key => tables.appExtensions.get(key),
    settingsForm: target => tables.forms.get(formKey(target)),
    onChanged(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    designation: key => tables.designations.get(key),
    stepBindings: () => new Map(tables.steps.entries()),
    artifactBindings: () => new Map(tables.artifacts.entries()),
    artifact: key => tables.artifacts.get(key)?.binding, artifacts: () => [...tables.artifacts.values()].map(entry => entry.binding),
    blockBindings: () => new Map(tables.blocks.entries()),
    block: key => tables.blocks.get(key)?.binding, blocks: () => [...tables.blocks.values()].map(entry => entry.binding),
    surfaceBindings: () => new Map(tables.surfaceBindings),
    frontendIdentity: packId => accepted.get(packId)?.identity,
    surfaces: () => [...tables.surfaces],
    textEditor: () => [...tables.textEditor],
    referenceTypes: () => new Map(tables.referenceTypes),
    referenceCategories: () => new Map(tables.referenceCategories),
    appExtension: key => tables.appExtensions.get(key)?.component,
  };
}
