import type { Read } from '@apackdev/state';
import { _packEntityTypes, _packRelationTypes, _packRoles, type HostLifecycleEvents, type StateMatchesContract } from '@apackdev/sdk/framework';
import type { ContractAsks, IncomingOnlyEventsOf, NormalizeAsks } from '@apackdev/sdk/events';
import type { Contract } from './contract.ts';
import * as path from 'path';
import { satisfies } from 'semver';
import { getAppVersion, resolveAppEnvironment } from '@apackdev/sdk/env';
import { PACK_SNAPSHOT_FORMAT, parsePackDependency } from '@apackdev/pack-format';
import { HOST_PACK_ID, PACK_ID_PATTERN, resolveName } from '@apackdev/sdk/ids';
import { packRecord, packRecords, recordInstalled, recordUpdateInstalled, setPackEnabled } from '../../../packs/installed.ts';
import { reportError } from '@apackdev/sdk/logger';
import { installPack as runInstall, uninstallPack as runUninstall, restoreShippedPack, updateShippedPack, installPackFromGitHub, resolveInstallSourceKind } from '../../../packs/installer.ts';
import type { InstalledPackSummary, PackRegistry } from '../../../packs/registry.ts';
import { PACK_LAYOUT } from '../../../packs/layout.ts';
import { discoverPackDirectories, installedPacks } from '../../../packs/discovery.ts';
import { checkForUpdates } from '../../../packs/updater.ts';
import { teardownPack, activatePack, acceptInstalledPack, type PackBusTarget } from '../../../packs/runtime/lifecycle.ts';
import { clearPackRequireCache } from '../../../packs/runtime/loader.ts';
import * as fs from 'node:fs';
import { activationProblem } from '../../../packs/runtime/activation-outcome.ts';
import { errorMessage, hasOwn } from '@apackdev/sdk/utils/pure';
import { applyRecord, importCompiledContent, registeredContentKeys, type ContentSelection } from '@apackdev/sdk/utils';
import { appliedContent } from '../../../app-state/index.ts';
import { contentEntity, contentKeySelection, describeContentKey, previewPackContent, removeContentEntity } from '@apackdev/sdk/content';
import { hostState, type HostNet } from '../../../state.ts';

export type { InstalledPackSummary };

type HostBroadcast = <K extends keyof HostNet['surfaces']>(
  to: K,
  event: Read<HostNet['surfaces'][K]['events']>,
) => void;

type PackBusEvent = HostNet['peers']['bus']['events'];

type PacksEvent =
  | IncomingOnlyEventsOf<Contract>
  | Extract<HostLifecycleEvents, { type: 'SEND_STATE' }>;

/**
 * Convert the JSON-safe include shape from the frontend (`null = all items, [] = skip, string[] = filter`)
 * into the `ContentSelection` structure `importCompiledContent` consumes.
 */
function toContentSelection(include: Record<string, string[] | null>): Record<string, ContentSelection | undefined> {
  return Object.fromEntries(Object.entries(include).map(([key, items]) => [key, items === null ? true : new Set(items)]));
}

/**
 * Where a pack's compiled content is: under the directory it is installed in, which the host put it in.
 *
 * A pack does not say where its data is, here as in `applyPacks`, so restoring one item reads the same
 * directory the apply that wrote it read.
 */
function compiledDirOf(packId: string): string {
  const pack = installedPacks().find((installed) => installed.record.id === packId);
  if (!pack?.dir) throw new Error(`Pack "${packId}" isn't installed`);
  return path.join(pack.dir, PACK_LAYOUT.contentDir);
}

/** The last apply's unresolved offers and kept items, derived from AppliedContent in stable key order. */
function contentOffersOf(packId: string): Pick<InstalledPackSummary, 'contentOffers' | 'contentKept'> {
  const items = Object.entries(appliedContent.get(packId).items).sort(([a], [b]) => a.localeCompare(b));
  return {
    contentOffers: items.flatMap(([key, item]) => (item.offer ? [{ key, label: describeContentKey(key), ...item.offer }] : [])),
    contentKept: items.flatMap(([key, item]) => (item.dismissed && !item.offer ? [{ key, label: describeContentKey(key) }] : [])),
  };
}

/** Accepted declarations describe a pack independently of whether its executable bindings are running. */
function toInstalledPackSummaries(registry: PackRegistry): InstalledPackSummary[] {
  const catalog = registry.catalog.getSnapshot();
  const surfaces = new Map(registry.catalog.surfaces().filter(surface => surface.origin === 'installed')
    .map(surface => [surface.featureRef, surface.declaration]));
  const references = new Map(registry.catalog.references().filter(entry => entry.origin === 'installed')
    .map(entry => [entry.featureRef, entry.declaration]));
  const records = packRecords();
  const installed = new Map(catalog.packs.map(entry => [entry.snapshot.manifest.id, entry]));
  const unusable = new Set(catalog.problems.map(problem => problem.id));
  const base = (id: string, dir: string, enabled: boolean) => {
    const record = packRecord(id, records);
    const source = catalog.appPackSources.find(source => source.id === id);
    const sourceProblem = catalog.appPackSourceProblems.filter(problem => problem.id === id).map(problem => problem.message).join('; ');
    const appUpdate = record.updatesWith === 'app' && source && !sourceProblem && source.sourceRevision !== record.shippedRevision
      ? { id, name: source.snapshot.manifest.name, version: source.snapshot.manifest.version, sourceRevision: source.sourceRevision } : undefined;
    return {
      id, dir, enabled, updatesWith: record.updatesWith ?? 'user',
      installedAt: record.installedAt, installedFrom: record.installedFrom,
      availableVersion: record.updatesWith === 'app' ? undefined : record.availableVersion,
      updateCheckError: record.updatesWith === 'app' ? undefined : record.updateCheckError,
      appUpdate, appSourceProblem: record.updatesWith === 'app' ? sourceProblem || (!source ? 'App source is unavailable' : undefined) : undefined,
      loadProblem: registry.loadProblem(id), dependencyProblems: [], ...contentOffersOf(id),
    };
  };
  const packs: InstalledPackSummary[] = catalog.packs.map(({ snapshot, integrity, dir, enabled }) => {
    const { manifest } = snapshot;
    const features = Object.entries(manifest.features ?? {}).map(([id, feature]) => ({
      id, description: feature.description, designation: feature.designation, hasSystem: !!feature.system,
      surface: surfaces.get(resolveName(id, manifest.id)),
      references: references.get(resolveName(id, manifest.id)),
      services: Object.keys(feature.services ?? {}),
    }));
    const extensions = manifest.extensions;
    const dependencyProblems = Object.entries(manifest.dependencies ?? {}).flatMap(([id, spec]) => {
      const { range } = parsePackDependency(spec);
      const requires = `Requires ${id}${range === '*' ? '' : ` (${range})`}.`;
      if (unusable.has(id)) return [`${requires} Its installed build is unavailable.`];
      const provider = installed.get(id);
      if (!provider) return [`${requires} Install the named pack.`];
      const { version } = provider.snapshot.manifest;
      if (range !== '*' && !satisfies(version, range, { includePrerelease: true })) {
        return [`${requires} Installed version ${version} is incompatible.`];
      }
      if (!provider.enabled) return [`${requires} Enable the installed pack.`];
      const problem = registry.loadProblem(id);
      return problem ? [`${requires} The installed pack failed to load. ${problem}`] : [];
    });
    return {
      ...base(manifest.id, dir, enabled), name: manifest.name, version: manifest.version,
      description: manifest.description, hostVersion: manifest.hostVersion, dependencyProblems,
      permissions: [...(manifest.permissions ?? [])], entities: { ..._packEntityTypes(manifest) },
      entityCount: Object.keys(_packEntityTypes(manifest)).length,
      hasFrontend: !!integrity && hasOwn(integrity.files, PACK_LAYOUT.feEntry),
      features, systems: features.filter(feature => feature.hasSystem).map(feature => resolveName(feature.id, manifest.id)),
      services: [...Object.keys(extensions?.services ?? {}), ...features.flatMap(feature => feature.services)],
      steps: Object.keys(extensions?.steps ?? {}), artifacts: Object.keys(extensions?.artifacts ?? {}),
      blocks: Object.keys(extensions?.blocks ?? {}), relKinds: { ..._packRelationTypes(manifest) }, roles: { ..._packRoles(manifest) },
      migrationCount: Object.values(manifest.migrations ?? {}).reduce((count, line) => count + Object.keys(line).length, 0),
      lifecycleHooks: Object.keys(manifest.lifecycle ?? {}),
    };
  });
  const accepted = new Set(packs.map(pack => pack.id));
  for (const problem of catalog.problems) {
    if (accepted.has(problem.id)) continue;
    packs.push({
      ...base(problem.id, problem.dir, problem.enabled), name: problem.id,
      entities: {}, entityCount: 0, hasFrontend: false, permissions: [],
      systems: [], services: [], steps: [], artifacts: [], blocks: [], relKinds: {}, roles: {},
      migrationCount: 0, lifecycleHooks: [], features: [],
    });
  }
  return packs;
}

/**
 * Sends the Packs surface the list as the catalog holds it. What publishing uses: it runs after every fact that could
 * change a system's data, and none but a pack changing can change this, which keeps the catalog current itself.
 */
function publishPacksList(registry: PackRegistry, broadcast: HostBroadcast) {
  const catalog = registry.catalog.getSnapshot();
  broadcast('packs', {
    type: 'PACKS_LIST',
    packs: toInstalledPackSummaries(registry),
    appPackSources: catalog.appPackSources.map(source => ({
      id: source.id,
      name: source.snapshot.manifest.name,
      version: source.snapshot.manifest.version,
      sourceRevision: source.sourceRevision,
    })),
    appPackSourceProblems: catalog.appPackSourceProblems.map(({ id, message }) => ({ id, message })),
  });
}

/**
 * Reads the packs directory again, then sends the list: for someone asking, and after this system changes a pack. A
 * refresh that fails can't undo an operation that completed, so it is reported and the accepted declarations kept
 */
function emitPacksList(registry: PackRegistry, broadcast: HostBroadcast) {
  try { registry.refreshCatalog(resolveAppEnvironment().packsDir); }
  catch (error) { reportError({ source: 'packs', operation: 'refreshPacksList', severity: 'error', error: new Error(errorMessage(error)) }); }
  publishPacksList(registry, broadcast);
}

/** Why an operation on a pack was refused: another holds it, or the app's data is being replaced */
function operationInProgress(key: string): string {
  return `Another operation on ${key} is in progress (an install, update, removal or app data replacement). Try again once it finishes.`;
}

/** The host `packs` system, installing, updating and toggling the packs in `registry` */
export function createPacksSystem(registry: PackRegistry) {
  const isInstalled = (id: string) => PACK_ID_PATTERN.test(id)
    && discoverPackDirectories(resolveAppEnvironment().packsDir).some(dir => path.basename(dir) === id);
  /** Each disable whose teardown is still running, settled once the pack's operation is released */
  const teardowns = new Map<string, Promise<void>>();

  const busTarget = (tell: (to: { readonly peer: 'bus' }, event: Read<PackBusEvent>) => void): PackBusTarget => ({
    send: (event) => tell({ peer: 'bus' }, event as PackBusEvent),
  });

  const handleInstall = (
    ev: Extract<PacksEvent, { type: 'INSTALL_PACK' | 'REPLACE_PACK' }>,
    broadcast: HostBroadcast,
    bus: PackBusTarget,
  ) => {
    const packSlug = ev.packSlug;

    // Reserve the source while downloading, then the resolved owner before publication.
    const slugClaim = registry.claimPackOperation(packSlug);
    if (!slugClaim) {
      broadcast('packs', { type: 'PACK_INSTALL_FAILED', packSlug, error: operationInProgress(packSlug) });
      return;
    }
    void (async () => {
      using claims = new DisposableStack();
      claims.use(slugClaim);
      console.log(`[packs] Install requested: ${packSlug} (source kind: ${ev.sourceKind ?? 'default'})`);
      broadcast('packs', { type: 'PACK_INSTALL_STARTED', packSlug });
      const isGitHub = resolveInstallSourceKind(packSlug, ev.sourceKind) === 'github';
      let startAccepted: (() => boolean) | undefined;
      try {
        const result = await runInstall(packSlug, ev.sourceKind, undefined, {
          installedPacksFile: resolveAppEnvironment().installedPacksFile,
          sha256: ev.sha256,
          hostVersion: getAppVersion(),
          packFormat: PACK_SNAPSHOT_FORMAT,
          beforePlace: manifest => {
            if (manifest.id === HOST_PACK_ID) throw new Error('The host is not an installable pack');
            registry.catalog.assertPackSettings(manifest);
            if (ev.type === 'REPLACE_PACK') {
              if (manifest.id !== ev.packId) throw new Error(`Replacement expected pack "${ev.packId}", received "${manifest.id}"`);
            } else {
              registry.refreshCatalog();
              const catalog = registry.catalog.getSnapshot();
              if (packRecord(manifest.id).updatesWith === 'app'
                || catalog.appPackSources.some(source => source.id === manifest.id)
                || catalog.appPackSourceProblems.some(problem => problem.id === manifest.id)) {
                throw new Error(`"${manifest.id}" is an app default. Use Replace to install your own version.`);
              }
            }
            if (manifest.id !== packSlug) {
              const idClaim = registry.claimPackOperation(manifest.id);
              if (!idClaim) throw new Error(operationInProgress(manifest.id));
              claims.use(idClaim);
            }
          },
          accept: candidate => {
            startAccepted = acceptInstalledPack(registry, candidate.id, bus);
          },
        });
        if (!recordInstalled(result.id, isGitHub ? packSlug : undefined)) {
          await teardownPack(registry, result.id, bus);
          throw new Error(`${result.name} was installed, but its install source and enablement could not be saved`);
        }
        const activated = startAccepted!();
        const problem = activationProblem(registry, result.id, activated);
        if (problem) {
          broadcast('packs', {
            type: 'PACK_INSTALL_FAILED',
            packSlug,
            error: `${result.name} was installed but ${problem}`,
          });
          emitPacksList(registry, broadcast);
          return;
        }

        broadcast('packs', {
          type: 'PACK_INSTALL_COMPLETE',
          packSlug,
          packId: result.id,
          packName: result.name,
          version: result.version,
        });
        broadcast('packs', { type: 'PACK_ACTIVATED', packId: result.id });
        emitPacksList(registry, broadcast);
      } catch (err) {
        const message = errorMessage(err);
        console.error(`[packs] Install failed for ${packSlug}:`, message);
        broadcast('packs', {
          type: 'PACK_INSTALL_FAILED',
          packSlug,
          error: message,
        });
        emitPacksList(registry, broadcast);
      }
    })();
  };

  return hostState<
    {},
    PacksEvent,
    NormalizeAsks<ContractAsks<Contract>>
  >()({
    on: {
      SEND_STATE: (_ev, { broadcast }) => {
        publishPacksList(registry, broadcast);
      },

      GET_INSTALLED_PACKS: (_ev, { broadcast }) => {
        emitPacksList(registry, broadcast);
      },

      // Both answer the settings surface, which is where the content UI is drawn. The work is this system's; the
      // view is not, and a system sends whichever surface's inbox declares the event.
      PREVIEW_PACK_CONTENT: (ev, { broadcast }) => {
        try {
          broadcast('settings', { type: 'PACK_CONTENT_PREVIEW', preview: previewPackContent(ev.directory) });
        } catch (err) {
          broadcast('settings', { type: 'PACK_CONTENT_PREVIEW_FAILED', error: errorMessage(err) });
        }
      },

      IMPORT_PACK_CONTENT: (ev, { broadcast, tell }) => {
        try {
          const include = ev.include ? toContentSelection(ev.include) : undefined;
          // Read first: a directory that can't name its pack fails before anything is imported
          const { packId } = previewPackContent(ev.directory);
          /**
           * **Write-only, which is what makes this an import and not an apply.** `before` is empty, so no
           * verdict here can be reached from what a previous apply wrote: nothing is read as the user's
           * deletion, nothing is read as their edit, and no item is removed for having left the content.
           * Putting a pack's data back is the request, and the modes are the whole of the policy.
           *
           * **What it does write is what it wrote**, and it has to: an import that rewrote fifty entities and
           * recorded nothing would leave the applied content describing the version before it, which the next
           * boot's apply would read as fifty edits by the user. The revision is left where it is, so asking
           * for the data again does not change what counts as changed.
           */
          const record = applyRecord();
          const result = importCompiledContent({ compiledDir: ev.directory, include, mode: ev.mode, applied: record, verbose: true });
          appliedContent.record(packId, { wrote: record.written });
          // Appliers report records they couldn't write in their counts rather than throwing
          const errors = Object.entries(result).flatMap(([key, counts]) => (counts.errors ?? []).map((error) => `${key}: ${error}`));
          broadcast('settings', { type: 'PACK_CONTENT_IMPORTED', result, errors });
          // The running systems read what the apply changed (the chat's slash commands, the library's documents)
          tell({ peer: 'bus' }, { type: 'PACK_CHANGED', packId });
          if (ev.restartBrain) tell({ peer: 'role:brain' }, { type: 'RESTART_BRAIN' });
        } catch (err) {
          broadcast('settings', { type: 'PACK_CONTENT_IMPORT_FAILED', error: errorMessage(err) });
        }
      },

      /**
       * **Write the pack's version of one item over whatever is there.** The one act in the app that
       * overwrites the user's own work, reached only from something they clicked: taking a newer version
       * they were offered, or asking for the shipped item back.
       *
       * It is an **import** of exactly one item — `force`, a selection of that item alone, and a write-only
       * record — which is what makes it structurally incapable of being an apply (`importCompiledContent`
       * refuses `force` beside anything the last apply wrote). The write re-stamps the item's entry, so the
       * offer is answered by the write rather than by a second bookkeeping step.
       */
      RESTORE_CONTENT_ITEM: (ev, { broadcast, tell }) => {
        const selection = contentKeySelection(ev.key);
        if (!selection) {
          reportError({ source: 'packs', operation: 'restoreContentItem', severity: 'error', error: new Error(`Can't restore "${ev.key}": it doesn't name an item of a pack's content`) });
          return;
        }
        try {
          const dir = compiledDirOf(ev.packId);
          /**
           * **Every other entry is named and given nothing**, because an entry the map omits is not
           * excluded — `selectsAll` reads an absent selection as *all of its items*, and only an empty set
           * means skip. With `force` beside it, a map naming one entry would write every item of every
           * other entry over whatever the user had made of them, which is the one thing this request must
           * not do: they asked for one item back.
           */
          const include = Object.fromEntries(registeredContentKeys(ev.packId)
            .map((key) => [key, key === selection.entryKey ? new Set([selection.label]) : new Set<string>()]));
          if (!(selection.entryKey in include)) {
            reportError({ source: 'packs', operation: 'restoreContentItem', severity: 'error', error: new Error(`Can't restore ${describeContentKey(ev.key)}: "${ev.packId}" has no content entry "${selection.entryKey}"`) });
            return;
          }
          const record = applyRecord();
          const result = importCompiledContent({
            compiledDir: dir,
            include,
            mode: 'replace-on-collision',
            force: true,
            applied: record,
            verbose: true,
          });
          appliedContent.record(ev.packId, { wrote: record.written });
          const errors = Object.entries(result).flatMap(([key, counts]) => (counts.errors ?? []).map((error) => `${key}: ${error}`));
          if (errors.length > 0) {
            reportError({ source: 'packs', operation: 'restoreContentItem', severity: 'error', error: new Error(`Couldn't restore ${describeContentKey(ev.key)}:\n  ${errors.join('\n  ')}`) });
          }
          /**
           * **Only an item that was written has been decided**, which is why this reads the record rather
           * than the absence of an error: a run that could not write this item has changed nothing about
           * it, and clearing its offer would stop the user ever being asked again about a version they
           * never received. The write itself re-stamps the entry, so this is what answers an offer the
           * write happened to leave in place.
           */
          if (record.written.has(ev.key)) appliedContent.resolveOffer(ev.packId, ev.key, { choice: 'taken' });
          // The running systems read what the write changed (the brain's flows, the chat's slash commands)
          tell({ peer: 'bus' }, { type: 'PACK_CHANGED', packId: ev.packId });
        } catch (err) {
          reportError({ source: 'packs', operation: 'restoreContentItem', severity: 'error', error: err });
        }
        emitPacksList(registry, broadcast);
      },

      /** "Keep mine": the item stays as the user wrote it, and this version is not offered again */
      DISMISS_CONTENT_OFFER: (ev, { broadcast }) => {
        const offer = appliedContent.get(ev.packId).items[ev.key]?.offer;
        appliedContent.resolveOffer(ev.packId, ev.key, {
          choice: 'dismissed',
          ...(offer?.contentHash !== undefined && { contentHash: offer.contentHash }),
        });
        emitPacksList(registry, broadcast);
      },

      /**
       * "Delete it": the other answer to an item the pack stopped shipping. The entity goes and so does its
       * entry, which is what makes the decision final — there is nothing left for a later apply to describe.
       */
      DELETE_CONTENT_ITEM: (ev, { broadcast, tell }) => {
        try {
          const item = appliedContent.get(ev.packId).items[ev.key];
          const entity = contentEntity(item?.entityType, ev.key);
          // Through the owner's own delete: a flow's nodes and wiring go with it, and an entity type whose
          // pack registered a `remove` writer is removed the way that pack removes one
          if (entity) removeContentEntity(item!.entityType!, entity.id);
          appliedContent.resolveOffer(ev.packId, ev.key, { choice: 'deleted' });
          tell({ peer: 'bus' }, { type: 'PACK_CHANGED', packId: ev.packId });
        } catch (err) {
          reportError({ source: 'packs', operation: 'deleteContentItem', severity: 'error', error: err });
        }
        emitPacksList(registry, broadcast);
      },

      // A pack activated, reloaded or torn down changes this list, and a reload is the one that
      // reaches here no other way: it comes from `apack pack dev`, not from an action of this system
      INSTALL_PACK: (ev, { broadcast, tell }) => {
        handleInstall(ev, broadcast, busTarget(tell));
      },

      REPLACE_PACK: (ev, { broadcast, tell }) => {
        handleInstall(ev, broadcast, busTarget(tell));
      },

      RESTORE_PACK: ({ packId, sourceRevision }, { broadcast, tell }) => {
        const bus = busTarget(tell);
        const fail = (error: unknown) => broadcast('packs', {
          type: 'PACK_INSTALL_FAILED',
          packSlug: packId,
          error: errorMessage(error),
        });
        if (packId === HOST_PACK_ID || !PACK_ID_PATTERN.test(packId)) {
          fail(new Error('Select an installable app default'));
          return;
        }
        const claim = registry.claimPackOperation(packId);
        if (!claim) {
          fail(new Error(operationInProgress(packId)));
          return;
        }
        broadcast('packs', { type: 'PACK_INSTALL_STARTED', packSlug: packId });
        let startAccepted: (() => boolean) | undefined;
        Promise.resolve().then(() => {
          registry.refreshCatalog();
          const catalog = registry.catalog.getSnapshot();
          const source = catalog.appPackSources.find(source => source.id === packId);
          if (!source || catalog.appPackSourceProblems.some(problem => problem.id === packId)) {
            throw new Error(`App default "${packId}" is unavailable; refresh to see source diagnostics`);
          }
          if (source.sourceRevision !== sourceRevision) {
            throw new Error(`App default "${packId}" changed; refresh before restoring`);
          }
          const { packsDir, installedPacksFile } = resolveAppEnvironment();
          return restoreShippedPack(packId, source.dir, packsDir, {
            installedPacksFile,
            expectedSourceRevision: sourceRevision,
            hostVersion: getAppVersion(),
            packFormat: PACK_SNAPSHOT_FORMAT,
            beforePlace: manifest => registry.catalog.assertPackSettings(manifest),
            accept: candidate => { startAccepted = acceptInstalledPack(registry, candidate.id, bus); },
          });
        }).then(result => {
          const activated = startAccepted!();
          const problem = activationProblem(registry, packId, activated);
          if (problem) fail(new Error(`${result.name} was restored but ${problem}`));
          else {
            broadcast('packs', {
              type: 'PACK_INSTALL_COMPLETE',
              packSlug: packId,
              packId,
              packName: result.name,
              version: result.version,
            });
            broadcast('packs', { type: 'PACK_ACTIVATED', packId });
          }
          emitPacksList(registry, broadcast);
        }).catch(fail).finally(() => { claim.release(); });
      },

      UNINSTALL_PACK: ({ packId }, { broadcast, tell }) => {
        const bus = busTarget(tell);
        if (packId === HOST_PACK_ID) {
          broadcast('packs', { type: 'PACK_UNINSTALL_FAILED', packId, error: `"${packId}" is part of apack, so it can't be uninstalled` });
          return;
        }
        // The id names the directory the uninstall deletes, so only an installed pack's own is taken
        if (!isInstalled(packId)) {
          broadcast('packs', { type: 'PACK_UNINSTALL_FAILED', packId, error: `"${packId}" is not an installed pack` });
          return;
        }

        const claim = registry.claimPackOperation(packId);
        if (!claim) {
          broadcast('packs', { type: 'PACK_UNINSTALL_FAILED', packId, error: operationInProgress(packId) });
          return;
        }
        console.log(`[packs] Uninstall requested: ${packId}`);

        let cacheDir: string;
        Promise.resolve().then(() => {
          cacheDir = fs.realpathSync(path.join(resolveAppEnvironment().packsDir, packId));
          return runUninstall(packId, undefined, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
        }).then(() => teardownPack(registry, packId, bus)).then(() => {
          clearPackRequireCache(cacheDir);
          broadcast('packs', { type: 'PACK_DEACTIVATED', packId });
          broadcast('packs', { type: 'PACK_UNINSTALL_COMPLETE', packId });
          emitPacksList(registry, broadcast);
        }).catch(err => {
          const message = errorMessage(err);
          console.error(`[packs] Uninstall failed for ${packId}:`, message);
          broadcast('packs', {
            type: 'PACK_UNINSTALL_FAILED',
            packId,
            error: message,
          });
        }).finally(() => {
          claim.release();
        });
      },

      UPDATE_APP_PACK: ({ packId, sourceRevision }, { broadcast, tell }) => {
        const bus = busTarget(tell);
        const fail = (error: unknown) => broadcast('packs', {
          type: 'PACK_UPDATE_FAILED',
          packId,
          error: errorMessage(error),
        });
        const claim = registry.claimPackOperation(packId);
        if (!claim) {
          fail(new Error(operationInProgress(packId)));
          return;
        }
        let startAccepted: (() => boolean) | undefined;
        let enabled = false;
        Promise.resolve().then(() => {
          registry.refreshCatalog();
          const catalog = registry.catalog.getSnapshot();
          const source = catalog.appPackSources.find(source => source.id === packId);
          if (!source || catalog.appPackSourceProblems.some(problem => problem.id === packId)) throw new Error(`App source "${packId}" is unavailable; refresh to see source diagnostics`);
          if (source.sourceRevision !== sourceRevision) throw new Error(`App source "${packId}" changed; refresh before updating`);
          const { packsDir, installedPacksFile } = resolveAppEnvironment();
          return updateShippedPack(packId, source.dir, packsDir, {
            installedPacksFile,
            expectedSourceRevision: sourceRevision,
            hostVersion: getAppVersion(),
            packFormat: PACK_SNAPSHOT_FORMAT,
            beforePlace: manifest => registry.catalog.assertPackSettings(manifest),
            accept: candidate => {
              enabled = packRecord(packId).enabled;
              if (enabled) startAccepted = acceptInstalledPack(registry, candidate.id, bus);
            },
          });
        }).then(result => {
          const activated = enabled ? startAccepted!() : false;
          if (!enabled) registry.refreshCatalog();
          const problem = enabled ? activationProblem(registry, packId, activated) : undefined;
          if (problem) fail(new Error(`${result.name} was updated but ${problem}`));
          else {
            broadcast('packs', { type: 'PACK_UPDATE_COMPLETE', packId, version: result.version });
            if (activated) broadcast('packs', { type: 'PACK_ACTIVATED', packId });
          }
          emitPacksList(registry, broadcast);
        }).catch(error => { fail(error); emitPacksList(registry, broadcast); }).finally(() => { claim.release(); });
      },

      UPDATE_PACK: ({ packId }, { broadcast, tell }) => {
        const bus = busTarget(tell);
        const entry = packRecord(packId);
        if (entry.updatesWith === 'app' || !entry.installedFrom) {
          broadcast('packs', {
            type: 'PACK_UPDATE_FAILED',
            packId,
            error: entry.updatesWith === 'app' ? 'Use the selected app-source update for an app-managed pack' : 'Pack has no update source',
          });
          return;
        }

        const claim = registry.claimPackOperation(packId);
        if (!claim) {
          broadcast('packs', { type: 'PACK_UPDATE_FAILED', packId, error: operationInProgress(packId) });
          return;
        }

        const sourceSlug = entry.installedFrom.split('@')[0];
        // Install the release the update check found (it may be a beta prerelease); fall back to latest
        const target = entry.availableTag ? `${sourceSlug}@${entry.availableTag}` : sourceSlug;
        console.log(`[packs] Update requested: ${packId} from ${target}`);

        let startAccepted: (() => boolean) | undefined;

        installPackFromGitHub(target, undefined, {
          hostVersion: getAppVersion(),
          packFormat: PACK_SNAPSHOT_FORMAT,
          beforePlace: manifest => {
            if (manifest.id !== packId) throw new Error(`${target} holds the pack "${manifest.id}", not "${packId}"`);
            registry.catalog.assertPackSettings(manifest);
          },
          accept: candidate => {
            if (entry.enabled) startAccepted = acceptInstalledPack(registry, candidate.id, bus);
          },
        }).then(async result => {
          if (!recordUpdateInstalled(packId)) {
            if (entry.enabled) await teardownPack(registry, packId, bus);
            else registry.refreshCatalog();
            throw new Error(`Updated ${packId}, but its update record could not be saved`);
          }
          const activated = entry.enabled ? startAccepted!() : (registry.refreshCatalog(), false);
          const problem = entry.enabled ? activationProblem(registry, packId, activated) : undefined;
          if (problem) {
            broadcast('packs', {
              type: 'PACK_UPDATE_FAILED',
              packId,
              error: `Updated to ${result.version} but ${problem}`,
            });
            emitPacksList(registry, broadcast);
            return;
          }

          broadcast('packs', {
            type: 'PACK_UPDATE_COMPLETE',
            packId,
            version: result.version,
          });
          if (activated) broadcast('packs', { type: 'PACK_ACTIVATED', packId });
          emitPacksList(registry, broadcast);
        }).catch(err => {
          const message = errorMessage(err);
          console.error(`[packs] Update failed for ${packId}:`, message);
          broadcast('packs', {
            type: 'PACK_UPDATE_FAILED',
            packId,
            error: message,
          });
          emitPacksList(registry, broadcast);
        }).finally(() => {
          claim.release();
        });
      },

      CHECK_FOR_UPDATES: (_ev, { broadcast }) => {
        checkForUpdates({ hostVersion: getAppVersion() }).then(() => {
          emitPacksList(registry, broadcast);
        }).catch(err => {
          console.error('[packs] Update check failed:', err);
        });
      },

      TOGGLE_PACK_ENABLED: (ev, { broadcast, tell, send }) => {
        const bus = busTarget(tell);
        const packId = ev.packId;

        if (packId === HOST_PACK_ID) return;
        // Claimed like any other operation on the pack, so a development install cannot land mid-toggle
        const claim = registry.claimPackOperation(packId);
        if (!claim) {
          // The pack's own disable is still tearing down: turning it back on is what was asked, once that ends
          const teardown = teardowns.get(packId);
          if (teardown) {
            void teardown.then(() => send(ev));
            return;
          }
          // Refused as every operation on a busy pack is, and said so: each window shows the state that holds
          reportError({ source: 'packs', operation: 'setPackEnabled', severity: 'error', error: new Error(operationInProgress(packId)) });
          if (isInstalled(packId)) {
            broadcast('packs', { type: 'PACK_ENABLED_CHANGED', packId, enabled: packRecord(packId).enabled });
          }
          return;
        }
        // Held until a disable's teardown finishes (handed off via move()), or released on any synchronous exit
        using claims = new DisposableStack();
        claims.use(claim);
        if (!isInstalled(packId)) {
          reportError({ source: 'packs', operation: 'setPackEnabled', severity: 'error', error: new Error(`${packId} is not an installed pack`) });
          return;
        }
        const entry = packRecord(packId);

        const newEnabled = !entry.enabled;

        try {
          if (newEnabled) {
            registry.refreshCatalog(resolveAppEnvironment().packsDir);
            registry.catalog.assertPackEnabled(packId, true);
          }
        } catch (error) {
          reportError({ source: 'packs', operation: 'setPackEnabled', severity: 'error', error: new Error(errorMessage(error)) });
          broadcast('packs', { type: 'PACK_ENABLED_CHANGED', packId, enabled: entry.enabled });
          return;
        }

        if (!setPackEnabled(packId, newEnabled)) {
          reportError({
            source: 'packs',
            operation: 'setPackEnabled',
            severity: 'error',
            error: new Error(`Couldn't save that ${packId} is ${newEnabled ? 'enabled' : 'disabled'}; the current state is unchanged.`),
          });
          broadcast('packs', { type: 'PACK_ENABLED_CHANGED', packId, enabled: entry.enabled });
          return;
        }

        if (!newEnabled) {
          const finishDisable = () => {
            broadcast('packs', { type: 'PACK_DEACTIVATED', packId });
            emitPacksList(registry, broadcast);
          };
          const hadSystems = registry.getRegisteredPackSystemIds(packId).length > 0;
          const tearingDown = teardownPack(registry, packId, bus);
          if (!hadSystems) {
            finishDisable();
            broadcast('packs', {
              type: 'PACK_ENABLED_CHANGED',
              packId,
              enabled: newEnabled,
            });
            return;
          }
          const held = claims.move();
          const settled = tearingDown.then(finishDisable).finally(() => {
            held.dispose();
            teardowns.delete(packId);
          });
          teardowns.set(packId, settled);
          void settled;
          broadcast('packs', {
            type: 'PACK_ENABLED_CHANGED',
            packId,
            enabled: newEnabled,
          });
          return;
        }

        if (activatePack(registry, packId, bus)) {
          broadcast('packs', { type: 'PACK_ACTIVATED', packId });
        }

        broadcast('packs', {
          type: 'PACK_ENABLED_CHANGED',
          packId,
          enabled: newEnabled,
        });
        emitPacksList(registry, broadcast);
      },
    },
  });
}

const _contractMatches: StateMatchesContract<ReturnType<typeof createPacksSystem>, Contract> = true;
void _contractMatches;
