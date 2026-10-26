import { settingsForDeclarations } from './catalog-settings.ts';
import { dslCatalogEntries } from './catalog-dsl.ts';
import { eventCatalogEntries } from './catalog-events.ts';
import { _parseEventContracts, type PackEventContracts } from '@apackdev/sdk/framework';
import { captureData } from './captured-data.ts';
import { assertCatalogClaims, catalogClaimConflicts, surfaceCatalogEntries } from './catalog-surfaces.ts';
import { stepCatalogEntries } from './catalog-steps.ts';
import { artifactCatalogEntries } from './catalog-artifacts.ts';
import { blockCatalogEntries } from './catalog-blocks.ts';
import { referenceCatalogEntries } from './catalog-references.ts';
import { frontendCatalogEntries } from './catalog-frontend.ts';
import type { AppPackSource, AppPackSourceProblem, AppPackSources } from './app-sources.ts';
import { readInstalledPackBuilds } from './discovery.ts';
import { packBuildRevision, shippedPackRevision, type PackIntegrity } from './layout.ts';
import { appSettingsDefinition } from '../features/settings/be/app-definition.ts';
import { hasOwn } from '@apackdev/sdk/utils/pure';
import { isDeepStrictEqual } from 'node:util';
import { parseSnapshot, ManifestSchema, _declarationRevision, _helpDataProblem, type PackSnapshot, type PackManifest } from '@apackdev/sdk/build';
import { _compileSettingsDefinition, _settingsJsonProblems, _nativePackDeclarationProblem, type SettingsDefinition, type SettingsCatalog, type HelpDocument, type HelpCatalog, type NativePackDeclaration, type SurfaceDeclaration } from '@apackdev/sdk/framework';
import type { FeatureRef } from '@apackdev/sdk/ids';
import { createLogger } from '@apackdev/sdk/logger';

type CatalogData<T> = T extends object ? { readonly [K in keyof T]: CatalogData<T[K]> } : T;

/** An installed build's declarations and host-owned enablement, independent of activation. */
export interface PackCatalogEntry {
  readonly snapshot: CatalogData<PackSnapshot>;
  readonly dir: string;
  readonly enabled: boolean;
  /** Verified installed asset receipt; source/dependency data projections do not manufacture one. */
  readonly integrity?: CatalogData<PackIntegrity>;
  readonly buildRevision?: string;
}

export interface PackCatalogSource {
  snapshot: unknown;
  dir: string;
  enabled: boolean;
  integrity?: PackIntegrity;
}

/** Source authoring declares its manifest before a bundle exists; this is not installed admission. */
export interface SourcePackDeclaration {
  readonly manifest: CatalogData<PackManifest>;
  readonly dir: string;
  readonly declarationRevision: string;
  readonly help?: CatalogData<HelpDocument[]>;
  readonly eventContracts?: CatalogData<PackEventContracts>;
}

/** Known surface data; availability and accepted executable bindings are separate. */
export interface SurfaceCatalogEntry {
  readonly featureRef: FeatureRef;
  readonly packId: string;
  readonly origin: 'native' | 'installed' | 'source';
  readonly declaration: CatalogData<SurfaceDeclaration>;
  /** Compiled claims; absent on authoring-source previews that have no built contracts. */
  readonly opens?: readonly string[];
  readonly declarationRevision?: string;
  readonly enabled?: boolean;
  readonly buildRevision?: string;
}

export type { ReferenceCatalogEntry } from '@apackdev/sdk/framework';

/** A visible installed directory whose candidate declarations could not be accepted. */
export interface PackCatalogProblem {
  readonly id: string;
  readonly dir: string;
  readonly enabled: boolean;
  readonly message: string;
}

export interface PackCatalogSnapshot {
  readonly revision: number;
  readonly appSettings: CatalogData<SettingsDefinition>;
  readonly packs: readonly PackCatalogEntry[];
  readonly problems: readonly PackCatalogProblem[];
  readonly native: readonly CatalogData<NativePackDeclaration>[];
  readonly sourcePacks: readonly SourcePackDeclaration[];
  readonly appPackSources: readonly CatalogData<AppPackSource>[];
  readonly appPackSourceProblems: readonly CatalogData<AppPackSourceProblem>[];
}

/** One backend run's committed declaration snapshot, independent of executable availability. */
export interface PackCatalogFrame {
  readonly runId: string;
  readonly snapshot: PackCatalogSnapshot;
}

/** Own immutable data; neither input mutation nor a reader can change a committed catalog. */
function immutable<T>(data: T): CatalogData<T> {
  return captureData(data) as CatalogData<T>;
}

/** One declaration catalog; settings are a projection, not another store of contributed defaults. */
export function createContributionCatalog(appSettings: SettingsDefinition) {
  const logger = createLogger('pack-catalog');
  const app = immutable(appSettings);
  _compileSettingsDefinition(app);
  let current: PackCatalogSnapshot = immutable({ revision: 0, appSettings: app, packs: [], problems: [], native: [], sourcePacks: [], appPackSources: [], appPackSourceProblems: [] });
  let byId = new Map<string, PackCatalogEntry>();
  let refusedDestinations: PackCatalogEntry[] = [];
  const listeners = new Set<() => void>();
  let checkSettings: ((catalog: SettingsCatalog) => void) | undefined;
  const emptySettings: CatalogData<Record<string, SettingsDefinition>> = Object.freeze({});
  let settings: SettingsCatalog = immutable({ revision: 0, app, packs: {}, features: {}, dependencies: {} });
  let help: CatalogData<HelpCatalog> = immutable({ articles: [], problems: [] });

  function publish(changes: Partial<Omit<PackCatalogSnapshot, 'revision' | 'appSettings'>>,
    refused = refusedDestinations, { admitSettings = true }: { admitSettings?: boolean } = {}): void {
    const { packs, native, sourcePacks, problems: catalogProblems, appPackSources, appPackSourceProblems } = { ...current, ...changes };
    const declarationsChanged = !isDeepStrictEqual(current.packs, packs)
      || !isDeepStrictEqual(current.native, native) || !isDeepStrictEqual(current.sourcePacks, sourcePacks);
    if (!declarationsChanged && isDeepStrictEqual(current.problems, catalogProblems)
      && isDeepStrictEqual(current.appPackSources, appPackSources)
      && isDeepStrictEqual(current.appPackSourceProblems, appPackSourceProblems)
      && isDeepStrictEqual(refusedDestinations, refused)) return;
    const manifests = [...packs.map(({ snapshot }) => snapshot.manifest), ...sourcePacks.map(source => source.manifest)];
    const definitions = [...native, ...manifests.map(manifest => ({
      id: manifest.id, dependencies: manifest.dependencies,
      settings: manifest.extensions?.settings, features: manifest.features,
    }))];
    const next = immutable({ revision: current.revision + 1, appSettings: app, packs, problems: catalogProblems, native, sourcePacks, appPackSources, appPackSourceProblems });
    assertCatalogClaims(next);
    // Diagnostics and source offers leave accepted settings definitions and their identity intact.
    const projection = declarationsChanged ? immutable(settingsForDeclarations(app, definitions, next.revision)) : settings;
    if (declarationsChanged && admitSettings) checkSettings?.(projection);
    const helpOwners = [
      ...packs.map(({ snapshot }) => ({ manifest: snapshot.manifest, help: snapshot.help })),
      ...sourcePacks.map(source => ({ manifest: source.manifest, help: source.help })),
    ];
    const articles: HelpCatalog['articles'] = [];
    const problems: HelpCatalog['problems'] = [];
    for (const owner of helpOwners) {
      if (owner.help === undefined) {
        if (owner.manifest.extensions?.help) problems.push({ packId: owner.manifest.id, message: 'Help data is unavailable; build the complete pack.' });
        continue;
      }
      const problem = _helpDataProblem(owner.help, Object.keys(owner.manifest.features ?? {}));
      if (problem || !owner.manifest.extensions?.help) throw new Error(`Pack "${owner.manifest.id}" help: ${problem ?? 'undeclared help data'}`);
      articles.push(...(structuredClone(owner.help) as HelpDocument[]).map(article => ({ ...article, packId: owner.manifest.id, packName: owner.manifest.name })));
    }
    articles.sort((a, b) => a.packName.localeCompare(b.packName) || a.packId.localeCompare(b.packId)
      || (a.order ?? Infinity) - (b.order ?? Infinity) || a.title.localeCompare(b.title));
    const helpProjection = immutable({ articles, problems });
    byId = new Map(next.packs.map(entry => [entry.snapshot.manifest.id, entry]));
    current = next;
    refusedDestinations = refused;
    settings = projection;
    help = helpProjection;
    for (const listener of listeners) {
      try { listener(); }
      catch (error) { logger.error('Contribution catalog listener failed', error instanceof Error ? error : new Error(String(error))); }
    }
  }

  return {
    setSettingsAdmission(check: (catalog: SettingsCatalog) => void): void { checkSettings = check; },
    assertPackSettings(manifest: Readonly<PackManifest>): void {
      const declarations = [
        ...current.native.filter(pack => pack.id !== manifest.id),
        ...[...current.packs.map(pack => pack.snapshot.manifest), ...current.sourcePacks.map(pack => pack.manifest)]
          .filter(pack => pack.id !== manifest.id).map(pack => ({ ...pack, settings: pack.extensions?.settings })),
        { ...manifest, settings: manifest.extensions?.settings },
      ];
      checkSettings?.(settingsForDeclarations(app, declarations, settings.revision));
    },
    getSnapshot: (): PackCatalogSnapshot => current,
    surfaces: () => surfaceCatalogEntries(current),
    references: () => referenceCatalogEntries(current),
    frontend: () => frontendCatalogEntries(current),
    steps: () => stepCatalogEntries(current),
    artifacts: () => artifactCatalogEntries(current),
    blocks: () => blockCatalogEntries(current),
    dsl: () => dslCatalogEntries(current),
    events: () => eventCatalogEntries(current),
    get: (packId: string): PackCatalogEntry | undefined => byId.get(packId),
    settings: (): SettingsCatalog => settings,
    help: (): HelpCatalog => structuredClone(help) as HelpCatalog,
    /** Source declarations persist across registration changes, like installed declarations. */
    setSources(sources: readonly SourcePackDeclaration[]): void {
      const next = sources.map(source => {
        const result = ManifestSchema.safeParse(source.manifest);
        if (!result.success) throw new Error(`Source pack declarations in ${source.dir}: ${result.error.issues.map(issue => issue.message).join('; ')}`);
        if (_declarationRevision(result.data) !== source.declarationRevision) throw new Error(`Source pack "${result.data.id}" has a stale declaration identity`);
        if (source.eventContracts !== undefined) _parseEventContracts(source.eventContracts, result.data.features);
        return { ...source, manifest: result.data };
      });
      publish({ sourcePacks: next });
    },
    /** Available app defaults are not active owners and never change settings/help definitions. */
    setAppPackSources(input: AppPackSources): void {
      const ids = new Set<string>();
      const sources = input.sources.map(source => {
        const result = parseSnapshot(source.snapshot);
        if (!result.snapshot || result.snapshot.manifest.id !== source.id || ids.has(source.id)
          || source.sourceRevision !== shippedPackRevision(source.files)) {
          throw new Error(`Invalid or conflicting app source declarations: ${source.dir}`);
        }
        ids.add(source.id);
        return { ...source, snapshot: result.snapshot };
      });
      publish({ appPackSources: sources, appPackSourceProblems: input.problems });
    },
    setNative(declarations: readonly CatalogData<NativePackDeclaration>[]): void {
      const jsonProblems = _settingsJsonProblems(declarations);
      if (jsonProblems.length) throw new Error(`Invalid native declarations: ${jsonProblems.map(problem => `${problem.path.join('.')}: declarations must contain finite, acyclic JSON data properties`).join('; ')}`);
      const accepted = immutable(declarations);
      for (const declaration of accepted) {
        const problem = _nativePackDeclarationProblem(declaration);
        if (problem) throw new Error(`Invalid native declarations: ${problem}`);
      }
      publish({ native: accepted });
    },
    packSettings: (packId: string): CatalogData<Record<string, SettingsDefinition>> =>
      hasOwn(settings.packs, packId) ? settings.packs[packId] : emptySettings,

    featureSettings: (ref: FeatureRef): CatalogData<SettingsDefinition> | undefined =>
      hasOwn(settings.features, ref) ? settings.features[ref] : undefined,

    /** Check a verified executable candidate before importing it or replacing incumbent bindings. */
    assertPackDestinations(candidate: Pick<PackCatalogEntry, 'dir' | 'snapshot'>): void {
      const packs = [...current.packs, ...refusedDestinations].filter(pack => pack.snapshot.manifest.id !== candidate.snapshot.manifest.id);
      assertCatalogClaims({ ...current, packs: [...packs, { ...candidate, enabled: true }] });
    },

    /** Check enablement before persisting it or constructing an executable provider. */
    assertPackEnabled(packId: string, enabled: boolean): void {
      if (!byId.has(packId)) throw new Error(`No accepted installed declarations for pack "${packId}"`);
      assertCatalogClaims({ ...current, packs: current.packs.map(pack =>
        pack.snapshot.manifest.id === packId ? { ...pack, enabled } : pack) });
    },

    /**
     * Explicit admission is atomic; discovery may instead report and withhold all conflicting owners. `admitSettings`
     * false accepts declarations whatever they make of the stored settings: what boot's first discovery finds is
     * what is installed, and a stored value it makes invalid is recovery's to settle, not a reason to refuse the pack
     */
    replace(sources: readonly PackCatalogSource[], problems: readonly PackCatalogProblem[] = [],
      { reportConflicts = false, admitSettings = true }: { reportConflicts?: boolean; admitSettings?: boolean } = {}): void {
      const next = new Map<string, PackCatalogEntry>();
      for (const source of sources) {
        const candidate = immutable(source);
        const result = parseSnapshot(candidate.snapshot);
        if (!result.snapshot) throw new Error(`Pack declarations in ${source.dir}: ${result.diagnostics.map(issue => issue.message).join('; ')}`);
        const id = result.snapshot.manifest.id;
        const other = next.get(id);
        if (other) throw new Error(`Pack "${id}" is declared twice: ${other.dir} and ${source.dir}`);
        if (candidate.integrity && (candidate.integrity.id !== id || candidate.integrity.version !== result.snapshot.manifest.version)) {
          throw new Error(`Pack "${id}" asset receipt does not match its declarations`);
        }
        next.set(id, { ...candidate, snapshot: result.snapshot,
          ...(candidate.integrity && { buildRevision: packBuildRevision(candidate.integrity) }) });
      }
      let packs = [...next.values()];
      let refused: PackCatalogEntry[] = [];
      if (reportConflicts) {
        const conflicts = catalogClaimConflicts({ ...current, packs });
        problems = [...problems, ...packs.flatMap(pack => {
          const message = conflicts.get(pack.snapshot.manifest.id);
          return message ? [{ id: pack.snapshot.manifest.id, dir: pack.dir, enabled: pack.enabled, message }] : [];
        })];
        refused = packs.filter(pack => conflicts.has(pack.snapshot.manifest.id));
        packs = packs.filter(pack => !conflicts.has(pack.snapshot.manifest.id));
      }
      publish({ packs, problems }, refused, { admitSettings });
    },

    onChanged(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ContributionCatalog = ReturnType<typeof createContributionCatalog>;

/** Offline tools refuse incomplete installed definitions instead of treating invalid packs as absent. */
export function readInstalledContributionCatalog(packsDir: string, disabled: ReadonlySet<string>): ContributionCatalog {
  const catalog = createContributionCatalog(appSettingsDefinition);
  catalog.replace(readInstalledPackBuilds(packsDir).map(entry => {
    if (!entry.build) throw new Error(`Pack "${entry.id}" declarations in ${entry.dir}: ${entry.problem}`);
    const { snapshot, integrity } = entry.build;
    return { snapshot, integrity, dir: entry.dir, enabled: !disabled.has(entry.id) };
  }));
  return catalog;
}
