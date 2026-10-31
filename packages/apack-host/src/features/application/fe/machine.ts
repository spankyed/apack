import { ENTITY_OPENING_ID, createEntityOpeningMachine, checkEntityOpening, type EntityOpeningActor } from './entity-opening.ts';
// The app shell: the host `application` feature's surface, which runs every surface's actor, holds which one is open,
// lays out the panels and loads every pack's frontend. Its I/O arrives as options (types.ts); the renderer
// composes it with the API client and the window, a pack's tests with fakes.
import { assign, enqueueActions, fromCallback, setup, spawnChild } from 'xstate';
import { processHotkeys, safeEvents } from '@apackdev/sdk/fe';
import { splitRef } from '@apackdev/sdk/ids';
import { senderSuffix } from '@apackdev/sdk/events';
import { isPlainObject } from '@apackdev/sdk/utils/pure';
import type { HostShellEvent, HostShellState, SurfaceEvent, ShellPanelSizes, Surface } from '@apackdev/sdk/fe';
import { selectDefaultSurfaceDeclaration, getEligibleSurface, selectSurfaceDeclaration } from '../../../fe/surface-selection.ts';
import { HOST } from '../../../refs.ts';
import { connectionListener } from './connection.ts';
import { hotkeyListener, mouseListener } from './input.ts';
import {
  chatMaximized, chatRestored, initialPanelSizes, inspectionToggled, resized,
} from './layout.ts';
import { announcePackClientReady, PACK_FRONTEND_LOADER_ID, packFrontendLoader } from './pack-frontends.ts';
import { historyAfter, neighbourOf, spawnSurfaceActor, withHostLast } from './surfaces.ts';
import { surfaceNavigationItems } from '../../../fe/surface-navigation.ts';
import { notifySurfaceActor, sendToSurfaceActor } from '../../../fe/surface-delivery.ts';
import { computeCrumbs, surfaceTrailer } from './trail.ts';
import type { SurfaceRequest, ShellContext, ShellEvent, ShellOptions, ShellParams } from './types.ts';

const typeOf = safeEvents<ShellEvent>();

/**
 * Compiles only while the shell accepts every event the SDK's `HostShell` lets frontend code send, and holds the
 * state it lets frontend code read: a change to either side fails the typecheck here, not a pack at runtime.
 */
function satisfiesHostShell<_Contract extends [true, true]>(): void {}
satisfiesHostShell<[
  [HostShellEvent] extends [ShellEvent] ? true : false,
  ShellContext extends HostShellState ? true : false,
]>();

/** Whether a pack frontend may still add surfaces: the loaded packs not read yet, or a load running or queued */
function packFrontendsPending(context: ShellContext): boolean {
  return !context.loadedPacksRead || context.packLoadRunning || context.packLoadQueued;
}

/**
 * What the user is told when a surface isn't here: the title and the detail, for `notify.error`.
 *
 * Opening and sending can each be refused at once or after waiting for pack frontends, and one function writes
 * every one of those so the wording can't differ by which branch the app happened to take — which would tell the
 * reader about the app's internals and nothing about their problem.
 *
 * Not every refusal has a user to tell, so `refuse` picks the audience and this writes only that audience's
 * words. An answer gets the other wording, for the reason given there.
 */
function refusal({ surface, select, sender }: SurfaceRequest, detail?: string): [string, string] {
  const suffix = senderSuffix(sender);
  return [`Couldn't ${select ? 'open' : 'reach'} ${surface}`, `${detail ?? `No surface is declared at "${surface}".`}${suffix && ` Sent${suffix}.`}`];
}

/** The part of `enqueueActions`' `enqueue` that `readyFor` needs, so it can be a function rather than a third action */
type Enqueue = {
  (action: () => void): void;
  assign: (values: Partial<ShellContext>) => void;
  sendTo: (owner: EntityOpeningActor, event: { type: 'REFUSED'; token: string; detail: string }) => void;
};

/** The app shell over `options`, the I/O it's given */
export function createShellMachine({ packs, catalog, client, packFrontends, storage, notify, target }: ShellOptions) {
  const entityOptions = { client, catalog, bindings: () => packs.surfaceBindings(), refuse: (title: string, detail: string) => notify.error(title, detail) };
  const selectedDefaultSurface = (surfaces: readonly Surface[]) => {
    const declaration = selectDefaultSurfaceDeclaration(catalog);
    const accepted = declaration ? getEligibleSurface(catalog, packs.surfaceBindings(), declaration.featureRef) : undefined;
    return accepted && surfaces.includes(accepted) ? accepted : undefined;
  };
  const currentSurface = (context: ShellContext, ref: string) => {
    const accepted = getEligibleSurface(catalog, packs.surfaceBindings(), ref);
    return accepted && context.surfaces.includes(accepted) ? accepted : undefined;
  };
  const unavailable = (ref: string): string | undefined => {
    const declaration = selectSurfaceDeclaration(catalog, ref);
    if (declaration?.origin === 'native') return declaration.enabled === true ? undefined : `The pack providing "${ref}" is disabled.`;
    if (catalog.status() !== 'ready') return catalog.status() === 'loading' ? undefined : 'Surface declarations are unavailable.';
    if (!declaration) return `No surface is declared at "${ref}".`;
    if (declaration.origin === 'source') return `The pack providing "${ref}" is not installed.`;
    if (declaration.enabled !== true) return `The pack providing "${ref}" is disabled.`;
  };

  /** Sizes the user chose, which the next window opens with; sizes set for the moment are assigned without it */
  const saved = (sizes: ShellPanelSizes): ShellPanelSizes => {
    storage.savePanelSizes(sizes);
    return sizes;
  };

  /**
   * Tells whoever this concerns that the surface isn't here, and **who that is depends on whether a person is
   * waiting.** A command someone gave in this window failed, so they are told; an answer to a question had no
   * user behind it, so a toast would be an app telling someone about its own plumbing in the middle of their
   * work — unactionable by construction, since the thing that asked was a machine.
   *
   * It is still a loss worth recording, so it goes to the console as the bus's undeliverable sends do
   * (`connection.ts`), with a sentence written for a log rather than for a person.
   *
   * The case it fires in is a race, not a bug: a surface asks, its answer is built, and the answering pack
   * unloads before the answer lands. Nothing holds the asker open.
   */
  const refuse = (context: ShellContext, request: SurfaceRequest, enqueue: Enqueue, detail?: string): void => {
    if (request.entityToken) {
      enqueue.sendTo(context.entityOpening, { type: 'REFUSED', token: request.entityToken, detail: detail ?? unavailable(request.surface) ?? `The surface "${request.surface}" could not be loaded.` });
      return;
    }
    enqueue(() => {
      if (!request.answering) {
        notify.error(...refusal(request, detail ?? unavailable(request.surface)
          ?? (selectSurfaceDeclaration(catalog, request.surface) ? `The surface "${request.surface}" could not be loaded.` : undefined)));
        return;
      }
      const suffix = senderSuffix(request.sender);
      console.warn(`[shell] Dropped an answer for "${request.surface}": no surface is registered there${suffix && `, answering${suffix}`}`);
    });
  };

  /**
   * Whether the surface is here to take the request, and what to do when it isn't: wait, while pack frontends may
   * still add it (finishPackFrontendLoad refuses whatever is still waiting), or refuse it now. Both requests ask
   * the same question and answer it the same way, so `false` means the caller has nothing left to do but return.
   */
  /**
   * The waiting queue once a person navigates or opens something else: an open still waiting for its pack no longer
   * selects it, so the user stays where they went, but its events are still delivered when it arrives. An open with
   * nothing to deliver is dropped; an entity open is the entity opener's, which cancels it on its own.
   */
  const supersedeWaitingOpens = (context: ShellContext): ShellContext['awaitingSurface'] => context.awaitingSurface
    .filter(request => !request.select || request.entityToken || request.events.length > 0)
    .map(request => request.select && !request.entityToken ? { ...request, select: false } : request);

  const readyFor = (context: ShellContext, request: SurfaceRequest & { events: SurfaceEvent[] }, enqueue: Enqueue): boolean => {
    if (request.entityToken) {
      const opening = checkEntityOpening(context.entityOpening, request.entityToken, entityOptions);
      if (!opening.current) return false;
      if (opening.problem) { refuse(context, request, enqueue, opening.problem); return false; }
    }
    const reason = unavailable(request.surface);
    if (reason) {
      refuse(context, request, enqueue, reason); return false;
    }
    if (currentSurface(context, request.surface)) return true;
    if (catalog.status() === 'loading' || packFrontendsPending(context)) enqueue.assign({ awaitingSurface: [...context.awaitingSurface, request] });
    else {
      refuse(context, request, enqueue);
    }
    return false;
  };

  return setup({
    types: {
      context: {} as ShellContext,
      events: {} as ShellEvent,
      input: {} as ShellParams,
    },
    actors: {
      entityOpening: createEntityOpeningMachine(entityOptions),
      surfaceCatalogListener: fromCallback(({ sendBack }) => catalog.subscribe(() => sendBack({ type: 'SURFACE_DECLARATIONS_CHANGED' }))),
      hotkeyListener: hotkeyListener(target),
      mouseListener: mouseListener(target),
      connectionListener: connectionListener(client),
      packFrontendLoader: packFrontendLoader(client, packFrontends),
      surfaceTrailer,
    },
    // An action is named for what it does to the shell, never for the event or the API call that triggered it: a
    // trigger name collides with whatever does the triggering, and it can't survive a second caller — several of
    // these serve more than one transition, so there is no single event to name them after.
    actions: {
      beginEntityOpen: enqueueActions(({ context, event, enqueue }) => {
        enqueue.assign({ wantsDefaultSurface: false, pendingSurfaceId: null });
        enqueue.sendTo(context.entityOpening, typeOf('OPEN_ENTITY', event));
      }),
      cancelEntityOpen: enqueueActions(({ context, enqueue }) => { enqueue.sendTo(context.entityOpening, { type: 'CANCEL' }); }),
      supersedeWaitingOpens: assign(({ context }) => ({ awaitingSurface: supersedeWaitingOpens(context) })),
      updateEntityDestination: enqueueActions(({ context, enqueue }) => { enqueue.sendTo(context.entityOpening, { type: 'CHANGED' }); }),
      refreshSurfaceDeclarations: enqueueActions(({ context, enqueue }) => {
        const claimed = selectedDefaultSurface(context.surfaces) ?? null;
        enqueue.assign({ defaultSurface: claimed });
        if (context.wantsDefaultSurface && !context.pendingSurfaceId && claimed) enqueue.raise({ type: 'SELECT_SURFACE_BY_SHELL', surface: claimed.id });
        // A frontend may be admitted before its declaration frame reaches this window. Reconcile
        // from accepted bindings when that frame arrives, without keeping a second pending inventory.
        const bindings = packs.surfaceBindings();
        const changedOwners = new Set([...bindings].filter(([ref, accepted]) => accepted.registrationId
          && getEligibleSurface(catalog, bindings, ref) && !context.surfaces.includes(accepted.binding)).map(([, accepted]) => accepted.packId));
        const pending = new Set<string>();
        for (const packId of changedOwners) {
          const accepted = [...bindings.values()].filter(binding => binding.packId === packId);
          if (!accepted.every(binding => getEligibleSurface(catalog, bindings, binding.binding.id))) continue;
          pending.add(packId);
          enqueue.raise({ type: 'PACK_FRONTEND_LOADED', packId, registrationId: accepted[0]!.registrationId!, surfaces: accepted.map(binding => binding.binding) });
        }
        const waiting = [];
        for (const request of context.awaitingSurface) {
          if (currentSurface(context, request.surface)) {
            enqueue.raise(request.select ? { type: 'OPEN_SURFACE', surface: request.surface, events: request.events, entityToken: request.entityToken }
              : { type: 'SEND_TO_SURFACE', surface: request.surface, events: request.events, ...request.sender, answering: request.answering, call: request.call });
          } else if (unavailable(request.surface) || (catalog.status() === 'ready' && !packFrontendsPending(context) && !pending.has(splitRef(request.surface)?.packId ?? ''))) {
            refuse(context, request, enqueue);
          } else waiting.push(request);
        }
        enqueue.assign({ awaitingSurface: waiting });
        if (context.pendingSurfaceId) {
          if (unavailable(context.pendingSurfaceId)) enqueue.assign({ pendingSurfaceId: null });
          else if (currentSurface(context, context.pendingSurfaceId)) enqueue.raise({ type: 'SELECT_SURFACE_BY_SHELL', surface: context.pendingSurfaceId });
        }
      }),

      updateHotkeys: assign(({ event }) => ({ hotkeys: typeOf('APPLICATION_HOTKEYS', event).hotkeys })),

      mergePackSurfaces: enqueueActions(({ event, context, system, enqueue }) => {
        const { packId, registrationId, surfaces: packSurfaces } = typeOf('PACK_FRONTEND_LOADED', event);

        // The pack was unloaded while its frontend was loading: keep its surfaces out, since nothing would ever take
        // them out again, and undo what the load registered
        if (context.packsUnloadedWhileLoading.includes(packId)) {
          enqueue.assign({ packsUnloadedWhileLoading: context.packsUnloadedWhileLoading.filter(id => id !== packId) });
          enqueue(() => packFrontends.unload(packId));
          return;
        }

        // A newer acceptance already replaced this one: the event is stale, and its successor merges instead
        if (packSurfaces?.some(surface => {
          const accepted = packs.surfaceBindings().get(surface.id);
          return accepted?.registrationId !== undefined && accepted.registrationId !== registrationId;
        })) return;
        if (packSurfaces?.some(surface => getEligibleSurface(catalog, packs.surfaceBindings(), surface.id) !== surface)) {
          // The catalog disabled or removed the pack while its frontend loaded: take the committed frontend back
          // out, since nothing else would. While the catalog is still settling, eligibility says nothing yet.
          const withdrawn = catalog.status() === 'ready'
            && packSurfaces.some(surface => selectSurfaceDeclaration(catalog, surface.id)?.enabled !== true);
          if (withdrawn) enqueue.raise({ type: 'PACK_SURFACES_UNLOADED', packId, refused: true });
          return;
        }

        const acceptedPackRuntimes = { ...context.acceptedPackRuntimes, [packId]: registrationId };

        // Only an accepted load reaches this action. Replace this owner's actors and view together;
        // failed candidates never retire the incumbent or disturb its selection.
        const previous = context.surfaces.filter(surface => surface.id.startsWith(`${packId}/`));
        const retained = context.surfaces.filter(surface => !surface.id.startsWith(`${packId}/`));
        const newSurfaces = packSurfaces ?? [];
        const firstPrevious = context.surfaces.findIndex(surface => surface.id.startsWith(`${packId}/`));
        const position = firstPrevious < 0 ? retained.length : firstPrevious;
        const surfaces = withHostLast([...retained.slice(0, position), ...newSurfaces, ...retained.slice(position)]);
        const defaultSurface = selectedDefaultSurface(surfaces) ?? null;
        const replacingActive = previous.some(surface => surface.id === context.activeSurface.id);
        const activeSurface = replacingActive
          ? (newSurfaces.find(surface => surface.id === context.activeSurface.id) ?? surfaces[0])
          : context.activeSurface;
        for (const surface of previous) {
          const actor = system.get(surface.id);
          if (actor) enqueue.stopChild(actor);
        }
        const packsWithFrontend = packSurfaces === null
          ? context.packsWithFrontend.filter(id => id !== packId)
          : context.packsWithFrontend.includes(packId) ? context.packsWithFrontend : [...context.packsWithFrontend, packId];
        enqueue.assign({ surfaces, acceptedPackRuntimes, packsWithFrontend, defaultSurface,
          ...(activeSurface ? { activeSurface } : {}) });
        if (newSurfaces.length > 0) {
          // Visibility is the host's (AppState, sent on each connection); unset shows the surface
          for (const surface of newSurfaces) spawnSurfaceActor(enqueue, surface);
          const added = new Set<string>(newSurfaces.map((p) => p.id));
          // A pack claiming the app's default is how this window learns what it is. It opens it only while
          // nothing else has decided what is shown, so a window the user has navigated, or one the host told
          // which surface was last open, is left alone
          const claimed = selectedDefaultSurface(surfaces);
          if (claimed && added.has(claimed.id)) {
            enqueue.assign({ defaultSurface: claimed, wantsDefaultSurface: false });
            if (context.wantsDefaultSurface && !context.pendingSurfaceId) {
              enqueue.raise({ type: 'SELECT_SURFACE_BY_SHELL', surface: claimed.id });
            }
          }
          const pending = context.pendingSurfaceId;
          if (pending && added.has(pending)) enqueue.raise({ type: 'SELECT_SURFACE_BY_SHELL', surface: pending });
          // Surfaces asked to open while their pack loaded open now, with their events
          const arrived = context.awaitingSurface.filter((work) => added.has(work.surface));
          if (arrived.length > 0) {
            enqueue.assign({ awaitingSurface: context.awaitingSurface.filter((work) => !added.has(work.surface)) });
            // `select` is what the wait was for: an open selects the surface, a send only hands it its events
            for (const { surface, events, select, sender, answering, call, entityToken } of arrived) {
              // One spread, because who asked is one member: the labels a refusal would name and the address an
              // answer goes to left the queue together, as they entered it.
              //
              // `answering` rides along to keep the re-raised event identical to the one that was queued, and
              // **no case covers it, because nothing reads it on this path**: the drain re-raises only the
              // requests whose surface arrived, so `readyFor` says yes and the send is delivered rather than
              // refused. Measured by mutation 2026-10-06 — dropping it here fails nothing. What would make it
              // matter is the surface going away again between arriving and this re-raise being handled, which
              // `PACK_SURFACES_UNLOADED` can do; then it is refused after all, and the flag decides how.
              enqueue.raise(select ? { type: 'OPEN_SURFACE', surface, events, entityToken } : { type: 'SEND_TO_SURFACE', surface, events, ...sender, answering, call });
            }
          }
        }
        if (replacingActive && activeSurface) {
          enqueue(({ system }) => {
            const actor = system.get(activeSurface.id);
            if (actor) notifySurfaceActor(actor, activeSurface.id, { type: 'SURFACE_ACTIVATED' });
          });
        }
        if (packSurfaces !== null && context.busSubscribed) enqueue(() => announcePackClientReady(client, packId, registrationId));
      }),

      // This window's subscription (re)connected: its CLIENT_CONNECTED skipped the packs whose frontends load after
      // it, whatever the frontend turned out to add — a pack that exported no surface has systems waiting too
      announceLoadedPacks: ({ context }) => {
        if (!context.packFrontendsNeedRefresh) {
          for (const packId of context.packsWithFrontend) announcePackClientReady(client, packId, context.acceptedPackRuntimes[packId]!);
        }
      },

      /** Runs the pack frontend loader, or queues a run when one is under way */
      loadPackFrontends: enqueueActions(({ context, enqueue }) => {
        if (!context.busSubscribed) return;
        if (context.packLoadRunning) {
          enqueue.assign({ packLoadQueued: true });
          return;
        }
        enqueue.assign({ packLoadRunning: true, packLoadQueued: false });
        enqueue.spawnChild('packFrontendLoader', { id: PACK_FRONTEND_LOADER_ID, input: { acceptedPackRuntimes: context.acceptedPackRuntimes, refresh: context.packFrontendsNeedRefresh } });
      }),

      /** The loader finished: run it again when a load was asked for meanwhile, and report what failed */
      finishPackFrontendLoad: enqueueActions(({ context, event, enqueue }) => {
        const { loadedPacksError, failedPacks } = typeOf('PACK_FRONTENDS_SETTLED', event);
        enqueue.stopChild(PACK_FRONTEND_LOADER_ID);
        const refresh = context.packFrontendsNeedRefresh && (!!loadedPacksError || !!failedPacks?.length);
        enqueue.assign({ packFrontendsNeedRefresh: refresh });

        // A refused replacement unloads the frontend it would have replaced: that one no longer matches what this
        // connection runs, its systems were never told it is ready, and its settings binding ended with the
        // previous connection. The next run loads the pack afresh.
        const refusedIncumbents = (failedPacks ?? []).map(failed => failed.packId).filter(id => id in context.acceptedPackRuntimes);
        const acceptedPackRuntimes = Object.fromEntries(Object.entries(context.acceptedPackRuntimes)
          .filter(([id]) => !refusedIncumbents.includes(id)));
        for (const packId of refusedIncumbents) enqueue.raise({ type: 'PACK_SURFACES_UNLOADED', packId, refused: true });

        // Every result of the run that finished has arrived, so nothing is left to drop
        if (context.packsUnloadedWhileLoading.length > 0) enqueue.assign({ packsUnloadedWhileLoading: [] });

        if (context.packLoadQueued) {
          enqueue.assign({ packLoadQueued: false });
          // The packs this run loaded are in context already: the loader sends its results before settling
          enqueue.spawnChild('packFrontendLoader', { id: PACK_FRONTEND_LOADER_ID, input: { acceptedPackRuntimes, refresh } });
        } else {
          enqueue.assign({ packLoadRunning: false });
          // Loading has settled: a surface still asked for is one no loaded pack provides
          if (context.awaitingSurface.length > 0 && catalog.status() !== 'loading') {
            // `assign` replaces the array rather than mutating it, so the reference stays valid in the deferred enqueue
            const refused = context.awaitingSurface;
            enqueue.assign({ awaitingSurface: [] });
            for (const request of refused) refuse(context, request, enqueue);
          }
        }

        if (loadedPacksError) {
          // The next connection runs the loader again, so a read that fails while the API restarts repairs
          // itself; the user hears about it only while no pack has ever loaded
          const firstRead = !context.loadedPacksRead;
          enqueue(() => {
            console.warn('[shell] Failed to read the loaded packs:', loadedPacksError);
            if (firstRead) notify.error("Add-on packs couldn't be loaded", loadedPacksError);
          });
        } else if (!context.loadedPacksRead) {
          enqueue.assign({ loadedPacksRead: true });
        }

        if (failedPacks?.length) {
          // Name each refusal, and say when it also cost the pack its previous frontend.
          const names = failedPacks.map(p => p.packId).join(', ');
          const reason = (p: { packId: string; error: string }) =>
            refusedIncumbents.includes(p.packId) ? `${p.error} Its previous frontend was unloaded.` : p.error;
          const details = failedPacks.map(p => `${p.packId}: ${reason(p)}`).join('\n');
          enqueue(() => {
            console.warn(`[shell] Failed to load the frontend of ${names}:\n${details}`);
            notify.error(`Couldn't load ${names}`, failedPacks.map(reason).join('\n'));
          });
        }
      }),

      disconnectPackFrontends: enqueueActions(({ context, enqueue }) => {
        enqueue.sendTo(context.entityOpening, { type: 'CANCEL' });
        // Stop the attempt, not the accepted frontend. The next authoritative read determines removals.
        enqueue.stopChild(PACK_FRONTEND_LOADER_ID);
        enqueue.assign({ busSubscribed: false, packLoadRunning: false, packLoadQueued: false,
          packFrontendsNeedRefresh: true, packsUnloadedWhileLoading: [] });
      }),

      removePackSurfaces: enqueueActions(({ event, context, system, enqueue }) => {
        const { packId, refused } = typeOf('PACK_SURFACES_UNLOADED', event);
        enqueue.sendTo(context.entityOpening, { type: 'UNLOADED', packId });
        // A surface runs under its feature's ref, `<packId>/<featureId>`, and a pack id holds no `/`, so the pack's
        // surfaces are the ones this window has under that prefix. Matched rather than parsed: a surface left here
        // because its id didn't parse would stay with nothing to take it out. Nothing else records them either — a
        // second copy could disagree with the surfaces actually here, and miss the same way.
        const surfaceIds = context.surfaces.filter((p) => p.id.startsWith(`${packId}/`)).map((p) => p.id);

        // The shell loads a pack's frontend and it unloads it: the Packs surface says the pack is gone, and what
        // that means for this window — the registrations, the stylesheets, the surfaces below — is decided here
        enqueue(() => packFrontends.unload(packId));

        // The pack loads again when it comes back
        if (context.packsWithFrontend.includes(packId)) {
          enqueue.assign({ packsWithFrontend: context.packsWithFrontend.filter(id => id !== packId) });
        }
        enqueue.assign({ acceptedPackRuntimes: Object.fromEntries(Object.entries(context.acceptedPackRuntimes).filter(([id]) => id !== packId)) });
        if (!refused && context.packLoadRunning && !context.packsUnloadedWhileLoading.includes(packId)) {
          // It's being loaded right now: its result is dropped instead of adding surfaces nothing removes
          enqueue.assign({ packsUnloadedWhileLoading: [...context.packsUnloadedWhileLoading, packId] });
        }
        // A surface asked to open from a pack that's gone won't arrive
        if (context.awaitingSurface.some((work) => splitRef(work.surface)?.packId === packId)) {
          enqueue.assign({ awaitingSurface: context.awaitingSurface.filter((work) => splitRef(work.surface)?.packId !== packId) });
        }

        if (surfaceIds.length === 0) return;
        const removeSet = new Set(surfaceIds);
        const remaining = context.surfaces.filter(p => !removeSet.has(p.id));
        const surfaceVisibility = { ...context.surfaceVisibility };
        for (const id of surfaceIds) delete surfaceVisibility[id];

        const needsNavigate = removeSet.has(context.activeSurface.id);
        const defaultSurface = selectedDefaultSurface(remaining) ?? null;
        const activeSurface = needsNavigate ? (remaining[0] ?? context.activeSurface) : context.activeSurface;

        // Surface children are spawned by system id only, so stop them by reference
        for (const id of surfaceIds) {
          const surface = system.get(id);
          if (surface) enqueue.stopChild(surface);
        }

        enqueue.assign({ surfaces: remaining, surfaceVisibility, activeSurface, defaultSurface });

        if (needsNavigate) {
          enqueue(({ system }) => {
            // Tolerated: this runs as a pack's surfaces arrive, where the actor may not be spawned yet
            const active = system.get(activeSurface.id);
            if (active) notifySurfaceActor(active, activeSurface.id, { type: 'SURFACE_ACTIVATED' });
          });
        }
      }),

      updateSurfaceVisibility: assign(({ event }) => ({ surfaceVisibility: typeOf('SURFACE_VISIBILITY_UPDATED', event).surfaceVisibility })),

      updateCommands: assign(({ event }) => ({ commands: typeOf('COMMANDS_UPDATED', event).commands })),

      /**
       * The shell's state the backend sends on each connection (the host `application` system's, in AppState): which
       * surfaces' tabs show, and the surface the user last had open, which a main window opens on once it's registered.
       */
      applyShellState: enqueueActions(({ event, context, enqueue, self }) => {
        const { surfaceVisibility, lastActiveSurface } = typeOf('CLIENT_CONNECTED', event);
        enqueue.assign({ surfaceVisibility });
        // The host naming a surface is a decision about what this window shows, so the default no longer is
        if (context.ownsLastActiveSurface && lastActiveSurface) enqueue.assign({ wantsDefaultSurface: false });
        if (!context.ownsLastActiveSurface || !lastActiveSurface || lastActiveSurface === context.activeSurface.id) return;
        if (context.surfaces.some((p) => p.id === lastActiveSurface)) {
          enqueue(() => self.send({ type: 'SELECT_SURFACE_BY_SHELL', surface: lastActiveSurface }));
        } else {
          enqueue.assign({ pendingSurfaceId: lastActiveSurface });
        }
      }),

      /** A tab shown or hidden here: shown at once, and recorded by the host so every window and the next run agree */
      setSurfaceVisibility: enqueueActions(({ event, context, enqueue }) => {
        const { surface, visible } = typeOf('SET_SURFACE_VISIBILITY', event);
        enqueue.assign({ surfaceVisibility: { ...context.surfaceVisibility, [surface]: visible } });
        enqueue(() => client.send({ to: HOST.application, event: { type: 'SET_SURFACE_VISIBILITY', surface, visible } }));
      }),

      /**
       * Selects the surface, opens the canvas, then hands it its events — what `OPEN_SURFACE` asks for. The selecting
       * half of the pair, and the reason the pair exists: a send that stole the user's canvas would make every
       * cross-feature command a navigation.
       */
      selectAndDeliver: enqueueActions(({ context, event, enqueue }) => {
        const { surface, events, entityToken } = typeOf('OPEN_SURFACE', event);
        if (!entityToken) enqueue.sendTo(context.entityOpening, { type: 'CANCEL' });
        // The latest open is the one that selects
        const awaitingSurface = supersedeWaitingOpens(context);
        enqueue.assign({ awaitingSurface });
        if (!readyFor({ ...context, awaitingSurface }, { surface, events, entityToken, select: true, sender: {} }, enqueue)) return;
        if (entityToken) enqueue.sendTo(context.entityOpening, { type: 'READY', token: entityToken });
        if (context.activeSurface.id !== surface) enqueue.raise({ type: 'SELECT_SURFACE_BY_SHELL', surface });
        if (context.defaultToggles.canvas) enqueue.raise({ type: 'DEFAULT_TOGGLE', area: 'canvas' });
        if (events.length > 0 || entityToken) enqueue(({ self }) => self.send({ type: 'DELIVER_SURFACE_EVENTS', surface, events, entityToken }));
      }),

      /** Hands a surface its events and leaves the view where it is — what `SEND_TO_SURFACE` asks for */
      deliverWithoutSelecting: enqueueActions(({ context, event, enqueue }) => {
        const { surface, events, from, via, asker, answering, call, diagnostics } = typeOf('SEND_TO_SURFACE', event);
        if (!readyFor(context, { surface, events, select: false, sender: { from, via, asker, diagnostics }, answering, call }, enqueue)) return;
        if (events.length > 0) enqueue(({ self }) => self.send({ type: 'DELIVER_SURFACE_EVENTS', surface, events, asker, answering, call, diagnostics }));
      }),

      // A backend's request carries whatever the sending pack built: a payload that isn't a surface and its events
      // would crash the surface's actor, or this one, so it is refused here rather than delivered
      checkBackendOpenRequest: enqueueActions(({ event, enqueue }) => {
        const { surface, events = [] } = typeOf('OPEN_SURFACE_FROM_APP', event);
        const deliverable = Array.isArray(events) && events.every((e) => isPlainObject(e) && typeof e.type === 'string');
        if (typeof surface !== 'string' || !deliverable) {
          enqueue(() => notify.error("Couldn't open a surface", `A pack asked the app to open "${String(surface)}" with events it can't deliver`));
          return;
        }
        enqueue.raise({ type: 'OPEN_SURFACE' as const, surface, events: events as SurfaceEvent[] });
      }),

      deliverSurfaceEvents: enqueueActions(({ event, context, system, enqueue }) => {
        const { surface, events, asker, answering, call, entityToken, diagnostics } = typeOf('DELIVER_SURFACE_EVENTS', event);
        if (entityToken) {
          enqueue.sendTo(context.entityOpening, { type: 'DELIVER', token: entityToken });
          return;
        }
        const actor = system.get(surface);
        if (!currentSurface(context, surface) || !actor) {
          refuse(context, { surface, select: false, sender: { asker }, answering, call }, enqueue, `The surface "${surface}" is no longer ready.`);
          return;
        }
        // The address arrived built, so nothing here decides which channel an answer takes — only whether there
        // is one. A send that named no sender is news, and its handler is handed no `reply`.
        //
        // The call rides with it for the receiver's guards, which is the in-window half of what `connection.ts`
        // does for a backend send: one reader, `callOf(event)`, whichever channel the event came in on.
        const correlation = { ...(diagnostics && { diagnostics }), ...(call === undefined ? {} : { call }), ...(answering === undefined ? {} : { answering }) };
        for (const e of events) {
          if (asker) sendToSurfaceActor(actor, surface, e, asker, correlation);
          else notifySurfaceActor(actor, surface, e, correlation);
        }
      }),

      processGlobalHotkey: ({ self, context, event }) => {
        const { hotkeyEvent, originalEvent } = typeOf('PROCESS_GLOBAL_HOTKEY', event);
        const actionType = processHotkeys(hotkeyEvent, context.hotkeys, {
          toggleInspectionPanel: 'TOGGLE_INSPECTION_PANEL',
          switchSurfaceUp: 'SWITCH_SURFACE_UP',
          switchSurfaceDown: 'SWITCH_SURFACE_DOWN',
        });
        if (actionType) {
          originalEvent?.preventDefault();
          self.send({ type: actionType });
        } else {
          // Not an application hotkey, forward to surfaces
          self.send({ type: 'FORWARD_HOTKEY', event: hotkeyEvent });
        }
      },

      setHotkeysDisabled: assign({ hotkeysDisabled: (_, value: boolean) => value }),

      forwardNavToSurface: ({ context, system, event }) => {
        // Tolerated: a mouse button can arrive while the open surface's pack is unloading
        const navigating = system.get(context.activeSurface.id);
        if (navigating) notifySurfaceActor(navigating, context.activeSurface.id, { type: event.type as 'NAVIGATE_BACK' | 'NAVIGATE_FORWARD' });
      },

      switchSurfaceByDirection: ({ context, event, self }) => {
        const next = neighbourOf(surfaceNavigationItems(catalog, packs.surfaceBindings(), context.surfaceVisibility)
          .filter(surface => surface.visible && surface.loaded), context.activeSurface.id, event.type === 'SWITCH_SURFACE_UP' ? 'up' : 'down');
        if (next) self.send({ type: 'SELECT_SURFACE', surface: next.id });
      },

      forwardHotkeyToSurface: ({ context, event, system }) => {
        const hotkeyEvent = typeOf('FORWARD_HOTKEY', event).event;
        // Surfaces not open receive only their global hotkeys
        for (const surface of context.surfaces) {
          if (surface.id === context.activeSurface.id) continue;
          const globalActions = surface.hotkeys?.filter(h => h.global).map(h => h.action);
          if (globalActions?.length) notifySurfaceActor(system.get(surface.id), surface.id, { ...hotkeyEvent, allowedActions: new Set(globalActions) });
        }
        // The surface open receives all of them
        notifySurfaceActor(system.get(context.activeSurface.id), context.activeSurface.id, hotkeyEvent);
      },

      setTargetView: assign(({ event }) => ({ targetView: (event as { target: string }).target })),
      // Through the funnel rather than XState's `sendTo`, which names nobody: a surface handling a route click
      // could make no answerable send of its own. Nobody asked for the click, so it carries no asker.
      sendRouteClick: ({ system, context, event }) => {
        const ref = context.defaultToggles.canvas ? (context.defaultSurface?.id ?? context.activeSurface.id) : context.activeSurface.id;
        notifySurfaceActor(system.get(ref), ref, event);
      },
      setBreadcrumbs: assign(({ event }) => ({
        breadcrumbs: typeOf('TRAIL_UPDATE', event).crumbs,
        contextMenuItems: typeOf('TRAIL_UPDATE', event).menuItems,
      })),

      setActiveSurface: enqueueActions(({ context, event, enqueue, system }) => {
        const selection = typeOf(['SELECT_SURFACE', 'SELECT_SURFACE_BY_SHELL'], event);
        const { surface } = selection;
        const historyIndex = 'historyIndex' in selection ? selection.historyIndex : undefined;
        const newSurface = currentSurface(context, surface);
        if (!newSurface) return;
        // Opening a surface settles which one this window shows
        if (context.pendingSurfaceId) enqueue.assign({ pendingSurfaceId: null });
        if (context.wantsDefaultSurface) enqueue.assign({ wantsDefaultSurface: false });

        // Un-expand the chat when navigating to a surface
        if (context.panelSizes.chatMaximized) {
          enqueue.assign(({ context }) => ({ panelSizes: saved(chatRestored(context.panelSizes)) }));
        }

        if (context.activeSurface.id !== newSurface.id) {
          notifySurfaceActor(system.get(context.activeSurface.id), context.activeSurface.id, { type: 'SURFACE_DEACTIVATED' });
          notifySurfaceActor(system.get(newSurface.id), newSurface.id, { type: 'SURFACE_ACTIVATED' });
        }

        enqueue.assign(({ context }) => ({
          activeSurface: newSurface,
          defaultToggles: { ...context.defaultToggles, canvas: false },
          // The same surface again leaves the history as it is
          ...(context.activeSurface.id === newSurface.id ? {} : historyAfter(context, surface, historyIndex)),
        }));

        // The host records the surface opened, so the next window and the next run open on it: a main window's only
        if (context.ownsLastActiveSurface && context.activeSurface.id !== newSurface.id) {
          enqueue(() => client.send({ to: HOST.application, event: { type: 'SET_LAST_ACTIVE_SURFACE', surface: newSurface.id } }));
        }
      }),
      toggleCanvas: assign(({ context }) => ({ defaultToggles: { canvas: !context.defaultToggles.canvas } })),
      trailActiveSurface: spawnChild('surfaceTrailer', { id: 'surfaceTrailer', input: ({ context }) => context.activeSurface.id }),
      trailNewSurface: enqueueActions(({ enqueue, context, event }) => {
        const surfaceId = event.type === 'DEFAULT_TOGGLE'
          ? (!context.defaultToggles.canvas ? (context.defaultSurface?.id ?? context.activeSurface.id) : context.activeSurface.id)
          : typeOf(['SELECT_SURFACE', 'SELECT_SURFACE_BY_SHELL'], event).surface;
        enqueue.sendTo('surfaceTrailer', { type: 'TRAIL_NEW_SURFACE', id: surfaceId });
        enqueue.assign(({ system }) => {
          const surfaceActor = system.get(surfaceId);
          return surfaceActor ? { targetView: computeCrumbs(surfaceActor.getSnapshot()).target ?? '' } : {};
        });
      }),
      spawnSurfaceActors: enqueueActions(({ enqueue, context }) => {
        for (const surface of context.surfaces) spawnSurfaceActor(enqueue, surface);
      }),

      resizePanel: assign(({ context, event }) => {
        const { panel, size } = typeOf('RESIZE_PANEL', event);
        return { panelSizes: saved(resized(context.panelSizes, panel, size)) };
      }),
      maximizeChat: assign(({ context }) => ({ panelSizes: saved(chatMaximized(context.panelSizes)) })),
      restoreChat: assign(({ context }) => ({ panelSizes: saved(chatRestored(context.panelSizes)) })),
      toggleInspectionPanel: assign(({ context }) => ({ panelSizes: saved(inspectionToggled(context.panelSizes)) })),

      closeDevLetter: ({ self }) => {
        const threads = packs.designation('threads');
        if (threads) {
          self.send({ type: 'SELECT_SURFACE', surface: threads });
        }
      },
    },
    guards: {
      areHotkeysEnabled: ({ context }) => !context.hotkeysDisabled,
      isMainWindow: ({ context }) => context.ownsLastActiveSurface,
    },
  }).createMachine({
    // `#application.*` targets name this id; the actor runs as HOST.application
    id: 'application',
    context: ({ input, spawn, self }) => {
      const surfaces = withHostLast(packs.getRegisteredSurfaces());
      // A popout opens on its surface (once its pack's frontend adds it); a main window on the
      // first, until the host says which was last open
      const initialSurface = surfaces.find((p) => p.id === input.initialSurfaceId);
      const claimedDefault = selectedDefaultSurface(surfaces) ?? null;
      const initialActiveSurface = initialSurface ?? claimedDefault ?? surfaces[0];
      return {
        surfaces,
        surfaceVisibility: {},
        commands: [],
        activeSurface: initialActiveSurface,
        defaultSurface: claimedDefault,
        // Nothing specific was asked for and no pack has claimed a default yet, so open it when one does
        wantsDefaultSurface: claimedDefault === null && input.initialSurfaceId === undefined,
        surfaceHistory: [initialActiveSurface.id],
        historyIndex: 0,
        breadcrumbs: [],
        contextMenuItems: [],
        defaultToggles: { canvas: false },
        targetView: '',
        panelSizes: initialPanelSizes(storage),
        hotkeysDisabled: false,
        // Empty until the backend sends them
        hotkeys: {},
        ownsLastActiveSurface: input.ownsLastActiveSurface ?? true,
        pendingSurfaceId: initialSurface ? null : input.initialSurfaceId ?? null,
        awaitingSurface: [],
        entityOpening: spawn('entityOpening', { id: ENTITY_OPENING_ID, input: { isConnected: () => self.getSnapshot().context.busSubscribed } }),
        busSubscribed: false,
        packLoadRunning: false,
        packLoadQueued: false,
        packFrontendsNeedRefresh: false,
        acceptedPackRuntimes: {},
        packsWithFrontend: [],
        packsUnloadedWhileLoading: [],
        loadedPacksRead: false,
      };
    },
    initial: 'running',
    entry: [
      'spawnSurfaceActors',
      ({ context, system }) => {
        notifySurfaceActor(system.get(context.activeSurface.id), context.activeSurface.id, { type: 'SURFACE_ACTIVATED' });
      },
      'trailActiveSurface',
      spawnChild('hotkeyListener', { id: 'hotkeyListener' }),
      spawnChild('mouseListener', { id: 'mouseListener' }),
      spawnChild('connectionListener', { id: 'connectionListener' }),
      spawnChild('surfaceCatalogListener', { id: 'surfaceCatalogListener' }),
    ],
    states: {
      'onboarding': {
        tags: ['onboarding'],
        // Maximized for the moment, so not saved
        entry: assign({ panelSizes: ({ context }) => ({ ...context.panelSizes, chatMaximized: true }) }),
        on: {
          ONBOARDING_COMPLETE: {
            actions: 'restoreChat',
            target: '#application.running.connected',
          },
        },
        initial: 'letter',
        states: {
          'letter': {
            tags: ['welcome'],
            on: {
              CLOSE_DEV_LETTER: {
                actions: 'closeDevLetter',
                target: 'wizard',
              },
            },
          },
          'wizard': {},
        },
      },
      'running': {
        tags: ['running'],
        initial: 'connecting',
        on: {
          RESTORE_CHAT: { actions: 'restoreChat' },
        },
        states: {
          'connecting': {
            tags: ['connecting'],
            after: {
              30000: {
                target: '#application.error',
                actions: () => {
                  client.describeConnection().then((details) => notify.errorPage('Unable to connect', details));
                },
              },
            },
            on: {
              CLIENT_CONNECTED: [
                {
                  target: '#application.onboarding.letter',
                  guard: ({ event }) => typeOf('CLIENT_CONNECTED', event).hasOnboarded === false,
                  actions: 'applyShellState',
                },
                { target: 'connected', actions: 'applyShellState' },
              ],
            },
          },
          'connected': {
            on: {
              // The backend reconnected (after a crash and restart, say)
              CLIENT_CONNECTED: {
                target: 'connected',
                reenter: true,
                actions: 'applyShellState',
              },
            },
          },
        },
      },
      'error': {},
    },
    on: {
      SURFACE_DECLARATIONS_CHANGED: { actions: ['refreshSurfaceDeclarations', 'updateEntityDestination'] },
      APPLICATION_HOTKEYS: { actions: 'updateHotkeys' },
      // In every state: onboarding and the error page keep pack systems' startup data flowing too. The loader runs on
      // every establishment of the subscription, so packs a failed read left unloaded are picked up by the next one.
      BUS_SUBSCRIBED: { actions: [assign({ busSubscribed: true }), 'announceLoadedPacks', 'loadPackFrontends'] },
      BUS_CONNECTION_LOST: { actions: 'disconnectPackFrontends' },
      LOAD_PACK_FRONTENDS: { actions: 'loadPackFrontends' },
      PACK_FRONTENDS_SETTLED: { actions: 'finishPackFrontendLoad' },
      PACK_FRONTEND_LOADED: { actions: 'mergePackSurfaces' },
      PACK_RUNTIMES_UPDATED: {
        actions: enqueueActions(({ context, event, enqueue }) => {
          const { runtimes } = typeOf('PACK_RUNTIMES_UPDATED', event);
          const accepted = context.acceptedPackRuntimes;
          enqueue.sendTo(context.entityOpening, { type: 'RUNTIMES_UPDATED', runtimes });
          if (Object.keys(accepted).length !== Object.keys(runtimes).length
            || Object.entries(runtimes).some(([id, revision]) => accepted[id] !== revision)) {
            enqueue.raise({ type: 'LOAD_PACK_FRONTENDS' });
          }
        }),
      },
      PACK_SURFACES_UNLOADED: { actions: 'removePackSurfaces' },
      SURFACE_VISIBILITY_UPDATED: { actions: 'updateSurfaceVisibility' },
      COMMANDS_UPDATED: { actions: 'updateCommands' },
      SET_SURFACE_VISIBILITY: { actions: 'setSurfaceVisibility' },
      OPEN_ENTITY: { actions: 'beginEntityOpen' },
      ENTITY_OPEN_FINISHED: { actions: assign(({ context, event }) => ({ awaitingSurface: context.awaitingSurface.filter(request => request.entityToken !== event.token) })) },
      OPEN_SURFACE: { actions: 'selectAndDeliver' },
      SEND_TO_SURFACE: { actions: 'deliverWithoutSelecting' },
      // A backend's request: a main window opens the surface, a popout keeps the one it shows
      OPEN_SURFACE_FROM_APP: { guard: 'isMainWindow', actions: 'checkBackendOpenRequest' },
      DELIVER_SURFACE_EVENTS: { actions: 'deliverSurfaceEvents' },
      TRAIL_UPDATE: { actions: ['setBreadcrumbs', 'setTargetView'] },
      TRAIL_CLICK: { actions: ['cancelEntityOpen', 'setTargetView', 'sendRouteClick'] },
      DEFAULT_TOGGLE: { actions: ['trailNewSurface', 'toggleCanvas'] },
      SELECT_SURFACE: { actions: ['cancelEntityOpen', 'supersedeWaitingOpens', 'setActiveSurface', 'trailNewSurface'] },
      SELECT_SURFACE_BY_SHELL: { actions: ['setActiveSurface', 'trailNewSurface'] },
      RESIZE_PANEL: { actions: 'resizePanel' },
      TOGGLE_INSPECTION_PANEL: { actions: 'toggleInspectionPanel' },
      MAXIMIZE_CHAT: { actions: 'maximizeChat' },
      RESTORE_CHAT: { actions: 'restoreChat' },
      SWITCH_SURFACE_UP: { actions: 'switchSurfaceByDirection' },
      SWITCH_SURFACE_DOWN: { actions: 'switchSurfaceByDirection' },
      NAVIGATE_BACK: { actions: ['cancelEntityOpen', 'forwardNavToSurface'] },
      NAVIGATE_FORWARD: { actions: ['cancelEntityOpen', 'forwardNavToSurface'] },
      FORWARD_HOTKEY: { actions: 'forwardHotkeyToSurface' },
      PROCESS_GLOBAL_HOTKEY: { guard: 'areHotkeysEnabled', actions: 'processGlobalHotkey' },
      HOTKEYS_RECORDING_START: { actions: { type: 'setHotkeysDisabled', params: true } },
      HOTKEYS_RECORDING_END: { actions: { type: 'setHotkeysDisabled', params: false } },
      BACKEND_ERROR: {
        target: '.error',
        actions: ({ event }) => notify.errorPage('Something went wrong', typeOf('BACKEND_ERROR', event).error),
      },
      SYSTEM_ERROR: {
        actions: ({ event }) => {
          const ev = typeOf('SYSTEM_ERROR', event);
          // A diagnostic is for whoever is building the app or a pack, and it is already in the Logs surface.
          // Interrupting the person using the app with it tells them nothing they can act on.
          if (ev.severity === 'diagnostic') return;
          if (ev.severity === 'fatal') {
            notify.errorPage(ev.title ?? 'Something went wrong', { message: ev.message, stack: ev.stack });
            return;
          }
          notify.error(ev.title ?? 'Something went wrong', ev.message);
        },
      },
      NOOP: {},
    },
  });
}

/** The shell's machine */
export type ShellMachine = ReturnType<typeof createShellMachine>;
