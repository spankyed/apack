// The backend bus: runs every registered `@apackdev/state` backend system in one shared `System`, routes client
// and peer events to them, validates outgoing surface sends, and manages pack activation, reload, and teardown.
import {
  system,
  type AnyState,
  type Clock,
  type Defect,
  type Handle,
  type Port,
  type PortOutcome,
  type State,
  type StepLog,
  type System,
  type Transact,
} from '@apackdev/state';
import {
  _answered,
  _askEnded,
  _askSignal,
  _CALL_KEY,
  _cancelAsk,
  _clientOf,
  _currentDelivery,
  _failedAnswer,
  _isPendingAsk,
  _progressed,
  _replyTo,
  _settleAsk,
  newCall,
  senderSuffix,
  SURFACE_EVENT_TYPES,
  type Message,
} from '@apackdev/sdk/events';
import { isState, SYSTEM_EVENT_TYPES, type PackSystemLogic } from '@apackdev/sdk/framework';
import { splitRef } from '@apackdev/sdk/ids';
import { reportError } from '@apackdev/sdk/logger';
import { carrySettingsRequest } from '../features/settings/be/access.ts';
import type { PackRegistry } from '../packs/registry.ts';
import { HOST } from '../refs.ts';
import { answerUnavailable, deliverAs } from './delivery.ts';

type StateEvent = { type: string; [key: string]: unknown };

const ROLE_PEERS = ['role:brain', 'role:code'] as const;

const defaultClock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** A message in for a system (INCOMING) or out for a surface (OUTGOING) */
export type BusEvent =
  | { type: 'INCOMING'; message: Message }
  | { type: 'OUTGOING'; message: Message };

/** Restarts a pack's systems: stops each running one, then starts those still registered */
export type ReloadPackEvent = { type: 'RELOAD_PACK'; packId: string; systemIds: string[] };
export type TeardownPackEvent = { type: 'TEARDOWN_PACK'; systemIds: string[]; packId?: string; afterStop?: () => void };
export type ActivatePackEvent = { type: 'ACTIVATE_PACK'; packId: string; systemIds: string[] };
/** A client loaded a pack's frontend after connecting: its systems send their startup data */
export type PackClientConnectedEvent = { type: 'PACK_CLIENT_CONNECTED'; packId: string };
/**
 * A pack was activated, reloaded or torn down while the app runs, or its content was imported: what it
 * registers (its slash commands) and the content it applied may differ, so every running system can refresh
 * what it reads. Raised once the change is complete. Boot raises nothing: the systems start after it.
 */
export type PackChangedEvent = { type: 'PACK_CHANGED'; packId: string };
/** Raised once every row the app holds has been replaced and the new world is built (`services.appData`) */
export type DataReplacedEvent = { type: 'DATA_REPLACED' };
/** Raised when a local tool says it committed to the app's database from its own process */
export type DataChangedElsewhereEvent = { type: 'DATA_CHANGED_ELSEWHERE' };
/** Raised after restarting a pack's systems, once they're in the system and can receive events */
export type SystemsSpawnedEvent = { type: 'SYSTEMS_SPAWNED'; systemIds: string[] };

export type BackendEvents =
  | BusEvent
  | { type: 'CLIENT_CONNECTED' }
  | ReloadPackEvent
  | TeardownPackEvent
  | ActivatePackEvent
  | PackClientConnectedEvent
  | PackChangedEvent
  | DataReplacedEvent
  | DataChangedElsewhereEvent
  | SystemsSpawnedEvent
  | { type: 'SYSTEMS_STOPPED'; afterStop(): void };

/** The events a bus source can feed it: OUTGOING for sends to surfaces from outside a system (`broadcast`) */
export type BusSourceEvent = Extract<
  BackendEvents,
  { type: 'INCOMING' | 'OUTGOING' | 'CLIENT_CONNECTED' | 'PACK_CLIENT_CONNECTED' }
>;

/** Committed snapshot value of a running `@apackdev/state` backend system. */
export interface StateSystemValue {
  readonly at?: string;
  readonly data: Record<string, unknown>;
  readonly pending?: Record<string, unknown>;
}

/** Handle to one running backend system inside a `BackendBus`. */
export interface RunningSystemRef {
  readonly ref: string;
  readonly handle: Handle<unknown, any, any>;
  /** Current committed `@apackdev/state` value (`{ at?, data, pending? }`). */
  read(): StateSystemValue | undefined;
  /** Sends an event directly to this running system through the bus's `@apackdev/state` kernel. */
  send(event: StateEvent): void;
  /** Subscribes to committed changes for this system; returns an unsubscribe function. */
  subscribe(listener: (snapshot: StateSystemValue) => void): () => void;
}

/** Running status of the backend bus. */
export type BusStatus = 'stopped' | 'awaitingClient' | 'clientSeen';

/** The running backend bus hosting all registered `@apackdev/state` systems. */
export interface BackendBus {
  /** The single shared `@apackdev/state` `System` running all backend systems. */
  readonly system: System;
  /** The `@apackdev/state` `Port` of `system` (pass directly to `@apackdev/link`'s `accept`). */
  readonly port: Port;
  /** Current lifecycle status: `'stopped'`, `'awaitingClient'`, or `'clientSeen'`. */
  readonly status: BusStatus;
  /** Starts listening for events and starts all registered backend systems. Returns `this` for chaining. */
  start(): this;
  /** Stops listening and stops all running backend systems. */
  stop(): void;
  /** Sends a bus event (`INCOMING`, `OUTGOING`, `CLIENT_CONNECTED`, pack lifecycle events, etc.). */
  send(event: BackendEvents | StateEvent): void;
  /** Returns the running system reference for `id`, or `undefined` if not currently running. */
  getSystem(id: string): RunningSystemRef | undefined;
  /** Reads the committed `@apackdev/state` value for a running system, or `undefined`. */
  read(id: string): StateSystemValue | undefined;
  /** Subscribes to unhandled fatal errors on the bus; returns an unsubscribe function. */
  onError(listener: (error: unknown) => void): () => void;
}

export interface BusOptions {
  /** The registered packs whose systems the bus runs */
  registry: Pick<
    PackRegistry,
    'getRegisteredSystems' | 'getRegisteredPackSystemIds' | 'getSurfaceEventValidationMap' | 'getEventValidationMap' | 'askKinds'
  > & Partial<Pick<PackRegistry, 'designation'>>;
  /** The systems the bus runs, by id; defaults to every system in `registry` */
  systems?(): ReadonlyMap<string, PackSystemLogic>;
  /** Delivers a message a system sent to a frontend surface */
  onOutgoing(message: Message): void;
  /**
   * The connection that claimed a ref, for a name no pack registered (`host/drive`). A message addressed to one
   * is delivered to that connection rather than checked against a surface's declared events, since no pack
   * describes it. Absent in a bus with no claims, which is every bus but the app's.
   */
  participantClient?(ref: string): string | undefined;
  /** Feeds the bus client events (INCOMING, CLIENT_CONNECTED, PACK_CLIENT_CONNECTED) and sends to surfaces (OUTGOING); returns the unsubscribe */
  listen(send: (event: BusSourceEvent) => void): () => void;
  /**
   * Packs whose frontend code a client loads after connecting. A connection's CLIENT_CONNECTED, and a
   * pack's activation, skip their systems: the client sends PACK_CLIENT_CONNECTED for each once it has
   * tried to load the pack's frontend (whether or not that loaded any surfaces), and again each time its
   * subscription reconnects, so they get it once per client connection.
   */
  clientLoadedPacks?(): Iterable<string>;
  /** Messages the bus sends to clients after each client connection's CLIENT_CONNECTED reached the systems */
  connectedEvents?(): Message[];
  /** Optional clock override; defaults to standard wall time + `setTimeout`. */
  clock?: Clock;
  /** Optional transactional wrapper passed to `@apackdev/state`'s `system({ transact })`. */
  transact?: Transact;
  /** Optional observer invoked for every `@apackdev/state` kernel defect in addition to `reportError`. */
  onDefect?(defect: Defect): void;
  /** Optional observer invoked after every `@apackdev/state` step commits. */
  onStep?(step: StepLog): void;
  /** Optional observer invoked for every event dequeued by the bus (including `OUTGOING` before a client connects). */
  onEvent?(event: BackendEvents): void;
}

/**
 * Dispatches a declared ask arriving on the bus to a `@apackdev/state` backend system, wiring progress,
 * cancellation (`_askSignal` / `_askEnded`), answer/failure replies, and orphan-failure reporting.
 */
function dispatchStateAsk(
  sys: System,
  ref: string,
  message: Message,
  kinds: readonly string[],
): void {
  const { to, event: incoming, sender, client, call, diagnostics } = message;
  const { type: asked, [_CALL_KEY]: _ignoredCall, ...args } = incoming;
  carrySettingsRequest(incoming, args);
  const ask = { kinds, taken: false };

  deliverAs({ to, sender, client, call, diagnostics }, incoming, () => {
    const delivery = _currentDelivery();
    if (delivery?.ask) delivery.ask.taken = true;
    const reply = _replyTo(delivery);
    const signal = _askSignal(call, _clientOf(delivery));
    if (signal.aborted) {
      _askEnded(call);
      return;
    }

    let settled = false;
    let cancel: (() => void) | undefined;
    const onAbort = () => {
      cancel?.();
    };
    const onProgress = (update: unknown) => {
      if (!signal.aborted) reply?.(_progressed(asked, update));
    };
    const onDone = (outcome: PortOutcome) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      _askEnded(call);
      if (signal.aborted) return;
      if (outcome.ok) {
        reply?.(_answered(asked, outcome.value));
        return;
      }
      if (reply) {
        reply(_failedAnswer(asked, outcome.failure));
      } else if (outcome.failure.kind !== 'unavailable') {
        reportError({
          error: new Error(outcome.failure.message),
          title: `${asked} failed`,
          source: ref,
        });
      }
    };

    cancel = sys.port.ask(ref, asked, args, onProgress, onDone);
    if (!settled) {
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  }, ask);
}

/** Creates a backend bus backed by one shared `@apackdev/state` `System`. */
export function createBus(options: BusOptions): BackendBus {
  const { registry } = options;
  const systems = options.systems ?? registry.getRegisteredSystems;
  const clientLoadedPacks = () => new Set(options.clientLoadedPacks?.() ?? []);
  const errorListeners = new Set<(error: unknown) => void>();

  const notifyError = (error: unknown) => {
    for (const listener of errorListeners) {
      try {
        listener(error);
      } catch {
        // An observer failing must not break other observers
      }
    }
  };

  const sys = system({
    side: 'backend',
    name: 'backend',
    clock: options.clock ?? defaultClock,
    ...(options.transact ? { transact: options.transact } : {}),
    ...(options.onStep ? { log: options.onStep } : {}),
    onDefect: (defect) => {
      const error = defect.error ?? new Error(defect.message);
      reportError({
        source: defect.ref ?? HOST.bus,
        operation: 'state',
        severity: 'diagnostic',
        error,
      });
      options.onDefect?.(defect);
    },
  });

  let status: BusStatus = 'stopped';
  const isStopped = (): boolean => status === 'stopped';
  let awaitingFrontends = new Set<string>();
  let stopListening: (() => void) | undefined;
  const detaches: Array<() => void> = [];
  const handles = new Map<string, RunningSystemRef>();

  /**
   * The drops already reported, keyed by surface/system, event type, sender, and answering flag, so each
   * distinct drop is reported once per bus. Prevents log-surface feedback loops and noisy repeat flooding.
   */
  const reportedDrops = new Set<string>();

  const queue: BackendEvents[] = [];
  let draining = false;
  let scheduledDrain = false;

  const scheduleDrain = () => {
    if (scheduledDrain || status === 'stopped') return;
    scheduledDrain = true;
    queueMicrotask(() => {
      scheduledDrain = false;
      if (status !== 'stopped') drain();
    });
  };

  /**
   * Enqueues a bus event from a `@apackdev/state` flush callback (`down` port or named peer).
   * During `flush()`, `sys` holds `flushing = true`, so we never re-enter `sys` directly from inside the
   * callback: if an outer `drain()` is active it will pick the event up synchronously right after `flush()`
   * finishes; otherwise a microtask drains it immediately after `step()` exits `flushing`.
   */
  const enqueueFromFlush = (event: BackendEvents) => {
    if (isStopped()) return;
    queue.push(event);
    if (!draining) scheduleDrain();
  };

  /**
   * Delivers an `OUTGOING` broadcast from `@apackdev/state`'s `down` port during `flush()`.
   * `notifyOutgoing` never re-enters `sys`, so when no outer `drain()` is active we deliver it synchronously
   * (preserving synchronous broadcast visibility for `listen`-triggered updates such as `onPackCatalogChanged`).
   * Any non-`OUTGOING` events enqueued by listeners while `sys` is still flushing defer to a microtask.
   */
  const deliverOutgoingFromFlush = (event: Extract<BackendEvents, { type: 'OUTGOING' }>) => {
    if (isStopped()) return;
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && !isStopped() && queue[0]!.type === 'OUTGOING') {
        processEvent(queue.shift()!);
      }
      if (queue.length > 0 && !isStopped()) scheduleDrain();
    } catch (error) {
      notifyError(error);
      throw error;
    } finally {
      draining = false;
    }
  };

  const withDrain = (fn: () => void) => {
    if (draining) {
      fn();
      return;
    }
    draining = true;
    try {
      fn();
      while (queue.length > 0 && !isStopped()) {
        const next = queue.shift()!;
        processEvent(next);
      }
    } catch (error) {
      notifyError(error);
      throw error;
    } finally {
      draining = false;
    }
  };

  const drain = () => {
    if (draining || isStopped()) return;
    draining = true;
    try {
      while (queue.length > 0 && !isStopped()) {
        const next = queue.shift()!;
        processEvent(next);
      }
    } catch (error) {
      notifyError(error);
      throw error;
    } finally {
      draining = false;
    }
  };

  function awaiting(previous: ReadonlySet<string>, packId: string): Set<string> {
    const next = new Set(previous);
    if (clientLoadedPacks().has(packId)) next.add(packId);
    else next.delete(packId);
    return next;
  }

  function publishable(ids: string[], pendingPacks: ReadonlySet<string>): string[] {
    const pending = new Set([...pendingPacks].flatMap((id) => registry.getRegisteredPackSystemIds(id)));
    return ids.filter((id) => !pending.has(id));
  }

  function readSystem(id: string): StateSystemValue | undefined {
    const entry = handles.get(id);
    if (!entry) return undefined;
    return sys.read(entry.handle) as StateSystemValue | undefined;
  }

  function makeRunningRef(id: string, handle: Handle<unknown, any, any>): RunningSystemRef {
    return {
      ref: id,
      handle,
      read: () => (handles.get(id)?.handle === handle ? (sys.read(handle) as StateSystemValue | undefined) : undefined),
      send: (event) => {
        if (status === 'stopped' || handles.get(id)?.handle !== handle) return;
        withDrain(() => {
          deliverAs({ to: id }, event, () => {
            sys.port.tell(id, event);
          });
        });
      },
      subscribe: (listener) => sys.subscribe((changed) => {
        if (!changed.includes(id) || handles.get(id)?.handle !== handle) return;
        const snap = sys.read(handle) as StateSystemValue | undefined;
        if (snap !== undefined) listener(snap);
      }),
    };
  }

  function spawnSystems(systemIds: readonly string[], registered: ReadonlyMap<string, PackSystemLogic>): string[] {
    const spawned = systemIds.filter((id) => registered.has(id));
    for (const id of spawned) {
      const entry = registered.get(id)!;
      if (!isState(entry)) {
        throw new Error(`Backend system "${id}" must be an @apackdev/state State definition.`);
      }
      const handle = sys.start(id, entry as AnyState as State<any, any, any, never>);
      handles.set(id, makeRunningRef(id, handle));
    }
    return spawned;
  }

  function stopSystems(systemIds: readonly string[]): void {
    for (const id of new Set(systemIds)) {
      const entry = handles.get(id);
      if (!entry) continue;
      handles.delete(id);
      sys.stop(entry.handle);
    }
  }

  function sendToRunning(systemIds: Iterable<string>, event: StateEvent): void {
    for (const id of systemIds) {
      if (!handles.has(id)) continue;
      deliverAs({ to: id }, event, () => {
        sys.port.tell(id, event);
      });
    }
  }

  function askToPublish(systemIds: Iterable<string>): void {
    for (const id of systemIds) {
      if (handles.has(id)) {
        const event = { type: 'SEND_STATE' };
        deliverAs({ to: id }, event, () => {
          sys.port.tell(id, event);
        });
      } else {
        console.warn(`[bus] SEND_STATE: system "${id}" isn't running`);
      }
    }
  }

  function notifyOutgoing(message: Message): void {
    if (_settleAsk(message)) return;
    const { to: surfaceId, event: { type } } = message;
    const sender = senderSuffix(message);
    const answering = message.answering !== undefined;
    const accepted = registry.getSurfaceEventValidationMap().get(surfaceId);
    const reportDrop = (text: string) => {
      const pair = `${surfaceId}/${type}/${sender}/${answering}`;
      if (reportedDrops.has(pair)) return;
      reportedDrops.add(pair);
      reportError({
        source: 'bus',
        operation: 'broadcast',
        ...(answering ? { answering } : {}),
        severity: 'diagnostic',
        error: new Error(text),
      });
    };
    if (accepted === undefined) {
      const claimed = options.participantClient?.(surfaceId);
      if (claimed !== undefined) {
        options.onOutgoing({ ...message, client: message.client ?? claimed });
        return;
      }
      if ((SURFACE_EVENT_TYPES as readonly string[]).includes(type)) return;
      reportDrop(answering
        ? `Dropped the answer "${type}"${sender} to "${surfaceId}", which no registered pack declares as a surface that receives events. Nothing holds an asker open, so this is most likely a race: the asking pack unloaded before the answer landed.`
        : `Dropped "${type}" sent${sender} to "${surfaceId}", which no registered pack declares as a surface that receives events. Check the id, or give the surface's own pack a system that declares what it sends there.`);
      return;
    }
    if (!accepted.has(type)) {
      reportDrop(answering
        ? `Dropped the answer "${type}"${sender} to the "${surfaceId}" surface, which declares no such event. \`reply\` is typed against the answering system's outgoing events and cannot be checked against the asking surface's inbox, so this compiles: either the asking surface must declare "${type}" among what its pack's systems emit to it, or the answer has to be an event it already declares.`
        : `Dropped "${type}" sent${sender} to the "${surfaceId}" surface, which declares no such event. A surface receives what its own pack's systems declare they emit: add it to that system's outgoing events, or send an event the surface handles.`);
      return;
    }
    options.onOutgoing(message);
  }

  function reportUndeclaredIncoming(to: string, type: string, message: Message): void {
    const accepted = registry.getEventValidationMap().get(to);
    if (accepted === undefined || accepted.has('*') || accepted.has(type)) return;
    if ((SYSTEM_EVENT_TYPES as readonly string[]).includes(type)) return;
    const sender = senderSuffix(message);
    const answering = message.answering !== undefined;
    const pair = `${to}/${type}/${sender}/${answering}`;
    if (reportedDrops.has(pair)) return;
    reportedDrops.add(pair);
    reportError({
      source: 'bus',
      operation: 'tell',
      ...(answering ? { answering } : {}),
      severity: 'diagnostic',
      error: new Error(answering
        ? `Answered "${type}"${sender} to the "${to}" system, which declares no such event — it will be ignored. \`reply\` is typed against the answering side's outgoing events and cannot be checked against the asking system's incoming, so this compiles: either "${to}" must declare "${type}" among its contract's incoming events, or the answer has to be an event it already declares.`
        : `Sent "${type}"${sender} to the "${to}" system, which declares no such event — it will be ignored. A system receives what its contract's incoming events declare: add it there, or send an event the system handles.`),
    });
  }

  function routeIncoming(message: Message): void {
    if (_settleAsk(message)) return;
    if (_cancelAsk(message)) return;
    const { to, event: incoming, sender, client, call, diagnostics } = message;

    // Messages addressed directly to `host/bus` (e.g. `untypedTell(HOST.bus, { type: 'DATA_REPLACED' })`)
    if (to === HOST.bus) {
      reportUndeclaredIncoming(to, incoming.type, message);
      queue.push(incoming as BackendEvents);
      return;
    }

    const kinds = registry.askKinds(to, incoming.type);
    if (handles.has(to)) {
      reportUndeclaredIncoming(to, incoming.type, message);
      if (kinds !== undefined) {
        dispatchStateAsk(sys, to, message, kinds);
        return;
      }
      const delivered = _CALL_KEY in incoming
        ? Object.fromEntries(Object.entries(incoming).filter(([key]) => key !== _CALL_KEY)) as StateEvent
        : incoming;
      if (delivered !== incoming) carrySettingsRequest(incoming, delivered);
      deliverAs({ to, sender, client, call, diagnostics }, delivered, () => {
        sys.port.tell(to, delivered);
      });
    } else if (kinds !== undefined || _isPendingAsk(call)) {
      answerUnavailable(message, `No "${to}" system is running to answer "${incoming.type}"`);
    } else if (!(SYSTEM_EVENT_TYPES as readonly string[]).includes(incoming.type)) {
      console.warn(`[bus] routeIncoming: system "${to}" not found (may be reloading), dropping event "${incoming.type}"`);
    }
  }

  function processEvent(event: BackendEvents): void {
    options.onEvent?.(event);

    switch (event.type) {
      case 'INCOMING':
        routeIncoming(event.message);
        break;

      case 'OUTGOING':
        if (status === 'clientSeen') notifyOutgoing(event.message);
        break;

      case 'CLIENT_CONNECTED': {
        status = 'clientSeen';
        const clientLoaded = new Set<string>();
        for (const packId of clientLoadedPacks()) {
          for (const id of registry.getRegisteredPackSystemIds(packId)) clientLoaded.add(id);
        }
        const targets = [...systems().keys()].filter((id) => !clientLoaded.has(id));
        sendToRunning(targets, { type: 'CLIENT_CONNECTED' });
        askToPublish(targets);
        for (const message of options.connectedEvents?.() ?? []) {
          queue.push({ type: 'OUTGOING', message });
        }
        break;
      }

      case 'PACK_CLIENT_CONNECTED': {
        awaitingFrontends.delete(event.packId);
        const running = systems();
        const targets = registry.getRegisteredPackSystemIds(event.packId).filter((id) => running.has(id));
        sendToRunning(targets, { type: 'CLIENT_CONNECTED' });
        if (status === 'clientSeen') askToPublish(targets);
        break;
      }

      case 'PACK_CHANGED': {
        const running = [...systems().keys()];
        sendToRunning(running, { type: 'PACK_CHANGED', packId: event.packId });
        if (status === 'clientSeen') askToPublish(publishable(running, awaitingFrontends));
        break;
      }

      case 'DATA_REPLACED':
      case 'DATA_CHANGED_ELSEWHERE': {
        const running = [...systems().keys()];
        sendToRunning(running, event);
        if (status === 'clientSeen') askToPublish(publishable(running, awaitingFrontends));
        break;
      }

      case 'SYSTEMS_SPAWNED': {
        if (status !== 'clientSeen') break;
        sendToRunning(event.systemIds, { type: 'CLIENT_CONNECTED' });
        askToPublish(event.systemIds);
        break;
      }

      case 'RELOAD_PACK': {
        awaitingFrontends = awaiting(awaitingFrontends, event.packId);
        stopSystems(event.systemIds);
        const spawned = spawnSystems(event.systemIds, systems());
        if (spawned.length > 0 && !clientLoadedPacks().has(event.packId)) {
          queue.unshift({ type: 'SYSTEMS_SPAWNED', systemIds: spawned });
        }
        break;
      }

      case 'TEARDOWN_PACK': {
        const current = clientLoadedPacks();
        const nextAwaiting = new Set<string>();
        for (const id of awaitingFrontends) {
          if (current.has(id) && id !== event.packId) nextAwaiting.add(id);
        }
        awaitingFrontends = nextAwaiting;
        stopSystems(event.systemIds);
        if (event.afterStop) {
          queue.push({ type: 'SYSTEMS_STOPPED', afterStop: event.afterStop });
        }
        break;
      }

      case 'SYSTEMS_STOPPED': {
        event.afterStop();
        break;
      }

      case 'ACTIVATE_PACK': {
        awaitingFrontends = awaiting(awaitingFrontends, event.packId);
        const spawned = spawnSystems(event.systemIds, systems());
        if (spawned.length > 0 && !clientLoadedPacks().has(event.packId)) {
          queue.unshift({ type: 'SYSTEMS_SPAWNED', systemIds: spawned });
        }
        break;
      }
    }
  }

  function send(event: BackendEvents | StateEvent): void {
    if (status === 'stopped') return;
    queue.push(event as BackendEvents);
    drain();
  }

  const bus: BackendBus = {
    system: sys,
    port: sys.port,
    get status() {
      return status;
    },
    start() {
      if (status !== 'stopped') return bus;
      status = 'awaitingClient';
      awaitingFrontends = new Set(clientLoadedPacks());

      // Attach down-port for surface broadcasts and named peers for bus/role routing
      detaches.push(
        sys.attach({
          tell: (to, event) => {
            if (isStopped()) return;
            const receiver = _currentDelivery()?.receiver;
            const packId = receiver ? splitRef(receiver)?.packId : undefined;
            deliverOutgoingFromFlush({
              type: 'OUTGOING',
              message: {
                to,
                event: event as StateEvent,
                ...(packId !== undefined ? { from: packId } : {}),
                ...(receiver !== undefined ? { sender: receiver } : {}),
                call: newCall(),
              },
            });
          },
          ask: (_to, _name, _args, _progress, done) => {
            done({ ok: false, failure: { kind: 'unavailable', message: 'Backend systems cannot ask a window' } });
            return () => {};
          },
          follow: (_feature, _view, _args, _updated, failed) => {
            failed({ kind: 'unavailable', message: 'Backend systems cannot follow a window view' });
            return { stop: () => {} };
          },
        }),
        sys.attach('bus', {
          tell: (_peer, event) => {
            if (status === 'stopped') return;
            enqueueFromFlush(event as BackendEvents);
          },
        }),
        ...ROLE_PEERS.map((peer) =>
          sys.attach(peer, {
            tell: (name, event) => {
              if (status === 'stopped') return;
              const role = name.slice('role:'.length);
              const target = registry.designation?.(role);
              if (!target) return;
              const receiver = _currentDelivery()?.receiver;
              enqueueFromFlush({
                type: 'INCOMING',
                message: {
                  to: target,
                  event: event as StateEvent,
                  ...(receiver !== undefined ? { sender: receiver } : {}),
                  call: newCall(),
                },
              });
            },
          }),
        ),
      );

      // Listen before starting systems so sends made during startup are captured
      stopListening = options.listen((event) => send(event));

      const machines = systems();
      withDrain(() => {
        spawnSystems([...machines.keys()], machines);
      });
      return bus;
    },
    stop() {
      if (status === 'stopped') return;
      status = 'stopped';
      stopListening?.();
      stopListening = undefined;
      queue.length = 0;
      handles.clear();
      sys.stop();
      for (const detach of detaches) detach();
      detaches.length = 0;
    },
    send,
    getSystem: (id) => handles.get(id),
    read: (id) => readSystem(id),
    onError: (listener) => {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },
  };

  return bus;
}
