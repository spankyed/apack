import { withActorContext } from '../diagnostics/actors.ts';
import { carrySettingsRequest } from '../features/settings/be/access.ts';
// The backend bus: spawns the registered systems, routes client events to them and their events to
// clients. The app composes it with its event sources and client sink (createAppBus, app-bus.ts); the pack
// test harness runs the same machine with a recording sink.
import { enqueueActions, fromCallback, setup, spawnChild, type AnyActorRef, type AnyActorLogic, type AnyStateMachine } from 'xstate';
import { reportError } from '@apackdev/sdk/logger';
import { HOST } from '../refs.ts';
import { deliverAs } from './delivery.ts';
import { SYSTEM_EVENT_TYPES } from '@apackdev/sdk/framework';
import { SURFACE_EVENT_TYPES, _callOn, senderSuffix, type Message } from '@apackdev/sdk/events';
import type { PackRegistry } from '../packs/registry.ts';


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
/** Raised after restarting a pack's systems, once they're in the actor system and can receive events */
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
  | SystemsSpawnedEvent
  | { type: 'SYSTEMS_STOPPED'; afterStop(): void };

/** The events a bus source can feed it: OUTGOING for sends to surfaces from outside a system (`broadcastToSurface`) */
export type BusSourceEvent = Extract<BackendEvents, { type: 'INCOMING' | 'OUTGOING' | 'CLIENT_CONNECTED' | 'PACK_CLIENT_CONNECTED' }>;

export interface BusOptions {
  /** The registered packs whose systems the bus runs */
  registry: Pick<PackRegistry, 'getRegisteredSystems' | 'getRegisteredPackSystemIds' | 'getSurfaceEventValidationMap' | 'getEventValidationMap'>;
  /** The systems the bus runs, by id; defaults to every system in `registry` */
  systems?(): ReadonlyMap<string, AnyStateMachine>;
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
}

type ActorSystemLike = { get(id: string): { send(event: { type: string }): void } | undefined };

/** Sends an event to each of `systemIds` that is running; a system that isn't started just doesn't get it */
function sendToRunning(system: ActorSystemLike, systemIds: Iterable<string>, event: { type: string; [key: string]: unknown }): void {
  for (const id of systemIds) system.get(id)?.send(event);
}

/**
 * Asks each system to publish its state.
 *
 * Every cause ends here — a client connected, a pack changed, the data was replaced, systems were spawned —
 * because all a system has to do about any of them is say what it holds now. It is asked *after* the fact
 * that caused it, so a system can drop work held over rows that are gone before it describes itself.
 */
function askToPublish(system: ActorSystemLike, systemIds: Iterable<string>): void {
  for (const id of systemIds) {
    const actor = system.get(id);
    if (actor) actor.send({ type: 'SEND_STATE' });
    else console.warn(`[bus] SEND_STATE: system "${id}" isn't running`);
  }
}

/**
 * Whether a client has ever connected.
 *
 * Nothing is asked to publish before one has: a publish is real work (the settings fan out to every feature,
 * the code system wakes four children) and the bus drops outgoing sends until then anyway. Nothing is missed,
 * because entering `clientSeen` asks every system.
 */
const listening = (bus: { getSnapshot(): { matches(state: string): boolean } }): boolean =>
  bus.getSnapshot().matches('clientSeen');

/**
 * Spawns each of `systemIds` the bus runs; returns those it spawned. Each is spawned under its own id as
 * well as its system id: the id is the key the bus tracks the child by, so without one every system (and
 * the `listen` actor) shares a key, the bus holds only the last one spawned, and stopping the bus stops
 * that one alone — the rest keep running.
 */
function spawnSystems(
  enqueue: unknown,
  machines: ReadonlyMap<string, AnyStateMachine>,
  systemIds: readonly string[],
): string[] {
  // XState types `id` from the machine's declared children, and the bus's are whatever is registered
  const spawner = enqueue as { spawnChild(machine: AnyActorLogic, options: { id: string; systemId: string }): void };
  const spawned = systemIds.filter((id) => machines.has(id));
  for (const id of spawned) spawner.spawnChild(withActorContext(machines.get(id)!), { id, systemId: id });
  return spawned;
}

/** Systems are spawned by system id only, so they're stopped by reference */
function stopSystems(
  enqueue: { stopChild(actor: AnyActorRef): void },
  system: { get(id: string): AnyActorRef | undefined },
  systemIds: readonly string[],
  afterStop?: () => void,
): void {
  const actors = [...new Set(systemIds)].flatMap(id => {
    const actor = system.get(id);
    return actor && actor.getSnapshot().status === 'active' ? [actor] : [];
  });
  let remaining = actors.length;
  if (remaining === 0) afterStop?.();
  for (const actor of actors) {
    let stopped = false;
    const complete = () => {
      if (stopped) return;
      stopped = true;
      if (--remaining === 0) afterStop?.();
    };
    // stopChild defers actual stop; authority must survive queued work and callback cleanup.
    if (afterStop) actor.subscribe({ complete, error: complete });
    enqueue.stopChild(actor);
  }
}

/** A bus machine; start it with systemId `HOST.bus`, which the host's own systems reach it by (the `packs` system) */
export function createBusMachine(options: BusOptions) {
  // Every lookup of what the bus runs goes through this, so a bus given a subset never reaches past it
  const { registry } = options;
  const systems = options.systems ?? registry.getRegisteredSystems;
  const clientLoadedPacks = () => new Set(options.clientLoadedPacks?.() ?? []);
  function awaiting(previous: ReadonlySet<string>, packId: string): Set<string> {
    const next = new Set(previous);
    if (clientLoadedPacks().has(packId)) next.add(packId); else next.delete(packId);
    return next;
  }
  function publishable(ids: string[], awaitingFrontends: ReadonlySet<string>): string[] {
    const pending = new Set([...awaitingFrontends].flatMap(id => registry.getRegisteredPackSystemIds(id)));
    return ids.filter(id => !pending.has(id));
  }
  /**
   * The drops already reported, keyed by surface, event type and sender, so each is reported once per bus.
   *
   * Reporting a drop logs it, and a log event becomes a send to the logs surface (default-setup's logs
   * system forwards it as LOG_ADDED). When the surface being dropped is that one, reporting a drop
   * produces another droppable send, and the cycle feeds itself.
   *
   * It feeds itself through the actor's queue rather than the call stack — the send arrives as a fresh
   * OUTGOING event, not a nested call — so it shows up as an app that stops responding rather than a
   * stack overflow, and nothing that reasons about re-entrancy within one transition can see it.
   * Reporting each pair once bounds it whatever the timing, keeps the first of every distinct problem,
   * and independently stops a misbehaving pack from flooding the log.
   *
   * Scoped to the machine, not the module: a test app's drops are its own.
   */
  const reportedDrops = new Set<string>();
  return setup({
    types: {
      events: {} as BackendEvents,
      context: {} as { awaitingFrontends: Set<string> },
    },
    actors: {
      listen: fromCallback<BackendEvents>(({ sendBack }) => options.listen(sendBack)),
    },
    actions: {
      // Its own id, so it doesn't share a key with the systems spawned beside it
      listen: spawnChild('listen', { id: 'bus-listen' }),
      notify: ({ event }) => {
        if (event.type !== 'OUTGOING') return;
        // The counterpart of receiveClientEvent: a client's event is checked against what a system
        // accepts, and a system's event against what the surface receives. Reported and dropped rather
        // than thrown — the caller is a running system, and a malformed message must not take it down.
        // takeSystemErrors fails any pack test that leaves one, so this is loud where it should be.
        const { to: surfaceId, event: { type } } = event.message;
        // Who sent it, when the send stamped it: the pack (`defineEvents`) and what within it (an action's
        // `action:<label>`). `reportError` sends for a caller that is neither, so a drop that names no sender is
        // not thereby suspicious — it just has one fewer clue in it.
        const sender = senderSuffix(event.message);
        // Four senders reach this one path — `untypedBroadcastToSurface`, the generated `broadcastToSurface`,
        // `sendToWindow` and `reply` — and a `reply` caller named no id: the address came off the envelope,
        // which is the point of the verb, so telling it to "check the id" sends the next reader to look at a
        // call site that has none. So the wording varies by this, and the report carries it as its own field.
        //
        // **Not as a third `operation` value, which was tried and regressed.** `operation` says which verb,
        // and two readers filter on it to mean *direction*: `undeclared-incoming.spec.ts` separates this
        // function's reports from `routeIncoming`'s, and `@apackdev/testing`'s fixture collects these to fail a
        // test on a dropped send. Making it `answering ? 'reply' : 'broadcastToSurface'` left that fixture
        // filtering for one value while this sent two, so a dropped answer stopped failing any Playwright
        // test — silently, there being no case over the fixture. Two facts, two fields.
        const answering = event.message.answering !== undefined;
        const accepted = options.registry.getSurfaceEventValidationMap().get(surfaceId);
        const reportDrop = (message: string) => {
          // Keyed on what the report says rather than on a second reading of the envelope, so whatever the
          // message distinguishes the dedupe distinguishes, and a suppressed drop is never one the report names
          // differently — which is why `answering` is in the key now that it changes the wording
          const pair = `${surfaceId}/${type}/${sender}/${answering}`;
          if (reportedDrops.has(pair)) return;
          reportedDrops.add(pair);
          // `diagnostic`: logged, recorded, and failing any pack test that leaves one — but no toast.
          // Whoever is using the app can do nothing about a send to a surface nobody declares, and the
          // message already reaches the Logs surface, where the person who can is looking.
          reportError({ source: 'bus', operation: 'broadcastToSurface', ...(answering ? { answering } : {}), severity: 'diagnostic', error: new Error(message) });
        };
        if (accepted === undefined) {
          // A name a connection claimed rather than a pack registering it (`host/drive`). No pack describes it, so
          // there is no declared event list to check against — what it is sent reaches it, addressed to the
          // connection holding the name. An answer already carries that connection; a send made cold takes it from
          // here, which is what makes such a participant addressable by name and not merely replyable to.
          const claimed = options.participantClient?.(surfaceId);
          if (claimed !== undefined) {
            options.onOutgoing({ ...event.message, client: event.message.client ?? claimed });
            return;
          }
          // An event every surface takes (a feature's settings changing) is the feature's surface's if it has one
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
        options.onOutgoing(event.message);
      },
      routeIncoming: ({ event, system }) => {
        /**
         * Reports a send to a system that declares no such event, which XState would otherwise ignore in
         * silence — delivered, dropped by the machine, nothing said.
         *
         * **This is the net for `untypedSendToSystem`**, and the asymmetry it closes is between the two
         * untyped twins rather than between typed and untyped: `untypedBroadcastToSurface` has always been
         * checked here on the way out (`notify`), while its inward mirror was not. The facade's
         * `sendToSystem` and a handler's `reply` are both typed against a contract, so what is left for a
         * runtime check is exactly the hatch — host code, tooling, a target or an event that arrives as
         * data.
         *
         * Measured 2026-10-06, no send in either unit pool trips it: this nets the hatch rather than
         * fixing a live defect, and the case that fires it is written rather than found.
         *
         * Reported and dropped-through rather than thrown, as the outgoing side does: the caller is a
         * running system and a malformed message must not take it down. The event is still delivered —
         * the machine ignoring it is the existing behaviour, and refusing it here would be a second
         * decision about the same message.
         */
        const reportUndeclared = (to: string, type: string, message: Message) => {
          const accepted = options.registry.getEventValidationMap().get(to);
          // No entry is a system nothing registered, which `routeIncoming` already warns about below; a `*`
          // accepts any type, and the events every system takes are the SDK's rather than a pack's to declare
          if (accepted === undefined || accepted.has('*') || accepted.has(type)) return;
          if ((SYSTEM_EVENT_TYPES as readonly string[]).includes(type)) return;
          const sender = senderSuffix(message);
          // As on the outgoing side: `reply` and `sendToSystem` both land here, and advice to fix a target sends
          // the next reader to a call site with none in it. Its own field rather than an `operation` value, for
          // the reason the outgoing side records — the helper in `undeclared-incoming.spec.ts` filters on
          // `operation` to mean "the reports this function made", and a second value there takes that away. In
          // the key because the wording varies by it, so the dedupe must too.
          const answering = message.answering !== undefined;
          const pair = `${to}/${type}/${sender}/${answering}`;
          if (reportedDrops.has(pair)) return;
          reportedDrops.add(pair);
          reportError({
            source: 'bus',
            operation: 'sendToSystem',
            ...(answering ? { answering } : {}),
            severity: 'diagnostic',
            error: new Error(answering
              ? `Answered "${type}"${sender} to the "${to}" system, which declares no such event — it will be ignored. \`reply\` is typed against the answering side's outgoing events and cannot be checked against the asking system's incoming, so this compiles: either "${to}" must declare "${type}" among its contract's incoming events, or the answer has to be an event it already declares.`
              : `Sent "${type}"${sender} to the "${to}" system, which declares no such event — it will be ignored. A system receives what its contract's incoming events declare: add it there, or send an event the system handles.`),
          });
        };

        if (event.type !== 'INCOMING') return;
        const { to, event: incoming, sender, client, call } = event.message;
        const actor = system.get(to);
        // Delivered inside a scope naming the message, so the system can answer its sender with `reply` and a
        // send it makes while handling carries its own ref.
        //
        // **The event gains one reserved key and nothing else**: the call it belongs to, which a guard reads
        // through `answersCall` or `settleCall`. The distinction that allows it is between an address and a
        // call — an *address* on the event would decide where things go, which is forbidden, while a call
        // decides nothing, routes nothing, and has the receiver as its only reader. It is on the event because
        // a transition guard is handed `{ context, event }` and nothing else, and context cannot be written
        // before a guard runs, so the event is the only channel to one.
        if (actor) {
          reportUndeclared(to, incoming.type, event.message);
          const delivered = { ...incoming, ..._callOn(event.message) };
          carrySettingsRequest(incoming, delivered);
          deliverAs({ to, sender, client, call, diagnostics: event.message.diagnostics }, delivered, () => actor.send(delivered));
        }
        // An event every system accepts (a feature's settings changing) is the feature's system's if it runs one
        else if (!(SYSTEM_EVENT_TYPES as readonly string[]).includes(incoming.type)) {
          console.warn(`[bus] routeIncoming: system "${to}" not found (may be reloading), dropping event "${incoming.type}"`);
        }
      },
      sendConnected: ({ system }) => {
        const clientLoaded = new Set<string>();
        for (const packId of clientLoadedPacks()) {
          for (const id of registry.getRegisteredPackSystemIds(packId)) clientLoaded.add(id);
        }
        const targets = [...systems().keys()].filter((id) => !clientLoaded.has(id));
        sendToRunning(system, targets, { type: 'CLIENT_CONNECTED' });
        askToPublish(system, targets);
        for (const message of options.connectedEvents?.() ?? []) system.get(HOST.bus).send({ type: 'OUTGOING', message });
      },
      sendPackConnected: enqueueActions(({ event, context, system, self, enqueue }) => {
        if (event.type !== 'PACK_CLIENT_CONNECTED') return;
        const awaitingFrontends = new Set(context.awaitingFrontends);
        awaitingFrontends.delete(event.packId);
        enqueue.assign({ awaitingFrontends });
        const running = systems();
        const targets = registry.getRegisteredPackSystemIds(event.packId).filter((id) => running.has(id));
        sendToRunning(system, targets, { type: 'CLIENT_CONNECTED' });
        if (listening(self)) askToPublish(system, targets);
      }),
      // Every system, not just the changed pack's: what a pack registers and content is read by others
      // (its slash commands by the chat, say)
      sendPackChanged: ({ event, context, system, self }) => {
        if (event.type !== 'PACK_CHANGED') return;
        const running = [...systems().keys()];
        sendToRunning(system, running, { type: 'PACK_CHANGED', packId: event.packId });
        if (listening(self)) askToPublish(system, publishable(running, context.awaitingFrontends));
      },
      sendDataReplaced: ({ context, system, self }) => {
        const running = [...systems().keys()];
        sendToRunning(system, running, { type: 'DATA_REPLACED' });
        if (listening(self)) askToPublish(system, publishable(running, context.awaitingFrontends));
      },
      sendSpawnedConnected: ({ event, system }) => {
        if (event.type !== 'SYSTEMS_SPAWNED') return;
        sendToRunning(system, event.systemIds, { type: 'CLIENT_CONNECTED' });
        askToPublish(system, event.systemIds);
      },
      spawnActors: enqueueActions(({ enqueue }) => {
        const machines = systems();
        spawnSystems(enqueue, machines, [...machines.keys()]);
      }),
      reloadPack: enqueueActions(({ enqueue, event, context, system }) => {
        if (event.type !== 'RELOAD_PACK') return;
        enqueue.assign({ awaitingFrontends: awaiting(context.awaitingFrontends, event.packId) });
        // Stopping releases each system's id and its children's, so the fresh copies claim them here
        stopSystems(enqueue, system, event.systemIds);
        // Startup requests wait for acceptance of the fresh frontend; pack facts still reach its systems.
        const spawned = spawnSystems(enqueue, systems(), event.systemIds);
        if (spawned.length > 0 && !clientLoadedPacks().has(event.packId)) enqueue.raise({ type: 'SYSTEMS_SPAWNED', systemIds: spawned });
      }),
      teardownPack: enqueueActions(({ enqueue, event, context, system, self }) => {
        if (event.type !== 'TEARDOWN_PACK') return;
        const current = clientLoadedPacks();
        enqueue.assign({ awaitingFrontends: new Set([...context.awaitingFrontends].filter(id => current.has(id) && id !== event.packId)) });
        const afterStop = event.afterStop;
        // Drain already queued sends before revoking the inboxes they were sent to.
        stopSystems(enqueue, system, event.systemIds, afterStop && (() => self.send({ type: 'SYSTEMS_STOPPED', afterStop })));
      }),
      activatePack: enqueueActions(({ enqueue, event, context }) => {
        if (event.type !== 'ACTIVATE_PACK') return;
        enqueue.assign({ awaitingFrontends: awaiting(context.awaitingFrontends, event.packId) });
        const spawned = spawnSystems(enqueue, systems(), event.systemIds);
        // A pack whose frontend a client loads next gets CLIENT_CONNECTED when the client asks for it
        // (PACK_CLIENT_CONNECTED), once its surface actors can receive the data; any other sends it now
        if (spawned.length > 0 && !clientLoadedPacks().has(event.packId)) {
          enqueue.raise({ type: 'SYSTEMS_SPAWNED', systemIds: spawned });
        }
      }),
    },
  }).createMachine({
    id: HOST.bus,
    // A client connection is only what frontend surfaces need: sends to surfaces are held back until one has
    // connected, and systems send their startup data when one does. Nothing tells the bus a client left (a
    // reconnecting client connects again and gets the startup data), so `clientSeen` means "a client has
    // connected since the bus started", not "one is connected now".
    initial: 'awaitingClient',
    context: () => ({ awaitingFrontends: new Set(clientLoadedPacks()) }),
    // Listening first: a system sends as it starts (a surface's report, another system's event), and what it sends
    // before the bus hears the root events is lost
    entry: ['listen', 'spawnActors'],
    // A pack can be installed, uninstalled or rebuilt before any client connects (`apack pack dev` against a
    // running backend, a headless boot), so these apply in both states: handled only once a client connected,
    // the pack's systems would be left as they were with nothing reported. Events for systems don't wait for a
    // client either: systems, steps and schedules send them (`sendToSystem`, `fire`, schedule ticks) from boot.
    on: {
      INCOMING: { actions: 'routeIncoming' },
      RELOAD_PACK: { actions: 'reloadPack' },
      TEARDOWN_PACK: { actions: 'teardownPack' },
      SYSTEMS_STOPPED: { actions: ({ event }) => event.afterStop() },
      ACTIVATE_PACK: { actions: 'activatePack' },
      PACK_CLIENT_CONNECTED: { actions: 'sendPackConnected' },
      PACK_CHANGED: { actions: 'sendPackChanged' },
      DATA_REPLACED: { actions: 'sendDataReplaced' },
    },
    states: {
      awaitingClient: {
        on: {
          CLIENT_CONNECTED: { target: 'clientSeen' },
          // SYSTEMS_SPAWNED is deliberately not handled here: with no client to send startup data to,
          // the systems just spawned get their CLIENT_CONNECTED from `sendConnected` when one arrives
        },
      },
      clientSeen: {
        entry: 'sendConnected',
        on: {
          CLIENT_CONNECTED: { actions: 'sendConnected' },
          OUTGOING: { actions: 'notify' },
          SYSTEMS_SPAWNED: { actions: 'sendSpawnedConnected' },
        },
      },
    },
  });
}
