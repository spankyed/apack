import { _packEntityTypes, _packRelationTypes, _packRoles } from '@apackdev/sdk/framework';
import type { Contract } from './contract.ts';
import * as path from 'path';
import { setup } from 'xstate';
import { defineSystem } from '@apackdev/sdk/framework';
import { broadcastToSurface, sendToSystem } from '../../../events.ts';
import { getAppVersion, resolveAppEnvironment } from '@apackdev/sdk/env';
import { PACK_SNAPSHOT_FORMAT } from '@apackdev/sdk/build';
import { HOST_PACK_ID, PACK_ID_PATTERN, resolveName } from '@apackdev/sdk/ids';
import { packRecord, packRecords, recordInstalled, recordUpdateInstalled, setPackEnabled } from '../../../packs/installed.ts';
import { reportError } from '@apackdev/sdk/logger';
import { installPack as runInstall, uninstallPack as runUninstall, restoreShippedPack, updateShippedPack, installPackFromGitHub, resolveInstallSourceKind } from '../../../packs/installer.ts';
import type { InstalledPackSummary, PackRegistry } from '../../../packs/registry.ts';
import { PACK_LAYOUT } from '../../../packs/layout.ts';
import { discoverPackDirectories, installedPacks } from '../../../packs/discovery.ts';
import { checkForUpdates } from '../../../packs/updater.ts';
import { teardownPack, activatePack, acceptInstalledPack } from '../../../packs/runtime/lifecycle.ts';
import { clearPackRequireCache } from '../../../packs/runtime/loader.ts';
import * as fs from 'node:fs';
import { activationProblem } from '../../../packs/runtime/activation-outcome.ts';
import { HOST } from '../../../refs.ts';
import { errorMessage, hasOwn } from '@apackdev/sdk/utils/pure';
import { applyRecord, importCompiledContent, registeredContentKeys, type ContentSelection } from '@apackdev/sdk/utils';
import { appliedContent } from '../../../app-state/index.ts';
import { contentEntity, contentKeySelection, describeContentKey, previewPackContent, removeContentEntity } from '@apackdev/sdk/content';

export type { InstalledPackSummary };

export const packsSpec = defineSystem<Contract>();

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
      loadProblem: registry.loadProblem(id), ...contentOffersOf(id),
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
    return {
      ...base(manifest.id, dir, enabled), name: manifest.name, version: manifest.version,
      description: manifest.description, hostVersion: manifest.hostVersion,
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

/** A list refresh cannot undo a completed operation; report refusal and retain accepted declarations. */
function emitPacksList(registry: PackRegistry) {
  try { registry.refreshCatalog(resolveAppEnvironment().packsDir); }
  catch (error) { reportError({ source: 'packs', operation: 'refreshPacksList', severity: 'error', error: new Error(errorMessage(error)) }); }
  const catalog = registry.catalog.getSnapshot();
  broadcastToSurface('packs', { type: 'PACKS_LIST' as const, packs: toInstalledPackSummaries(registry),
    appPackSources: catalog.appPackSources.map(source => ({ id: source.id, name: source.snapshot.manifest.name,
      version: source.snapshot.manifest.version, sourceRevision: source.sourceRevision })),
    appPackSourceProblems: catalog.appPackSourceProblems.map(({ id, message }) => ({ id, message })),
  });
}

/** The host `packs` system, installing, updating and toggling the packs in `registry` */
/** Why an operation on a pack was refused: another holds it, or the app's data is being replaced */
function operationInProgress(key: string): string {
  return `Another operation on ${key} is in progress (an install, update, removal or app data replacement). Try again once it finishes.`;
}

export function createPacksSystem(registry: PackRegistry) {
  const isInstalled = (id: string) => PACK_ID_PATTERN.test(id)
    && discoverPackDirectories(resolveAppEnvironment().packsDir).some(dir => path.basename(dir) === id);
  /** Each disable whose teardown is still running, settled once the pack's operation is released */
  const teardowns = new Map<string, Promise<void>>();
  return setup({
    types: packsSpec.types,
    actions: packsSpec.actions({
    // Both answer the settings surface, which is where the content UI is drawn. The work is this system's; the
    // view is not, and a system sends whichever surface's inbox declares the event.
    previewPackContent: ({ event }) => {
      const ev = packsSpec.typeOf('PREVIEW_PACK_CONTENT', event);
      try {
        broadcastToSurface('settings', { type: 'PACK_CONTENT_PREVIEW', preview: previewPackContent(ev.directory) });
      } catch (err) {
        broadcastToSurface('settings', { type: 'PACK_CONTENT_PREVIEW_FAILED', error: errorMessage(err) });
      }
    },

    importPackContent: ({ event }) => {
      const ev = packsSpec.typeOf('IMPORT_PACK_CONTENT', event);
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
        broadcastToSurface('settings', { type: 'PACK_CONTENT_IMPORTED', result, errors });
        // The running systems read what the apply changed (the chat's slash commands, the library's documents)
        sendToSystem('bus', { type: 'PACK_CHANGED', packId });
        if (ev.restartBrain) sendToSystem({ role: 'brain' }, { type: 'RESTART_BRAIN' });
      } catch (err) {
        broadcastToSurface('settings', { type: 'PACK_CONTENT_IMPORT_FAILED', error: errorMessage(err) });
      }
    },

      sendPacksList: () => {
        emitPacksList(registry);
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
      restoreContentItem: ({ event }) => {
        const ev = packsSpec.typeOf('RESTORE_CONTENT_ITEM', event);
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
          sendToSystem('bus', { type: 'PACK_CHANGED', packId: ev.packId });
        } catch (err) {
          reportError({ source: 'packs', operation: 'restoreContentItem', severity: 'error', error: err });
        }
        emitPacksList(registry);
      },

      /** "Keep mine": the item stays as the user wrote it, and this version is not offered again */
      dismissContentOffer: ({ event }) => {
        const ev = packsSpec.typeOf('DISMISS_CONTENT_OFFER', event);
        const offer = appliedContent.get(ev.packId).items[ev.key]?.offer;
        appliedContent.resolveOffer(ev.packId, ev.key, {
          choice: 'dismissed',
          ...(offer?.contentHash !== undefined && { contentHash: offer.contentHash }),
        });
        emitPacksList(registry);
      },

      /**
       * "Delete it": the other answer to an item the pack stopped shipping. The entity goes and so does its
       * entry, which is what makes the decision final — there is nothing left for a later apply to describe.
       */
      deleteContentItem: ({ event }) => {
        const ev = packsSpec.typeOf('DELETE_CONTENT_ITEM', event);
        try {
          const item = appliedContent.get(ev.packId).items[ev.key];
          const entity = contentEntity(item?.entityType, ev.key);
          // Through the owner's own delete: a flow's nodes and wiring go with it, and an entity type whose
          // pack registered a `remove` writer is removed the way that pack removes one
          if (entity) removeContentEntity(item!.entityType!, entity.id);
          appliedContent.resolveOffer(ev.packId, ev.key, { choice: 'deleted' });
          sendToSystem('bus', { type: 'PACK_CHANGED', packId: ev.packId });
        } catch (err) {
          reportError({ source: 'packs', operation: 'deleteContentItem', severity: 'error', error: err });
        }
        emitPacksList(registry);
      },

      installPack: ({ system, event }) => {
        const ev = event.type === 'REPLACE_PACK' ? packsSpec.typeOf('REPLACE_PACK', event) : packsSpec.typeOf('INSTALL_PACK', event);
        const packSlug = ev.packSlug;

        // Reserve the source while downloading, then the resolved owner before publication.
        if (!registry.claimPackOperation(packSlug)) {
          broadcastToSurface('packs', { type: 'PACK_INSTALL_FAILED' as const, packSlug, error: operationInProgress(packSlug) });
          return;
        }
        console.log(`[packs] Install requested: ${packSlug} (source kind: ${ev.sourceKind ?? 'default'})`);

        broadcastToSurface('packs', { type: 'PACK_INSTALL_STARTED' as const, packSlug });

        const isGitHub = resolveInstallSourceKind(packSlug, ev.sourceKind) === 'github';
        let installingId: string | undefined;
        let startAccepted: (() => boolean) | undefined;
        runInstall(packSlug, ev.sourceKind, undefined, {
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
            if (manifest.id !== packSlug && !registry.claimPackOperation(manifest.id)) {
              throw new Error(operationInProgress(manifest.id));
            }
            installingId = manifest.id;
          },
          accept: candidate => {
            startAccepted = acceptInstalledPack(registry, candidate.id, system.get(HOST.bus));
          },
        }).then(result => {
          let activated: boolean;
          try {
            if (!recordInstalled(result.id, isGitHub ? packSlug : undefined)) {
              throw new Error(`${result.name} was installed, but its install source and enablement could not be saved`);
            }
          }
          finally { activated = startAccepted!(); }
          const problem = activationProblem(registry, result.id, activated);
          if (problem) {
            broadcastToSurface('packs', {
              type: 'PACK_INSTALL_FAILED' as const,
              packSlug,
              error: `${result.name} was installed but ${problem}`,
            });
            emitPacksList(registry);
            return;
          }

          broadcastToSurface('packs', {
            type: 'PACK_INSTALL_COMPLETE' as const,
            packSlug,
            packId: result.id,
            packName: result.name,
            version: result.version,
          });
          broadcastToSurface('packs', { type: 'PACK_ACTIVATED' as const, packId: result.id });
          emitPacksList(registry);
        }).catch(err => {
          const message = errorMessage(err);
          console.error(`[packs] Install failed for ${packSlug}:`, message);
          broadcastToSurface('packs', {
            type: 'PACK_INSTALL_FAILED' as const,
            packSlug,
            error: message,
          });
        }).finally(() => {
          if (installingId) registry.releasePackOperation(installingId);
          registry.releasePackOperation(packSlug);
        });
      },

      restorePack: ({ system, event }) => {
        const { packId, sourceRevision } = packsSpec.typeOf('RESTORE_PACK', event);
        const fail = (error: unknown) => broadcastToSurface('packs', {
          type: 'PACK_INSTALL_FAILED' as const, packSlug: packId, error: errorMessage(error),
        });
        if (packId === HOST_PACK_ID || !PACK_ID_PATTERN.test(packId)) {
          fail(new Error('Select an installable app default'));
          return;
        }
        if (!registry.claimPackOperation(packId)) {
          fail(new Error(operationInProgress(packId)));
          return;
        }
        broadcastToSurface('packs', { type: 'PACK_INSTALL_STARTED' as const, packSlug: packId });
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
            installedPacksFile, expectedSourceRevision: sourceRevision,
            hostVersion: getAppVersion(), packFormat: PACK_SNAPSHOT_FORMAT,
            beforePlace: manifest => registry.catalog.assertPackSettings(manifest),
            accept: candidate => { startAccepted = acceptInstalledPack(registry, candidate.id, system.get(HOST.bus)); },
          });
        }).then(result => {
          const activated = startAccepted!();
          const problem = activationProblem(registry, packId, activated);
          if (problem) fail(new Error(`${result.name} was restored but ${problem}`));
          else {
            broadcastToSurface('packs', { type: 'PACK_INSTALL_COMPLETE' as const, packSlug: packId,
              packId, packName: result.name, version: result.version });
            broadcastToSurface('packs', { type: 'PACK_ACTIVATED' as const, packId });
          }
          emitPacksList(registry);
        }).catch(fail).finally(() => { registry.releasePackOperation(packId); });
      },

      uninstallPack: ({ system, event }) => {
        const ev = packsSpec.typeOf('UNINSTALL_PACK', event);
        const packId = ev.packId;
        if (packId === HOST_PACK_ID) {
          broadcastToSurface('packs', { type: 'PACK_UNINSTALL_FAILED' as const, packId, error: `"${packId}" is part of apack, so it can't be uninstalled` });
          return;
        }
        // The id names the directory the uninstall deletes, so only an installed pack's own is taken
        if (!isInstalled(packId)) {
          broadcastToSurface('packs', { type: 'PACK_UNINSTALL_FAILED' as const, packId, error: `"${packId}" is not an installed pack` });
          return;
        }

        if (!registry.claimPackOperation(packId)) {
          broadcastToSurface('packs', { type: 'PACK_UNINSTALL_FAILED' as const, packId, error: operationInProgress(packId) });
          return;
        }
        console.log(`[packs] Uninstall requested: ${packId}`);

        let cacheDir: string;
        Promise.resolve().then(() => {
          cacheDir = fs.realpathSync(path.join(resolveAppEnvironment().packsDir, packId));
          return runUninstall(packId, undefined, { installedPacksFile: resolveAppEnvironment().installedPacksFile });
        }).then(() => teardownPack(registry, packId, system.get(HOST.bus))).then(() => {
          clearPackRequireCache(cacheDir);
          broadcastToSurface('packs', { type: 'PACK_DEACTIVATED' as const, packId });

          broadcastToSurface('packs', {
            type: 'PACK_UNINSTALL_COMPLETE' as const,
            packId,
          });
          emitPacksList(registry);
        }).catch(err => {
          const message = errorMessage(err);
          console.error(`[packs] Uninstall failed for ${packId}:`, message);
          broadcastToSurface('packs', {
            type: 'PACK_UNINSTALL_FAILED' as const,
            packId,
            error: message,
          });
        }).finally(() => {
          registry.releasePackOperation(packId);
        });
      },

      updateAppPack: ({ system, event }) => {
        const { packId, sourceRevision } = packsSpec.typeOf('UPDATE_APP_PACK', event);
        const fail = (error: unknown) => broadcastToSurface('packs', {
          type: 'PACK_UPDATE_FAILED' as const, packId, error: errorMessage(error),
        });
        if (!registry.claimPackOperation(packId)) {
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
            installedPacksFile, expectedSourceRevision: sourceRevision,
            hostVersion: getAppVersion(), packFormat: PACK_SNAPSHOT_FORMAT,
            beforePlace: manifest => registry.catalog.assertPackSettings(manifest),
            accept: candidate => {
              enabled = packRecord(packId).enabled;
              if (enabled) startAccepted = acceptInstalledPack(registry, candidate.id, system.get(HOST.bus));
            },
          });
        }).then(result => {
          const activated = enabled ? startAccepted!() : false;
          if (!enabled) registry.refreshCatalog();
          const problem = enabled ? activationProblem(registry, packId, activated) : undefined;
          if (problem) fail(new Error(`${result.name} was updated but ${problem}`));
          else {
            broadcastToSurface('packs', { type: 'PACK_UPDATE_COMPLETE' as const, packId, version: result.version });
            if (activated) broadcastToSurface('packs', { type: 'PACK_ACTIVATED' as const, packId });
          }
          emitPacksList(registry);
        }).catch(error => { fail(error); emitPacksList(registry); }).finally(() => { registry.releasePackOperation(packId); });
      },

      updatePack: ({ system, event }) => {
        const ev = packsSpec.typeOf('UPDATE_PACK', event);
        const packId = ev.packId;
        const entry = packRecord(packId);
        if (entry.updatesWith === 'app' || !entry.installedFrom) {
          broadcastToSurface('packs', {
            type: 'PACK_UPDATE_FAILED' as const,
            packId,
            error: entry.updatesWith === 'app' ? 'Use the selected app-source update for an app-managed pack' : 'Pack has no update source',
          });
          return;
        }

        if (!registry.claimPackOperation(packId)) {
          broadcastToSurface('packs', { type: 'PACK_UPDATE_FAILED' as const, packId, error: operationInProgress(packId) });
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
            if (entry.enabled) startAccepted = acceptInstalledPack(registry, candidate.id, system.get(HOST.bus));
          },
        }).then(result => {
          let activated: boolean;
          try {
            if (!recordUpdateInstalled(packId)) throw new Error(`Updated ${packId}, but its update record could not be saved`);
          }
          finally {
            if (entry.enabled) activated = startAccepted!();
            else { registry.refreshCatalog(); activated = false; }
          }
          const problem = entry.enabled ? activationProblem(registry, packId, activated) : undefined;
          if (problem) {
            broadcastToSurface('packs', {
              type: 'PACK_UPDATE_FAILED' as const,
              packId,
              error: `Updated to ${result.version} but ${problem}`,
            });
            emitPacksList(registry);
            return;
          }

          broadcastToSurface('packs', {
            type: 'PACK_UPDATE_COMPLETE' as const,
            packId,
            version: result.version,
          });
          if (activated) broadcastToSurface('packs', { type: 'PACK_ACTIVATED' as const, packId });
          emitPacksList(registry);
        }).catch(err => {
          const message = errorMessage(err);
          console.error(`[packs] Update failed for ${packId}:`, message);
          broadcastToSurface('packs', {
            type: 'PACK_UPDATE_FAILED' as const,
            packId,
            error: message,
          });
          emitPacksList(registry);
        }).finally(() => {
          registry.releasePackOperation(packId);
        });
      },

      checkForPackUpdates: () => {
        checkForUpdates({ hostVersion: getAppVersion() }).then(() => {
          emitPacksList(registry);
        }).catch(err => {
          console.error('[packs] Update check failed:', err);
        });
      },

      togglePackEnabled: ({ system, event, self }) => {
        const ev = packsSpec.typeOf('TOGGLE_PACK_ENABLED', event);
        const packId = ev.packId;

        if (packId === HOST_PACK_ID) return;
        // Claimed like any other operation on the pack, so a development install cannot land mid-toggle
        if (!registry.claimPackOperation(packId)) {
          // The pack's own disable is still tearing down: turning it back on is what was asked, once that ends
          const teardown = teardowns.get(packId);
          if (teardown) {
            void teardown.then(() => self.send(event));
            return;
          }
          // Refused as every operation on a busy pack is, and said so: each window shows the state that holds
          reportError({ source: 'packs', operation: 'setPackEnabled', severity: 'error', error: new Error(operationInProgress(packId)) });
          if (isInstalled(packId)) {
            broadcastToSurface('packs', { type: 'PACK_ENABLED_CHANGED' as const, packId, enabled: packRecord(packId).enabled });
          }
          return;
        }
        // Held until a disable's teardown finishes, since the pack is registered until then
        let tearingDown: Promise<void> | undefined;
        try {
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
            broadcastToSurface('packs', { type: 'PACK_ENABLED_CHANGED' as const, packId, enabled: entry.enabled });
            return;
          }

          if (!setPackEnabled(packId, newEnabled)) {
            reportError({ source: 'packs', operation: 'setPackEnabled', severity: 'error',
              error: new Error(`Couldn't save that ${packId} is ${newEnabled ? 'enabled' : 'disabled'}; the current state is unchanged.`),
            });
            broadcastToSurface('packs', { type: 'PACK_ENABLED_CHANGED' as const, packId, enabled: entry.enabled });
            return;
          }

          if (!newEnabled) {
            tearingDown = teardownPack(registry, packId, system.get(HOST.bus));
            broadcastToSurface('packs', { type: 'PACK_DEACTIVATED' as const, packId });
          } else {
            if (activatePack(registry, packId, system.get(HOST.bus))) {
              broadcastToSurface('packs', { type: 'PACK_ACTIVATED' as const, packId });
            }
          }

          broadcastToSurface('packs', {
            type: 'PACK_ENABLED_CHANGED' as const,
            packId,
            enabled: newEnabled,
          });
          emitPacksList(registry);
        } finally {
          if (tearingDown) {
            const settled = tearingDown.finally(() => {
              registry.releasePackOperation(packId);
              teardowns.delete(packId);
            });
            teardowns.set(packId, settled);
            void settled;
          } else {
            registry.releasePackOperation(packId);
          }
        }
      },
    }),
  }).createMachine({
    id: HOST.packs,
    initial: 'idle',
    context: {},
    states: {
      idle: {
        on: {
          SEND_STATE: {
            actions: 'sendPacksList',
          },
          GET_INSTALLED_PACKS: {
            actions: 'sendPacksList',
          },
          // A pack activated, reloaded or torn down changes this list, and a reload is the one that
          // reaches here no other way: it comes from `apack pack dev`, not from an action of this system
          INSTALL_PACK: {
            actions: 'installPack',
          },
          REPLACE_PACK: { actions: 'installPack' },
          RESTORE_PACK: { actions: 'restorePack' },
          UNINSTALL_PACK: {
            actions: 'uninstallPack',
          },
          TOGGLE_PACK_ENABLED: {
            actions: 'togglePackEnabled',
          },
          UPDATE_APP_PACK: { actions: 'updateAppPack' },
          UPDATE_PACK: {
            actions: 'updatePack',
          },
          PREVIEW_PACK_CONTENT: {
            actions: 'previewPackContent',
          },
          IMPORT_PACK_CONTENT: {
            actions: 'importPackContent',
          },
          RESTORE_CONTENT_ITEM: {
            actions: 'restoreContentItem',
          },
          DISMISS_CONTENT_OFFER: {
            actions: 'dismissContentOffer',
          },
          DELETE_CONTENT_ITEM: {
            actions: 'deleteContentItem',
          },
          CHECK_FOR_UPDATES: {
            actions: 'checkForPackUpdates',
          },
        },
      },
    },
  });
}
