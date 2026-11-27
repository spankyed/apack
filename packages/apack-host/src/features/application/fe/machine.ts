// The app shell: the host `application` feature's frontend state, running on one per-window `@apackdev/state`
// `System` alongside every host and pack surface. Its I/O arrives as options (types.ts); the renderer composes it
// with the API client and the window, a pack's tests with fakes.
import {
  given,
  system,
  windowFrame,
  type Asks,
  type Clock,
  type Defect,
  type Handle,
  type State,
  type System,
  type Value,
  type ViewHost,
} from '@apackdev/state';
import {
  hostClock,
  isState,
  processHotkeys,
  type HostShell,
  type HostShellEvent,
  type HostShellSnapshot,
  type HostShellState,
  type HostShellSurfaceRef,
  type HostShellSurfaceSnapshot,
  type ShellPanelSizes,
  type Surface,
  type SurfaceChrome,
  type SurfaceEvent,
} from '@apackdev/sdk/fe';
import { splitRef } from '@apackdev/sdk/ids';
import { _askOverClient, _CALL_KEY, newCall, senderSuffix, type Message } from '@apackdev/sdk/events';
import { reportError } from '@apackdev/sdk/logger';
import { _isFeHostBound } from '@apackdev/sdk/runtime';
import { isPlainObject } from '@apackdev/sdk/utils/pure';
import {
  selectDefaultSurfaceDeclaration,
  getEligibleSurface,
  selectSurfaceDeclaration,
} from '../../../fe/surface-selection.ts';
import { surfaceNavigationItems } from '../../../fe/surface-navigation.ts';
import { notifySurfaceActor, sendToSurfaceActor } from '../../../fe/surface-delivery.ts';
import { HOST } from '../../../refs.ts';
import { hostState } from '../../../state.ts';
import {
  checkEntityOpening,
  createEntityOpeningState,
  type EntityOpeningShape,
  type EntityOpeningState,
} from './entity-opening.ts';
import { subscribeConnection } from './connection.ts';
import { listenHotkeys, listenMouse } from './input.ts';
import {
  chatMaximized,
  chatRestored,
  initialPanelSizes,
  inspectionToggled,
  resized,
} from './layout.ts';
import {
  announcePackClientReady,
  createPackFrontendLoaderState,
  type PackFrontendLoaderState,
} from './pack-frontends.ts';
import { historyAfter, neighbourOf, withHostLast } from './surfaces.ts';
import { createSurfaceTrailer, type TrailSurfaceState } from './trail.ts';
import type {
  ShellContext,
  ShellEvent,
  ShellOptions,
  ShellParams,
  SurfaceRequest,
} from './types.ts';

/** The title of the page that says the backend has not answered, which is the page a connection takes down */
const UNREACHABLE = 'Unable to connect';

const ROLE_PEERS = ['role:brain', 'role:code'] as const;

export type ShellShape = {
  data: ShellContext;
  starts: {
    entityOpening: EntityOpeningState;
    packLoader: PackFrontendLoaderState;
  };
  states: {
    onboarding: {
      states: {
        letter: {};
        wizard: {};
      };
    };
    running: {
      states: {
        connecting: {};
        unreachable: {};
        connected: {};
      };
    };
    error: {};
  };
};

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
function packFrontendsPending(context: Pick<ShellContext, 'loadedPacksRead' | 'packLoadRunning' | 'packLoadQueued'>): boolean {
  return !context.loadedPacksRead || context.packLoadRunning || context.packLoadQueued;
}

/**
 * What the user is told when a surface isn't here: the title and the detail, for `notify.error`.
 *
 * Opening and sending can each be refused at once or after waiting for pack frontends, and one function writes
 * every one of those so the wording can't differ by which branch the app happened to take.
 */
function refusal({ surface, select, sender }: SurfaceRequest, detail?: string): [string, string] {
  const suffix = senderSuffix(sender);
  return [`Couldn't ${select ? 'open' : 'reach'} ${surface}`, `${detail ?? `No surface is declared at "${surface}".`}${suffix && ` Sent${suffix}.`}`];
}

const wallClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function resolveWindowClock(override?: Clock): Clock {
  if (override) return override;
  if (_isFeHostBound()) {
    const feClock = hostClock();
    if (feClock) return feClock;
  }
  return wallClock;
}

function hasTagFor(at: string, tag: string): boolean {
  switch (tag) {
    case 'onboarding': return at === 'onboarding' || at.startsWith('onboarding.');
    case 'welcome': return at === 'onboarding.letter';
    case 'running': return at === 'running' || at.startsWith('running.');
    case 'connecting': return at === 'running.connecting';
    default: return false;
  }
}

function matchesAt(at: string, statePath: string): boolean {
  return at === statePath || at.startsWith(`${statePath}.`);
}

function stripCallKey(event: SurfaceEvent): SurfaceEvent {
  if (!(_CALL_KEY in event)) return event;
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== _CALL_KEY)) as SurfaceEvent;
}

export interface ShellSnapshot extends HostShellSnapshot {
  readonly status: 'active' | 'stopped';
  readonly at: string;
  readonly value: string;
  readonly context: ShellContext;
  hasTag(tag: string): boolean;
  matches(state: string): boolean;
}

export type ShellObserver =
  | ((snapshot: ShellSnapshot) => void)
  | { next?: (snapshot: ShellSnapshot) => void; error?: (error: unknown) => void };

export interface ShellRuntime extends HostShell {
  /** The per-window `@apackdev/state` frontend system running `host/application` and every active surface. */
  readonly system: System;
  /** Starts the shell state, initial surfaces, and window/connection/catalog listeners. Returns `this`. */
  start(): this;
  /** Stops the shell, all running surfaces, and all listeners cleanly. Idempotent. */
  stop(): void;
  /** Sends an event to the `host/application` shell state and drains queued surface/side effects synchronously. */
  send(event: ShellEvent): void;
  /** Reads the current shell snapshot. */
  getSnapshot(): ShellSnapshot;
  /** Subscribes to shell and surface lifecycle changes. */
  subscribe(observer: ShellObserver): { unsubscribe(): void };
  /** Returns a running surface handle by ref, if active. */
  surface(ref: string): HostShellSurfaceRef | undefined;
  /** Reads the entity-opening child state (for diagnostics and tests). */
  entityOpening(): Value<EntityOpeningShape> | undefined;
  /** Observes events delivered to the shell and its running surfaces (for diagnostics, E2E and drive). */
  onEvent(listener: (record: { to: string; event: SurfaceEvent }) => void): { unsubscribe(): void };
}

interface ShellRuntimeBridge {
  isConnected(): boolean;
  hasSurface(ref: string): boolean;
  enqueueEffect(fn: () => void): void;
  startSurface(surface: Surface, ownsAppLayout: boolean): void;
  stopSurface(ref: string): void;
  deliverSurface(
    ref: string,
    event: SurfaceEvent,
    asker?: SurfaceRequest['sender']['asker'],
    call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>,
  ): void;
  followSurface(ref: string): void;
  readSurfaceTarget(ref: string): string | undefined;
  sendShellAsync(event: ShellEvent): void;
  drainEffects(): void;
}

/**
 * The host `application` frontend `@apackdev/state` definition.
 * Exported directly so `apack-state-graph` can analyze the shell state graph and `HostSurfaces` can type it.
 */
export function createShellState(options: ShellOptions, runtime: ShellRuntimeBridge) {
  const { packs, catalog, client, packFrontends, storage, notify, target } = options;

  const entityOptions = {
    client,
    catalog,
    bindings: () => packs.surfaceBindings(),
    isConnected: () => runtime.isConnected(),
    hasSurface: (ref: string) => runtime.hasSurface(ref),
    deliverEntity: (surfaceRef: string, event: { type: 'OPEN_ENTITY'; id: import('@apackdev/sdk').EARS.EntityId }) => {
      runtime.enqueueEffect(() => runtime.deliverSurface(surfaceRef, event));
    },
    refuse: (title: string, detail: string) => {
      runtime.enqueueEffect(() => notify.error(title, detail));
    },
  };

  const entityOpeningState = createEntityOpeningState(entityOptions);
  const packLoaderState = createPackFrontendLoaderState(client, packFrontends);

  const selectedDefaultSurface = (surfaces: readonly Surface[]) => {
    const declaration = selectDefaultSurfaceDeclaration(catalog);
    const accepted = declaration ? getEligibleSurface(catalog, packs.surfaceBindings(), declaration.featureRef) : undefined;
    return accepted && surfaces.includes(accepted) ? accepted : undefined;
  };

  const currentSurface = (surfaces: readonly Surface[], ref: string) => {
    const accepted = getEligibleSurface(catalog, packs.surfaceBindings(), ref);
    return accepted && surfaces.includes(accepted) ? accepted : undefined;
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

  const refuse = (
    request: SurfaceRequest,
    tellEntityOpening: (event: { type: 'REFUSED'; token: string; detail: string }) => void,
    detail?: string,
  ): void => {
    if (request.entityToken) {
      tellEntityOpening({
        type: 'REFUSED',
        token: request.entityToken,
        detail: detail ?? unavailable(request.surface) ?? `The surface "${request.surface}" could not be loaded.`,
      });
      return;
    }
    runtime.enqueueEffect(() => {
      if (!request.answering) {
        notify.error(...refusal(
          request,
          detail ?? unavailable(request.surface)
            ?? (selectSurfaceDeclaration(catalog, request.surface) ? `The surface "${request.surface}" could not be loaded.` : undefined),
        ));
        return;
      }
      const suffix = senderSuffix(request.sender);
      console.warn(`[shell] Dropped an answer for "${request.surface}": no surface is registered there${suffix && `, answering${suffix}`}`);
    });
  };

  const supersedeWaitingOpens = (
    awaitingSurface: readonly (SurfaceRequest & { events: SurfaceEvent[] })[],
  ): Array<SurfaceRequest & { events: SurfaceEvent[] }> => awaitingSurface
    .filter((request) => !request.select || request.entityToken || request.events.length > 0)
    .map((request) => (request.select && !request.entityToken ? { ...request, select: false } : request));

  const applyShellState = (
    event: Extract<ShellEvent, { type: 'CLIENT_CONNECTED' }>,
    data: { readonly ownsLastActiveSurface: boolean; readonly activeSurface: Surface; readonly surfaces: readonly Surface[] },
    send: (ev: ShellEvent) => void,
  ): Partial<ShellContext> => {
    const { surfaceVisibility, lastActiveSurface } = event;
    const patch: Partial<ShellContext> = { surfaceVisibility };
    if (data.ownsLastActiveSurface && lastActiveSurface) patch.wantsDefaultSurface = false;
    if (!data.ownsLastActiveSurface || !lastActiveSurface || lastActiveSurface === data.activeSurface.id) return patch;
    if (data.surfaces.some((p) => p.id === lastActiveSurface)) {
      send({ type: 'SELECT_SURFACE_BY_SHELL', surface: lastActiveSurface });
    } else {
      patch.pendingSurfaceId = lastActiveSurface;
    }
    return patch;
  };

  const selectSurface = (
    surfaceId: string,
    historyIndex: number | undefined,
    data: ShellContext,
    cancelEntity: boolean,
    tellEntityOpening: (event: { type: 'CANCEL' }) => void,
  ): Partial<ShellContext> | undefined => {
    const patch: Partial<ShellContext> = {};
    if (cancelEntity) {
      tellEntityOpening({ type: 'CANCEL' });
      patch.awaitingSurface = supersedeWaitingOpens(data.awaitingSurface);
    }

    const newSurface = currentSurface(data.surfaces, surfaceId);
    if (newSurface) {
      if (data.pendingSurfaceId) patch.pendingSurfaceId = null;
      if (data.wantsDefaultSurface) patch.wantsDefaultSurface = false;

      if (data.panelSizes.chatMaximized) {
        patch.panelSizes = saved(chatRestored(data.panelSizes));
      }

      if (data.activeSurface.id !== newSurface.id) {
        const previousId = data.activeSurface.id;
        runtime.enqueueEffect(() => {
          runtime.deliverSurface(previousId, { type: 'SURFACE_DEACTIVATED' });
          runtime.deliverSurface(newSurface.id, { type: 'SURFACE_ACTIVATED' });
        });
      }

      patch.activeSurface = newSurface;
      patch.defaultToggles = { ...data.defaultToggles, canvas: false };
      if (data.activeSurface.id !== newSurface.id) {
        Object.assign(patch, historyAfter(data, surfaceId, historyIndex));
      }

      if (data.ownsLastActiveSurface && data.activeSurface.id !== newSurface.id) {
        runtime.enqueueEffect(() => {
          client.send({ to: HOST.application, event: { type: 'SET_LAST_ACTIVE_SURFACE', surface: newSurface.id } });
        });
      }
    }

    runtime.enqueueEffect(() => runtime.followSurface(surfaceId));
    const targetView = runtime.readSurfaceTarget(surfaceId);
    if (targetView !== undefined) patch.targetView = targetView;

    return Object.keys(patch).length > 0 ? patch : undefined;
  };

  return hostState<ShellShape, ShellEvent>()({
    initial: 'running',
    data: {
      surfaces: given,
      surfaceVisibility: {},
      commands: [],
      activeSurface: given,
      defaultSurface: given,
      wantsDefaultSurface: given,
      surfaceHistory: given,
      historyIndex: 0,
      breadcrumbs: [],
      contextMenuItems: [],
      defaultToggles: { canvas: false },
      targetView: '',
      panelSizes: given,
      hotkeysDisabled: false,
      hotkeys: {},
      ownsLastActiveSurface: given,
      pendingSurfaceId: given,
      awaitingSurface: [],
      busSubscribed: false,
      packLoadRunning: false,
      packLoadQueued: false,
      packFrontendsNeedRefresh: false,
      acceptedPackRuntimes: {},
      packsWithFrontend: [],
      packsUnloadedWhileLoading: [],
      loadedPacksRead: false,
    },
    starts: () => ({
      entityOpening: entityOpeningState,
      packLoader: packLoaderState,
    }),
    listen: ({ send }) => {
      const dispatch = (event: ShellEvent) => {
        send(event);
        runtime.drainEffects();
      };
      const stopCatalog = catalog.subscribe(() => dispatch({ type: 'SURFACE_DECLARATIONS_CHANGED' }));
      const stopHotkeys = listenHotkeys(target, dispatch);
      const stopMouse = listenMouse(target, dispatch);
      return () => {
        stopMouse();
        stopHotkeys();
        stopCatalog();
      };
    },
    states: {
      onboarding: {
        initial: 'letter',
        on: {
          ONBOARDING_COMPLETE: (_event, { data }) => ({
            at: 'running.connected',
            data: { panelSizes: saved(chatRestored(data.panelSizes)) },
          }),
        },
        states: {
          letter: {
            on: {
              CLOSE_DEV_LETTER: (_event, { send }) => {
                const threads = packs.designation('threads');
                if (threads) send({ type: 'SELECT_SURFACE', surface: threads });
                return { at: 'onboarding.wizard' };
              },
            },
          },
          wizard: {},
        },
      },
      running: {
        initial: 'connecting',
        states: {
          connecting: {
            // Half a minute without a connection is when the user is told, and never when the shell stops waiting
            // for one: a clock says how long it has been, and cannot say that the backend will not answer.
            run: async ({ sleep }) => {
              await sleep(30_000);
              return { at: 'running.unreachable' };
            },
            failed: () => {},
            on: {
              CLIENT_CONNECTED: (event, { data, send }) => {
                const applied = applyShellState(event, data, send);
                if (event.hasOnboarded === false) {
                  return {
                    at: 'onboarding.letter',
                    data: {
                      ...applied,
                      // Maximized for the moment, so not saved
                      panelSizes: { ...data.panelSizes, chatMaximized: true },
                    },
                  };
                }
                return { at: 'running.connected', data: applied };
              },
            },
          },
          // Still waiting, with the user told. A connection that arrives now takes the page down and carries on:
          // a backend slow to start on a busy machine, or on a first boot, is not one that failed.
          unreachable: {
            run: async ({ signal, onExit }) => {
              onExit(() => notify.clearErrorPage(UNREACHABLE));
              const details = await client.describeConnection();
              // Said only while it is still true: the connection may have arrived while this was being read
              if (!signal.aborted) notify.errorPage(UNREACHABLE, details);
            },
            failed: () => {},
            on: {
              CLIENT_CONNECTED: (event, { data, send }) => {
                const applied = applyShellState(event, data, send);
                if (event.hasOnboarded === false) {
                  return {
                    at: 'onboarding.letter',
                    data: {
                      ...applied,
                      panelSizes: { ...data.panelSizes, chatMaximized: true },
                    },
                  };
                }
                return { at: 'running.connected', data: applied };
              },
            },
          },
          connected: {
            on: {
              // The backend reconnected (after a crash and restart, say)
              CLIENT_CONNECTED: (event, { data, send }) => ({
                at: 'running.connected',
                data: applyShellState(event, data, send),
              }),
            },
          },
        },
      },
      // The backend failed for good and said so: nothing but a reload brings the window back from here
      error: {},
    },
    on: {
      SURFACE_DECLARATIONS_CHANGED: (_event, { data, send, tell, child }) => {
        const claimed = selectedDefaultSurface(data.surfaces) ?? null;
        const patch: Partial<ShellContext> = { defaultSurface: claimed };
        if (data.wantsDefaultSurface && !data.pendingSurfaceId && claimed) {
          send({ type: 'SELECT_SURFACE_BY_SHELL', surface: claimed.id });
        }
        // A frontend may be admitted before its declaration frame reaches this window. Reconcile
        // from accepted bindings when that frame arrives, without keeping a second pending inventory.
        const bindings = packs.surfaceBindings();
        const changedOwners = new Set([...bindings]
          .filter(([ref, accepted]) => accepted.registrationId
            && getEligibleSurface(catalog, bindings, ref) && !data.surfaces.includes(accepted.binding))
          .map(([, accepted]) => accepted.packId));
        const pending = new Set<string>();
        for (const packId of changedOwners) {
          const accepted = [...bindings.values()].filter((binding) => binding.packId === packId);
          if (!accepted.every((binding) => getEligibleSurface(catalog, bindings, binding.binding.id))) continue;
          pending.add(packId);
          send({
            type: 'PACK_FRONTEND_LOADED',
            packId,
            registrationId: accepted[0]!.registrationId!,
            surfaces: accepted.map((binding) => binding.binding),
          });
        }
        const waiting: Array<SurfaceRequest & { events: SurfaceEvent[] }> = [];
        for (const request of data.awaitingSurface) {
          if (currentSurface(data.surfaces, request.surface)) {
            send(request.select
              ? { type: 'OPEN_SURFACE', surface: request.surface, events: request.events, entityToken: request.entityToken }
              : { type: 'SEND_TO_SURFACE', surface: request.surface, events: request.events, ...request.sender, answering: request.answering, call: request.call });
          } else if (
            unavailable(request.surface)
            || (catalog.status() === 'ready' && !packFrontendsPending(data) && !pending.has(splitRef(request.surface)?.packId ?? ''))
          ) {
            refuse(request, (ev) => tell(child('entityOpening'), ev));
          } else {
            waiting.push(request);
          }
        }
        patch.awaitingSurface = waiting;
        if (data.pendingSurfaceId) {
          if (unavailable(data.pendingSurfaceId)) patch.pendingSurfaceId = null;
          else if (currentSurface(data.surfaces, data.pendingSurfaceId)) {
            send({ type: 'SELECT_SURFACE_BY_SHELL', surface: data.pendingSurfaceId });
          }
        }
        tell(child('entityOpening'), { type: 'CHANGED' });
        return { data: patch };
      },

      APPLICATION_HOTKEYS: (event) => ({ data: { hotkeys: event.hotkeys } }),

      BUS_SUBSCRIBED: (_event, { data, tell, child }) => {
        if (!data.packFrontendsNeedRefresh) {
          for (const packId of data.packsWithFrontend) {
            const registrationId = data.acceptedPackRuntimes[packId]!;
            runtime.enqueueEffect(() => announcePackClientReady(client, packId, registrationId));
          }
        }
        if (data.packLoadRunning) {
          return { data: { busSubscribed: true, packLoadQueued: true } };
        }
        tell(child('packLoader'), {
          type: 'START',
          acceptedPackRuntimes: data.acceptedPackRuntimes,
          refresh: data.packFrontendsNeedRefresh,
        });
        return { data: { busSubscribed: true, packLoadRunning: true, packLoadQueued: false } };
      },

      BUS_CONNECTION_LOST: (_event, { tell, child }) => {
        tell(child('entityOpening'), { type: 'CANCEL' });
        // Stop the attempt, not the accepted frontend. The next authoritative read determines removals.
        tell(child('packLoader'), { type: 'STOP' });
        return {
          data: {
            busSubscribed: false,
            packLoadRunning: false,
            packLoadQueued: false,
            packFrontendsNeedRefresh: true,
            packsUnloadedWhileLoading: [],
          },
        };
      },

      LOAD_PACK_FRONTENDS: (_event, { data, tell, child }) => {
        if (!data.busSubscribed) return;
        if (data.packLoadRunning) {
          return { data: { packLoadQueued: true } };
        }
        tell(child('packLoader'), {
          type: 'START',
          acceptedPackRuntimes: data.acceptedPackRuntimes,
          refresh: data.packFrontendsNeedRefresh,
        });
        return { data: { packLoadRunning: true, packLoadQueued: false } };
      },

      PACK_FRONTENDS_SETTLED: (event, { data, send, tell, child }) => {
        const { loadedPacksError, failedPacks } = event;
        const refresh = data.packFrontendsNeedRefresh && (!!loadedPacksError || !!failedPacks?.length);
        const patch: Partial<ShellContext> = { packFrontendsNeedRefresh: refresh };

        // A refused replacement unloads the frontend it would have replaced: that one no longer matches what this
        // connection runs, its systems were never told it is ready, and its settings binding ended with the
        // previous connection. The next run loads the pack afresh.
        const refusedIncumbents = (failedPacks ?? []).map((failed) => failed.packId).filter((id) => id in data.acceptedPackRuntimes);
        const acceptedPackRuntimes = Object.fromEntries(
          Object.entries(data.acceptedPackRuntimes).filter(([id]) => !refusedIncumbents.includes(id)),
        );
        for (const packId of refusedIncumbents) {
          send({ type: 'PACK_SURFACES_UNLOADED', packId, refused: true });
        }

        // Every result of the run that finished has arrived, so nothing is left to drop
        if (data.packsUnloadedWhileLoading.length > 0) patch.packsUnloadedWhileLoading = [];

        if (data.packLoadQueued) {
          patch.packLoadQueued = false;
          tell(child('packLoader'), { type: 'START', acceptedPackRuntimes, refresh });
        } else {
          patch.packLoadRunning = false;
          tell(child('packLoader'), { type: 'STOP' });
          // Loading has settled: a surface still asked for is one no loaded pack provides
          if (data.awaitingSurface.length > 0 && catalog.status() !== 'loading') {
            const refused = data.awaitingSurface;
            patch.awaitingSurface = [];
            for (const request of refused) refuse(request, (ev) => tell(child('entityOpening'), ev));
          }
        }

        if (loadedPacksError) {
          const firstRead = !data.loadedPacksRead;
          runtime.enqueueEffect(() => {
            console.warn('[shell] Failed to read the loaded packs:', loadedPacksError);
            if (firstRead) notify.error("Add-on packs couldn't be loaded", loadedPacksError);
          });
        } else if (!data.loadedPacksRead) {
          patch.loadedPacksRead = true;
        }

        if (failedPacks?.length) {
          const names = failedPacks.map((p) => p.packId).join(', ');
          const reason = (p: { packId: string; error: string }) =>
            refusedIncumbents.includes(p.packId) ? `${p.error} Its previous frontend was unloaded.` : p.error;
          const details = failedPacks.map((p) => `${p.packId}: ${reason(p)}`).join('\n');
          runtime.enqueueEffect(() => {
            console.warn(`[shell] Failed to load the frontend of ${names}:\n${details}`);
            notify.error(`Couldn't load ${names}`, failedPacks.map(reason).join('\n'));
          });
        }

        return { data: patch };
      },

      PACK_FRONTEND_LOADED: (event, { data, send }) => {
        const { packId, registrationId, surfaces: packSurfaces } = event;

        // The pack was unloaded while its frontend was loading: keep its surfaces out, since nothing would ever take
        // them out again, and undo what the load registered
        if (data.packsUnloadedWhileLoading.includes(packId)) {
          runtime.enqueueEffect(() => packFrontends.unload(packId));
          return {
            data: {
              packsUnloadedWhileLoading: data.packsUnloadedWhileLoading.filter((id) => id !== packId),
            },
          };
        }

        // A newer acceptance already replaced this one: the event is stale, and its successor merges instead
        if (packSurfaces?.some((surface) => {
          const accepted = packs.surfaceBindings().get(surface.id);
          return accepted?.registrationId !== undefined && accepted.registrationId !== registrationId;
        })) return;

        if (packSurfaces?.some((surface) => getEligibleSurface(catalog, packs.surfaceBindings(), surface.id) !== surface)) {
          // The catalog explicitly disabled the pack while its frontend loaded: take the committed frontend back
          // out, since nothing else would. When the declaration hasn't arrived in the catalog yet (newly installed)
          // or the catalog is still settling, leave the binding in place until the catalog catches up.
          const withdrawn = catalog.status() === 'ready'
            && packSurfaces.some((surface) => {
              const decl = selectSurfaceDeclaration(catalog, surface.id);
              return decl !== undefined && decl.enabled !== true;
            });
          if (withdrawn) send({ type: 'PACK_SURFACES_UNLOADED', packId, refused: true });
          return;
        }

        const acceptedPackRuntimes = { ...data.acceptedPackRuntimes, [packId]: registrationId };

        // Only an accepted load reaches this point. Replace this owner's surfaces together;
        // failed candidates never retire the incumbent or disturb its selection.
        const previous = data.surfaces.filter((surface) => surface.id.startsWith(`${packId}/`));
        const retained = data.surfaces.filter((surface) => !surface.id.startsWith(`${packId}/`));
        const newSurfaces = packSurfaces ?? [];
        const firstPrevious = data.surfaces.findIndex((surface) => surface.id.startsWith(`${packId}/`));
        const position = firstPrevious < 0 ? retained.length : firstPrevious;
        const surfaces = withHostLast([...retained.slice(0, position), ...newSurfaces, ...retained.slice(position)]);
        const defaultSurface = selectedDefaultSurface(surfaces) ?? null;
        const replacingActive = previous.some((surface) => surface.id === data.activeSurface.id);
        const activeSurface = replacingActive
          ? (newSurfaces.find((surface) => surface.id === data.activeSurface.id) ?? surfaces[0])
          : data.activeSurface;

        for (const surface of previous) {
          runtime.enqueueEffect(() => runtime.stopSurface(surface.id));
        }

        const packsWithFrontend = packSurfaces === null
          ? data.packsWithFrontend.filter((id) => id !== packId)
          : data.packsWithFrontend.includes(packId) ? [...data.packsWithFrontend] : [...data.packsWithFrontend, packId];

        const patch: Partial<ShellContext> = {
          surfaces,
          acceptedPackRuntimes,
          packsWithFrontend,
          defaultSurface,
          ...(activeSurface ? { activeSurface } : {}),
        };

        if (newSurfaces.length > 0) {
          const ownsAppLayout = data.ownsLastActiveSurface;
          for (const surface of newSurfaces) {
            runtime.enqueueEffect(() => runtime.startSurface(surface, ownsAppLayout));
          }
          const added = new Set<string>(newSurfaces.map((p) => p.id));
          const claimed = selectedDefaultSurface(surfaces);
          if (claimed && added.has(claimed.id)) {
            patch.defaultSurface = claimed;
            patch.wantsDefaultSurface = false;
            if (data.wantsDefaultSurface && !data.pendingSurfaceId) {
              send({ type: 'SELECT_SURFACE_BY_SHELL', surface: claimed.id });
            }
          }
          const pending = data.pendingSurfaceId;
          if (pending && added.has(pending)) send({ type: 'SELECT_SURFACE_BY_SHELL', surface: pending });

          // Surfaces asked to open while their pack loaded open now, with their events
          const arrived = data.awaitingSurface.filter((work) => added.has(work.surface));
          if (arrived.length > 0) {
            patch.awaitingSurface = data.awaitingSurface.filter((work) => !added.has(work.surface));
            for (const { surface, events, select, sender, answering, call, entityToken } of arrived) {
              send(select
                ? { type: 'OPEN_SURFACE', surface, events, entityToken }
                : { type: 'SEND_TO_SURFACE', surface, events, ...sender, answering, call });
            }
          }
        }

        if (replacingActive && activeSurface) {
          const activeId = activeSurface.id;
          runtime.enqueueEffect(() => {
            if (runtime.hasSurface(activeId)) runtime.deliverSurface(activeId, { type: 'SURFACE_ACTIVATED' });
          });
        }
        if (packSurfaces !== null && data.busSubscribed) {
          runtime.enqueueEffect(() => announcePackClientReady(client, packId, registrationId));
        }

        return { data: patch };
      },

      PACK_RUNTIMES_UPDATED: (event, { data, send, tell, child }) => {
        const { runtimes } = event;
        const accepted = data.acceptedPackRuntimes;
        tell(child('entityOpening'), { type: 'RUNTIMES_UPDATED', runtimes });
        if (data.packFrontendsNeedRefresh
          || Object.keys(accepted).length !== Object.keys(runtimes).length
          || Object.entries(runtimes).some(([id, revision]) => accepted[id] !== revision)) {
          send({ type: 'LOAD_PACK_FRONTENDS' });
        }
      },

      PACK_SURFACES_UNLOADED: (event, { data, tell, child }) => {
        const { packId, refused } = event;
        tell(child('entityOpening'), { type: 'UNLOADED', packId });
        const surfaceIds = data.surfaces.filter((p) => p.id.startsWith(`${packId}/`)).map((p) => p.id);

        for (const id of surfaceIds) {
          runtime.enqueueEffect(() => runtime.stopSurface(id));
        }
        runtime.enqueueEffect(() => packFrontends.unload(packId));

        const patch: Partial<ShellContext> = {
          acceptedPackRuntimes: Object.fromEntries(Object.entries(data.acceptedPackRuntimes).filter(([id]) => id !== packId)),
        };
        if (data.packsWithFrontend.includes(packId)) {
          patch.packsWithFrontend = data.packsWithFrontend.filter((id) => id !== packId);
        }
        if (!refused && data.packLoadRunning && !data.packsUnloadedWhileLoading.includes(packId)) {
          patch.packsUnloadedWhileLoading = [...data.packsUnloadedWhileLoading, packId];
        }
        if (data.awaitingSurface.some((work) => splitRef(work.surface)?.packId === packId)) {
          patch.awaitingSurface = data.awaitingSurface.filter((work) => splitRef(work.surface)?.packId !== packId);
        }

        if (surfaceIds.length === 0) return { data: patch };

        const removeSet = new Set(surfaceIds);
        const remaining = data.surfaces.filter((p) => !removeSet.has(p.id));
        const surfaceVisibility = { ...data.surfaceVisibility };
        for (const id of surfaceIds) delete surfaceVisibility[id];

        const needsNavigate = removeSet.has(data.activeSurface.id);
        const defaultSurface = selectedDefaultSurface(remaining) ?? null;
        const activeSurface = needsNavigate ? (remaining[0] ?? data.activeSurface) : data.activeSurface;

        patch.surfaces = remaining;
        patch.surfaceVisibility = surfaceVisibility;
        patch.activeSurface = activeSurface;
        patch.defaultSurface = defaultSurface;

        if (needsNavigate) {
          const activeId = activeSurface.id;
          runtime.enqueueEffect(() => {
            if (runtime.hasSurface(activeId)) runtime.deliverSurface(activeId, { type: 'SURFACE_ACTIVATED' });
          });
        }

        return { data: patch };
      },

      SURFACE_VISIBILITY_UPDATED: (event) => ({ data: { surfaceVisibility: event.surfaceVisibility } }),

      COMMANDS_UPDATED: (event) => ({ data: { commands: event.commands } }),

      SET_SURFACE_VISIBILITY: (event, { data }) => {
        const { surface, visible } = event;
        runtime.enqueueEffect(() => {
          client.send({ to: HOST.application, event: { type: 'SET_SURFACE_VISIBILITY', surface, visible } });
        });
        return { data: { surfaceVisibility: { ...data.surfaceVisibility, [surface]: visible } } };
      },

      OPEN_ENTITY: (event, { tell, child }) => {
        tell(child('entityOpening'), event);
        return { data: { wantsDefaultSurface: false, pendingSurfaceId: null } };
      },

      ENTITY_OPEN_FINISHED: (event, { data }) => ({
        data: { awaitingSurface: data.awaitingSurface.filter((request) => request.entityToken !== event.token) },
      }),

      OPEN_SURFACE: (event, { data, send, tell, read, child }) => {
        const { surface, events, entityToken } = event;
        if (!entityToken) tell(child('entityOpening'), { type: 'CANCEL' });
        const awaitingSurface = supersedeWaitingOpens(data.awaitingSurface);
        const request: SurfaceRequest & { events: SurfaceEvent[] } = {
          surface,
          events,
          entityToken,
          select: true,
          sender: {},
        };

        if (entityToken) {
          const opening = checkEntityOpening(read(child('entityOpening')), entityToken, entityOptions);
          if (!opening.current) return { data: { awaitingSurface } };
          if (opening.problem) {
            refuse(request, (ev) => tell(child('entityOpening'), ev), opening.problem);
            return { data: { awaitingSurface } };
          }
        }
        const reason = unavailable(surface);
        if (reason) {
          refuse(request, (ev) => tell(child('entityOpening'), ev), reason);
          return { data: { awaitingSurface } };
        }
        if (!currentSurface(data.surfaces, surface)) {
          if (catalog.status() === 'loading' || packFrontendsPending(data)) {
            return { data: { awaitingSurface: [...awaitingSurface, request] } };
          }
          refuse(request, (ev) => tell(child('entityOpening'), ev));
          return { data: { awaitingSurface } };
        }

        if (entityToken) tell(child('entityOpening'), { type: 'READY', token: entityToken });
        if (data.activeSurface.id !== surface) send({ type: 'SELECT_SURFACE_BY_SHELL', surface });
        if (data.defaultToggles.canvas) send({ type: 'DEFAULT_TOGGLE', area: 'canvas' });
        if (events.length > 0 || entityToken) {
          runtime.enqueueEffect(() => runtime.sendShellAsync({ type: 'DELIVER_SURFACE_EVENTS', surface, events, entityToken }));
        }
        return { data: { awaitingSurface } };
      },

      SEND_TO_SURFACE: (event, { data, tell, child }) => {
        const { surface, events, from, via, asker, answering, call, diagnostics } = event;
        const request: SurfaceRequest & { events: SurfaceEvent[] } = {
          surface,
          events,
          select: false,
          sender: { from, via, asker, diagnostics },
          answering,
          call,
        };
        const reason = unavailable(surface);
        if (reason) {
          refuse(request, (ev) => tell(child('entityOpening'), ev), reason);
          return;
        }
        if (!currentSurface(data.surfaces, surface)) {
          if (catalog.status() === 'loading' || packFrontendsPending(data)) {
            return { data: { awaitingSurface: [...data.awaitingSurface, request] } };
          }
          refuse(request, (ev) => tell(child('entityOpening'), ev));
          return;
        }
        if (events.length > 0) {
          runtime.enqueueEffect(() => runtime.sendShellAsync({
            type: 'DELIVER_SURFACE_EVENTS',
            surface,
            events,
            asker,
            answering,
            call,
            diagnostics,
          }));
        }
      },

      OPEN_SURFACE_FROM_APP: (event, { data, send }) => {
        if (!data.ownsLastActiveSurface) return;
        const { surface, events = [] } = event;
        const deliverable = Array.isArray(events) && events.every((e) => isPlainObject(e) && typeof e.type === 'string');
        if (typeof surface !== 'string' || !deliverable) {
          runtime.enqueueEffect(() => {
            notify.error("Couldn't open a surface", `A pack asked the app to open "${String(surface)}" with events it can't deliver`);
          });
          return;
        }
        send({ type: 'OPEN_SURFACE', surface, events: events as SurfaceEvent[] });
      },

      DELIVER_SURFACE_EVENTS: (event, { data, tell, child }) => {
        const { surface, events, asker, entityToken, answering, call, diagnostics } = event;
        if (entityToken) {
          tell(child('entityOpening'), { type: 'DELIVER', token: entityToken });
          return;
        }
        if (!currentSurface(data.surfaces, surface) || !runtime.hasSurface(surface)) {
          refuse(
            { surface, select: false, sender: { asker }, answering, call },
            (ev) => tell(child('entityOpening'), ev),
            `The surface "${surface}" is no longer ready.`,
          );
          return;
        }
        const callInfo = { call, answering, diagnostics };
        runtime.enqueueEffect(() => {
          for (const e of events) runtime.deliverSurface(surface, e, asker, callInfo);
        });
      },

      TRAIL_UPDATE: (event) => ({
        data: {
          breadcrumbs: event.crumbs,
          contextMenuItems: event.menuItems,
          targetView: event.target ?? '',
        },
      }),

      TRAIL_CLICK: (event, { data, tell, child }) => {
        tell(child('entityOpening'), { type: 'CANCEL' });
        const ref = data.defaultToggles.canvas ? (data.defaultSurface?.id ?? data.activeSurface.id) : data.activeSurface.id;
        runtime.enqueueEffect(() => {
          if (runtime.hasSurface(ref)) runtime.deliverSurface(ref, event);
        });
        return { data: { targetView: event.target } };
      },

      DEFAULT_TOGGLE: (_event, { data }) => {
        const nextCanvas = !data.defaultToggles.canvas;
        const surfaceId = nextCanvas ? (data.defaultSurface?.id ?? data.activeSurface.id) : data.activeSurface.id;
        runtime.enqueueEffect(() => runtime.followSurface(surfaceId));
        const targetView = runtime.readSurfaceTarget(surfaceId);
        return {
          data: {
            defaultToggles: { canvas: nextCanvas },
            ...(targetView !== undefined ? { targetView } : {}),
          },
        };
      },

      SELECT_SURFACE: (event, { data, tell, child }) => {
        const patch = selectSurface(
          event.surface,
          event.historyIndex,
          data as unknown as ShellContext,
          true,
          (ev) => tell(child('entityOpening'), ev),
        );
        return patch ? { data: patch } : undefined;
      },

      SELECT_SURFACE_BY_SHELL: (event, { data, tell, child }) => {
        const patch = selectSurface(
          event.surface,
          undefined,
          data as unknown as ShellContext,
          false,
          (ev) => tell(child('entityOpening'), ev),
        );
        return patch ? { data: patch } : undefined;
      },

      RESIZE_PANEL: (event, { data }) => ({
        data: { panelSizes: saved(resized(data.panelSizes, event.panel, event.size)) },
      }),

      TOGGLE_INSPECTION_PANEL: (_event, { data }) => ({
        data: { panelSizes: saved(inspectionToggled(data.panelSizes)) },
      }),

      MAXIMIZE_CHAT: (_event, { data }) => ({
        data: { panelSizes: saved(chatMaximized(data.panelSizes)) },
      }),

      RESTORE_CHAT: (_event, { data }) => ({
        data: { panelSizes: saved(chatRestored(data.panelSizes)) },
      }),

      SWITCH_SURFACE_UP: (_event, { data, send }) => {
        const next = neighbourOf(
          surfaceNavigationItems(catalog, packs.surfaceBindings(), data.surfaceVisibility)
            .filter((surface) => surface.visible && surface.loaded),
          data.activeSurface.id,
          'up',
        );
        if (next) send({ type: 'SELECT_SURFACE', surface: next.id });
      },

      SWITCH_SURFACE_DOWN: (_event, { data, send }) => {
        const next = neighbourOf(
          surfaceNavigationItems(catalog, packs.surfaceBindings(), data.surfaceVisibility)
            .filter((surface) => surface.visible && surface.loaded),
          data.activeSurface.id,
          'down',
        );
        if (next) send({ type: 'SELECT_SURFACE', surface: next.id });
      },

      NAVIGATE_BACK: (event, { data, tell, child }) => {
        tell(child('entityOpening'), { type: 'CANCEL' });
        const activeId = data.activeSurface.id;
        runtime.enqueueEffect(() => {
          if (runtime.hasSurface(activeId)) runtime.deliverSurface(activeId, { type: event.type });
        });
      },

      NAVIGATE_FORWARD: (event, { data, tell, child }) => {
        tell(child('entityOpening'), { type: 'CANCEL' });
        const activeId = data.activeSurface.id;
        runtime.enqueueEffect(() => {
          if (runtime.hasSurface(activeId)) runtime.deliverSurface(activeId, { type: event.type });
        });
      },

      FORWARD_HOTKEY: (event, { data }) => {
        const hotkeyEvent = event.event;
        const activeId = data.activeSurface.id;
        const surfaces = data.surfaces;
        runtime.enqueueEffect(() => {
          // Surfaces not open receive only their global hotkeys
          for (const surface of surfaces) {
            if (surface.id === activeId) continue;
            const globalActions = surface.hotkeys?.filter((h) => h.global).map((h) => h.action);
            if (globalActions?.length && runtime.hasSurface(surface.id)) {
              runtime.deliverSurface(surface.id, { ...hotkeyEvent, allowedActions: new Set(globalActions) });
            }
          }
          // The surface open receives all of them
          if (runtime.hasSurface(activeId)) runtime.deliverSurface(activeId, { ...hotkeyEvent });
        });
      },

      PROCESS_GLOBAL_HOTKEY: (event, { data, send }) => {
        if (data.hotkeysDisabled) return;
        const { hotkeyEvent, originalEvent } = event;
        const actionType = processHotkeys(hotkeyEvent, data.hotkeys, {
          toggleInspectionPanel: 'TOGGLE_INSPECTION_PANEL',
          switchSurfaceUp: 'SWITCH_SURFACE_UP',
          switchSurfaceDown: 'SWITCH_SURFACE_DOWN',
        });
        if (actionType) {
          originalEvent?.preventDefault();
          send({ type: actionType });
        } else {
          send({ type: 'FORWARD_HOTKEY', event: hotkeyEvent });
        }
      },

      HOTKEYS_RECORDING_START: () => ({ data: { hotkeysDisabled: true } }),
      HOTKEYS_RECORDING_END: () => ({ data: { hotkeysDisabled: false } }),

      BACKEND_ERROR: (event) => {
        runtime.enqueueEffect(() => notify.errorPage('Something went wrong', event.error));
        return { at: 'error' };
      },

      SYSTEM_ERROR: (event) => {
        // A diagnostic is for whoever is building the app or a pack, and it is already in the Logs surface.
        if (event.severity === 'diagnostic') return;
        if (event.severity === 'fatal') {
          runtime.enqueueEffect(() => {
            notify.errorPage(event.title ?? 'Something went wrong', { message: event.message, stack: event.stack });
          });
          return;
        }
        runtime.enqueueEffect(() => notify.error(event.title ?? 'Something went wrong', event.message));
      },

      NOOP: () => {},
    },
  });
}

export type ShellState = ReturnType<typeof createShellState>;

interface RunningSurface {
  readonly id: string;
  readonly sessionId: string;
  readonly handle: Handle<unknown, any, Asks, any>;
  readonly chrome?: SurfaceChrome<never>;
  readonly listeners: Set<(snapshot: HostShellSurfaceSnapshot) => void>;
  readonly ref: HostShellSurfaceRef;
  stopped: boolean;
  lastSnapshot: HostShellSurfaceSnapshot;
}

/**
 * Creates a per-window frontend app shell backed by one `@apackdev/state` `System` (`side: 'window'`) running both
 * the `host/application` shell state and every host and pack surface directly. Call `.start()` after binding the
 * frontend host (`bindFeHost` / `startFeTestRuntime`).
 */
export function createShell(options: ShellOptions, params: ShellParams = {}): ShellRuntime {
  const { packs, catalog, client, storage } = options;

  const cleanups: Array<() => void> = [];
  const shellSubscribers = new Set<{ next?: (snapshot: ShellSnapshot) => void; error?: (error: unknown) => void }>();
  const eventListeners = new Set<(record: { to: string; event: SurfaceEvent }) => void>();
  const runningSurfaces = new Map<string, RunningSurface>();

  const emitObservedEvent = (to: string, event: SurfaceEvent): void => {
    if (eventListeners.size === 0) return;
    for (const listener of Array.from(eventListeners)) {
      try { listener({ to, event }); } catch {}
    }
  };
  const effects: Array<() => void> = [];

  let surfaceSeq = 0;
  let started = false;
  let stopped = false;
  let draining = false;
  let drainScheduled = false;
  let shellNotifyPending = false;
  let shellHandle: Handle<Value<ShellShape>, ShellEvent, Asks, {
    entityOpening: EntityOpeningState;
    packLoader: PackFrontendLoaderState;
  }> | undefined;
  let lastShellSnapshot: ShellSnapshot | undefined;

  const hasBrowserWindow = typeof globalThis.requestAnimationFrame === 'function'
    && typeof globalThis.document !== 'undefined';

  const frame = hasBrowserWindow
    ? windowFrame({
        hidden: () => globalThis.document.hidden,
        frame: (run) => { globalThis.requestAnimationFrame(run); },
        later: (run) => { setTimeout(run, 0); },
        onHidden: (listener) => {
          const onVisibilityChange = () => { if (globalThis.document.hidden) listener(); };
          globalThis.document.addEventListener('visibilitychange', onVisibilityChange);
          cleanups.push(() => globalThis.document.removeEventListener('visibilitychange', onVisibilityChange));
        },
      })
    : undefined;

  const views: ViewHost = (feature, view, args, updated) =>
    client.watchView({ ref: feature, view, args }, (update) => {
      if (update.ok) updated({ ok: true, value: update.value });
      else updated({ ok: false, failure: { kind: 'failed', message: update.error } });
    });

  const handleDefect = (defect: Defect): void => {
    options.onDefect?.(defect);
    const err = defect.error ?? new Error(defect.message);
    reportError({
      source: defect.ref ?? 'frontend',
      operation: 'state',
      severity: 'diagnostic',
      error: err,
    });
    for (const sub of Array.from(shellSubscribers)) {
      sub.error?.(err);
    }
  };

  const sys = system({
    side: 'window',
    name: 'frontend',
    views,
    clock: resolveWindowClock(options.clock),
    ...(frame ? { frame } : {}),
    onDefect: handleDefect,
  });

  const drainEffects = (): void => {
    if (draining) return;
    draining = true;
    try {
      while (effects.length > 0 && !stopped) {
        const next = effects.shift()!;
        next();
      }
    } finally {
      draining = false;
    }
    if (shellNotifyPending && !stopped) {
      shellNotifyPending = false;
      notifyShellSubscribers();
    }
  };

  const scheduleDrain = (): void => {
    if (draining || drainScheduled || effects.length === 0 || stopped) return;
    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      if (!stopped) drainEffects();
    });
  };

  const sendToShell = (event: ShellEvent): void => {
    if (!shellHandle || stopped) return;
    emitObservedEvent(HOST.application, event as SurfaceEvent);
    sys.send(shellHandle, event);
  };

  const readSurfaceState = (id: string): { at?: string; data: Record<string, unknown> } | undefined => {
    const entry = runningSurfaces.get(id);
    if (!entry || entry.stopped) return undefined;
    const snap = sys.read(entry.handle) as { at?: string; data?: Record<string, unknown> } | undefined;
    if (!snap) return undefined;
    return { at: snap.at, data: snap.data ?? {} };
  };

  const readTrailSurface = (id: string): TrailSurfaceState | undefined => {
    const entry = runningSurfaces.get(id);
    if (!entry || entry.stopped) return undefined;
    const snap = readSurfaceState(id);
    if (!snap) return undefined;
    return { id, at: snap.at, data: snap.data, chrome: entry.chrome };
  };

  const trailer = createSurfaceTrailer(readTrailSurface, ({ crumbs, target, menuItems }) => {
    sendToShell({ type: 'TRAIL_UPDATE', crumbs, target, menuItems });
  });

  const makeShellSnapshot = (status: 'active' | 'stopped', at: string, context: ShellContext): ShellSnapshot => ({
    status,
    at,
    value: at,
    context,
    hasTag: (tag: string) => hasTagFor(at, tag),
    matches: (statePath: string) => matchesAt(at, statePath),
  });

  const readCurrentShellSnapshot = (): ShellSnapshot => {
    if (shellHandle && !stopped) {
      const snap = sys.read(shellHandle) as { at: string; data: ShellContext } | undefined;
      if (snap) {
        lastShellSnapshot = makeShellSnapshot('active', snap.at, snap.data);
        return lastShellSnapshot;
      }
    }
    if (lastShellSnapshot) {
      return stopped ? makeShellSnapshot('stopped', lastShellSnapshot.at, lastShellSnapshot.context) : lastShellSnapshot;
    }
    throw new Error('The app shell has not been started yet: call shell.start() before reading its snapshot');
  };

  const notifyShellSubscribers = (): void => {
    if (draining) {
      shellNotifyPending = true;
      return;
    }
    if (shellSubscribers.size === 0 || !shellHandle) return;
    const snap = readCurrentShellSnapshot();
    for (const sub of Array.from(shellSubscribers)) {
      sub.next?.(snap);
    }
  };

  const buildSurfaceSnapshot = (entry: RunningSurface): HostShellSurfaceSnapshot => {
    if (entry.stopped) return entry.lastSnapshot;
    const snap = sys.read(entry.handle) as { at?: string; data?: Record<string, unknown> } | undefined;
    const next: HostShellSurfaceSnapshot = {
      status: 'active',
      value: snap?.at ?? '',
      context: snap?.data ?? {},
    };
    entry.lastSnapshot = next;
    return next;
  };

  const stopSurface = (id: string): void => {
    const entry = runningSurfaces.get(id);
    if (!entry) return;
    const finalSnap = buildSurfaceSnapshot(entry);
    entry.stopped = true;
    entry.lastSnapshot = { ...finalSnap, status: 'stopped' };
    runningSurfaces.delete(id);
    if (!stopped) {
      sys.stop(entry.handle);
    }
    notifyShellSubscribers();
  };

  const startSurface = (surface: Surface, ownsAppLayout: boolean): void => {
    if (stopped) return;
    if (!isState(surface.state)) {
      throw new Error(`Surface "${surface.id}" must be an @apackdev/state State definition`);
    }
    if (runningSurfaces.has(surface.id)) stopSurface(surface.id);

    const handle = sys.start(surface.id, surface.state as State<any, any, any, never>);
    const listeners = new Set<(snapshot: HostShellSurfaceSnapshot) => void>();
    const sessionId = `surface-${++surfaceSeq}`;
    const initialSnap = sys.read(handle) as { at?: string; data?: Record<string, unknown> } | undefined;

    const entry: RunningSurface = {
      id: surface.id,
      sessionId,
      handle,
      chrome: surface.chrome,
      listeners,
      stopped: false,
      lastSnapshot: {
        status: 'active',
        value: initialSnap?.at ?? '',
        context: initialSnap?.data ?? {},
      },
      ref: {
        id: surface.id,
        sessionId,
        getSnapshot: () => buildSurfaceSnapshot(entry),
        subscribe: (observer) => {
          listeners.add(observer);
          return { unsubscribe: () => { listeners.delete(observer); } };
        },
        send: (event: SurfaceEvent) => {
          if (entry.stopped || stopped) return;
          emitObservedEvent(surface.id, event);
          sys.port.tell(surface.id, stripCallKey(event));
          drainEffects();
        },
      },
    };
    runningSurfaces.set(surface.id, entry);
    notifyShellSubscribers();
    notifySurfaceActor(entry.ref, surface.id, { type: 'SURFACE_STARTED', ownsAppLayout });
    drainEffects();
  };

  const deliverSurface = (
    ref: string,
    event: SurfaceEvent,
    asker?: SurfaceRequest['sender']['asker'],
    call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>,
  ): void => {
    const targetSurface = runtime.surface(ref);
    if (!targetSurface) return;
    if (asker) sendToSurfaceActor(targetSurface, ref, event, asker, call);
    else notifySurfaceActor(targetSurface, ref, event, call);
  };

  // Wire upstream client transport (`tell`, `ask`, `follow`) to the frontend `System`
  cleanups.push(sys.attach({
    tell: (to, event) => {
      client.send({
        to,
        event: event as SurfaceEvent,
        call: newCall(),
      });
    },
    ask: (to, name, args, progress, done) => {
      const controller = new AbortController();
      let active = true;
      const payload = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
      void _askOverClient(
        client,
        to,
        { ...payload, type: name },
        {
          signal: controller.signal,
          heard: (update) => { if (active) progress(update); },
        },
      ).then(
        (outcome) => {
          if (!active) return;
          active = false;
          if (outcome.ok) done({ ok: true, value: outcome.value });
          else done({ ok: false, failure: outcome.failure });
        },
        () => {
          active = false;
        },
      );
      return () => {
        if (!active) return;
        active = false;
        controller.abort();
      };
    },
    follow: (feature, view, args, updated, failed) => {
      const stop = client.watchView({ ref: feature, view, args }, (update) => {
        if (update.ok) updated(update.value);
        else failed({ kind: 'failed', message: update.error });
      });
      return { stop };
    },
  }));

  for (const peer of ROLE_PEERS) {
    const role = peer.slice('role:'.length);
    cleanups.push(sys.attach(peer, {
      tell: (_name, event) => {
        const targetRef = packs.designation(role);
        if (!targetRef) return;
        client.send({ to: targetRef, event: event as SurfaceEvent, call: newCall() });
      },
    }));
  }

  cleanups.push(sys.attach('shell', {
    tell: (_name, event) => {
      sendToShell(event as ShellEvent);
      scheduleDrain();
    },
  }));

  cleanups.push(sys.subscribe((changed) => {
    if (stopped) return;
    trailer.onSystemChange(changed);
    for (const ref of changed) {
      const entry = runningSurfaces.get(ref);
      if (entry && !entry.stopped && entry.listeners.size > 0) {
        const snap = buildSurfaceSnapshot(entry);
        for (const listener of Array.from(entry.listeners)) listener(snap);
      }
    }
    if (changed.includes(HOST.application)) {
      // Hold shell notifications until queued surface start/stop effects drain outside the kernel step so
      // subscribers never observe a surface in `snapshot.context.surfaces` whose actor isn't running yet.
      if (effects.length > 0 || draining) {
        shellNotifyPending = true;
      } else {
        notifyShellSubscribers();
      }
    }
    if (effects.length > 0) {
      scheduleDrain();
    }
  }));

  const bridge: ShellRuntimeBridge = {
    isConnected: () => readCurrentShellSnapshot().context.busSubscribed,
    hasSurface: (ref) => runtime.surface(ref) !== undefined,
    enqueueEffect: (fn) => { effects.push(fn); },
    startSurface,
    stopSurface,
    deliverSurface,
    followSurface: (ref) => {
      trailer.follow(ref);
    },
    readSurfaceTarget: (ref) => trailer.readTarget(ref),
    sendShellAsync: (event) => {
      sendToShell(event);
      drainEffects();
    },
    drainEffects,
  };

  const shellState = createShellState(options, bridge);

  const selectedDefaultSurface = (surfaces: readonly Surface[]) => {
    const declaration = selectDefaultSurfaceDeclaration(catalog);
    const accepted = declaration ? getEligibleSurface(catalog, packs.surfaceBindings(), declaration.featureRef) : undefined;
    return accepted && surfaces.includes(accepted) ? accepted : undefined;
  };

  const runtime: ShellRuntime = {
    system: sys,

    start() {
      if (started || stopped) return runtime;
      started = true;

      const surfaces = withHostLast(packs.getRegisteredSurfaces());
      const initialSurface = surfaces.find((p) => p.id === params.initialSurfaceId);
      const claimedDefault = selectedDefaultSurface(surfaces) ?? null;
      const initialActiveSurface = initialSurface ?? claimedDefault ?? surfaces[0];
      const ownsLastActiveSurface = params.ownsLastActiveSurface ?? true;

      shellHandle = sys.start(HOST.application, shellState, {
        surfaces,
        activeSurface: initialActiveSurface,
        defaultSurface: claimedDefault,
        wantsDefaultSurface: claimedDefault === null && params.initialSurfaceId === undefined,
        surfaceHistory: [initialActiveSurface.id],
        panelSizes: initialPanelSizes(storage),
        ownsLastActiveSurface,
        pendingSurfaceId: initialSurface ? null : (params.initialSurfaceId ?? null),
      });

      // Start every initially registered surface directly in `sys`, then activate and trail the active surface
      for (const surface of surfaces) {
        startSurface(surface, ownsLastActiveSurface);
      }
      if (runtime.surface(initialActiveSurface.id)) {
        deliverSurface(initialActiveSurface.id, { type: 'SURFACE_ACTIVATED' });
      }
      trailer.follow(initialActiveSurface.id);
      drainEffects();

      // Subscribe to the backend connection once initial surfaces are running and trailed
      cleanups.push(subscribeConnection(client, {
        sendToShell: (event) => {
          sendToShell(event);
          drainEffects();
        },
        deliverToSurface: (message) => {
          const { to, event, sender } = message;
          const surfaceRef = runtime.surface(to);
          if (!surfaceRef) {
            const suffix = senderSuffix(message);
            console.warn(`[shell] No surface is running at ${to} for ${event.type}${suffix && ` sent${suffix}`}`);
            return;
          }
          if (sender === undefined) notifySurfaceActor(surfaceRef, to, event, message);
          else sendToSurfaceActor(surfaceRef, to, event, { kind: 'bus', ref: sender }, message);
          drainEffects();
        },
      }));

      return runtime;
    },

    stop() {
      if (stopped) return;
      stopped = true;
      effects.length = 0;
      if (shellHandle) {
        const snap = sys.read(shellHandle) as { at: string; data: ShellContext } | undefined;
        if (snap) lastShellSnapshot = makeShellSnapshot('stopped', snap.at, snap.data);
      }
      for (const entry of runningSurfaces.values()) {
        const snap = buildSurfaceSnapshot(entry);
        entry.stopped = true;
        entry.lastSnapshot = { ...snap, status: 'stopped' };
      }
      runningSurfaces.clear();
      for (const cleanup of cleanups.splice(0).reverse()) cleanup();
      sys.stop();
    },

    send(event: ShellEvent) {
      if (stopped || !shellHandle) return;
      sendToShell(event);
      drainEffects();
    },

    getSnapshot: readCurrentShellSnapshot,

    subscribe(observer: ShellObserver) {
      const normalized = typeof observer === 'function' ? { next: observer } : observer;
      shellSubscribers.add(normalized);
      return { unsubscribe: () => { shellSubscribers.delete(normalized); } };
    },

    surface(ref: string): HostShellSurfaceRef | undefined {
      const entry = runningSurfaces.get(ref);
      return entry && !entry.stopped ? entry.ref : undefined;
    },

    entityOpening(): Value<EntityOpeningShape> | undefined {
      if (!shellHandle || stopped) return undefined;
      return sys.read(sys.child(shellHandle, 'entityOpening'));
    },

    onEvent(listener: (record: { to: string; event: SurfaceEvent }) => void) {
      eventListeners.add(listener);
      return { unsubscribe: () => { eventListeners.delete(listener); } };
    },
  };

  return runtime;
}
