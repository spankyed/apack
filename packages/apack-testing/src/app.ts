// A test app: the pack's registered systems under the app's bus core, with a client the test drives.
import { createActor, type Actor, type AnyActorRef, type AnyStateMachine } from 'xstate';
import { createBusMachine, HOST } from '@apackdev/host/bus';
import { resolveName, resolveRegistered } from '@apackdev/sdk/ids';
import type { PackLifecycleHooks, PackRegistration, ViewRequest, ViewUpdate } from '@apackdev/sdk/framework';
import { createViewHost } from '@apackdev/host/views';
import { boundEars } from '@apackdev/sdk/ears';
import { newCall, type Message } from '@apackdev/sdk/events';
import { testRootEvents, testRunHistory } from '@apackdev/sdk/testing';
import type { RunNodeId } from '@apackdev/sdk/services';
import { untypedQuery } from '@apackdev/sdk/ears';
import { getDesignated, hasDesignation } from '@apackdev/sdk/designations';
import { stepRegistry } from '@apackdev/sdk/steps';
import { errorMessage } from '@apackdev/sdk/utils/pure';
import { bindSettingsRequest } from '@apackdev/host/settings';
import type { SettingsAdmin, SettingsService } from '@apackdev/sdk/services';

export type { Message };

/** An event a surface receives, exactly as the system that sent it wrote it */
export type SurfaceEvent = Message['event'];

/** Explicit test-fixture authority; never serialized or inferred from sender/client labels. */
export type TestSettingsAccess =
  | { kind: 'host'; service: SettingsAdmin }
  | { kind: 'pack'; service: SettingsService };

export interface StartAppOptions {
  /**
   * Registered systems to run, named as `sendToSystem` names them: the pack's own by feature id, a
   * dependency's as `<packId>/<featureId>` (full bus ids work too), or `'*'` for all.
   */
  systems: readonly string[] | '*';
}

/** A step a flow ran: its node in the run history (`services.runHistory`) */
export interface FlowRunStep {
  runNodeId: string;
  label: string;
  /** `step` or `flow` (a subflow) */
  kind: string;
  status: string;
  /**
   * What the step was given — its settings, with what it mapped from the event and earlier steps — as its run node
   * records it: bounded, so a long value is a `{ value, _truncated }` marker
   */
  input: Record<string, unknown>;
  /** What the step returned, once it ran, or `{ error }` when it failed */
  result?: unknown;
}

export interface RunFlowOptions {
  /** The event to send, as a client sends one to the brain; without one, the entry tracks the flow ran when it started */
  event?: string;
  /** The event's payload */
  data?: unknown;
  timeoutMs?: number;
}

export interface FlowRun {
  /** The run nodes of the flow's tracks the event triggered */
  eventRunNodeIds: string[];
  /** The steps those tracks ran, in the order they started */
  steps: FlowRunStep[];
}

/** One subscription to a view, as a window's `useView` holds it */
export interface TestView<Result = unknown> {
  /** Every update delivered so far, in order: results, and errors from a view that threw or a pack that isn't running */
  readonly updates: ReadonlyArray<ViewUpdate<Result>>;
  /** The next update after those an earlier `next` returned, waiting for it if needed (5 s by default) */
  next(options?: { timeoutMs?: number }): Promise<ViewUpdate<Result>>;
  /** Unsubscribes, as a window's component unmounting does; the app stopping does it too */
  stop(): void;
}

export interface TestApp {
  /** Sends CLIENT_CONNECTED, as a client connecting does; systems send their startup data */
  connect(): Promise<void>;
  /**
   * Sends a system an event, as a client's `sendToSystem` does (the pack's own by feature id, a dependency's as
   * `<packId>/<featureId>`); the bus routes it whether or not a client connected.
   *
   * `sender` is who the system should answer, and a handler that calls `reply` needs it: a real send carries one
   * because it is made while handling something else (`createSends` reads the delivery in scope), and a send
   * made from here carries nothing unless it is given. Without it `reply` throws "named no sender", so a pack
   * test could not drive such a handler at all.
   *
   * `client` says the ask arrived on a connection, which is what decides where `reply` sends the answer: with
   * one, the asker is a surface in a window or a claimed participant and the answer goes to that connection
   * alone; without one, the ask originated in the backend and the answer goes to the asking *system*. A real
   * client's send always carries one (the API stamps it per socket), and nothing sent from here does unless it
   * is given — so a spec standing in for a window or a driver passes one, and a spec standing in for a system
   * does not. Any non-empty string: nothing here routes on its value, only on whether there is one, and `''`
   * is refused because it would claim a connection while naming none.
   *
   * `call` is the call to ask under, and **the returned value is the call this ask was sent under** — given
   * one it is that, given none it is the one minted here, exactly as `sendToSystem` behaves. Pass it to
   * `nextEmit`'s `answering` to wait for the answer to *this* ask, which is what a correlation spec asserts;
   * a test with one ask in flight can ignore both and read the answer by type alone.
   */
  send(
    systemId: string,
    event: { type: string; [key: string]: unknown },
    options?: { sender?: string; client?: string; call?: string; settingsAccess?: TestSettingsAccess },
  ): Promise<string>;
  /**
   * The events delivered to one frontend surface (by `broadcastToSurface`, once connected), in order, exactly as
   * sent; the surface named as the pack names it (its own by feature id, any other as `<packId>/<featureId>`).
   * Readable after `stop`
   */
  emitted(surface: string): SurfaceEvent[];
  /**
   * The next event of `type` sent to `surface` (named as in `emitted`) that no earlier `nextEmit` returned,
   * waiting for it if needed.
   *
   * With `answering`, only an answer to that call counts — `Message.answering`, which `reply` stamps and
   * which is on the envelope rather than the event, so this is the only way a pack test can see it. Use it
   * wherever a spec has two asks in flight, or asserts that an answer named the right one; the timeout
   * message names what each candidate answered, so a mismatch reads as a mismatch rather than as silence.
   */
  nextEmit(surface: string, type: string, options?: { timeoutMs?: number; answering?: string }): Promise<SurfaceEvent>;
  /** Resolves once the actors have no queued work left (zero-delay raises and settled promises included) */
  settle(): Promise<void>;
  /**
   * Runs an event through a running flow on the brain (the app's designated `brain` and `settings` systems must be
   * running), as the app does: the brain runs the root flow (`root: true`) and the subflows it spawns, and an event
   * reaches every running flow. Resolves once every track of the flow labelled `label` that the event triggered
   * has finished: its steps completed or failed, apart from steps that wait by design (keep-alive) and subflows
   * left only waiting. Without `event`, resolves with the entry tracks the flow ran when it started.
   *
   * It returns the tracks the event itself triggered. Tracks started by events those tracks send (a `fire` step,
   * a `TRIGGER_BRAIN_EVENT` sent to the brain's role) aren't in the result: `settle()` after it, then read them with `flowSteps`. It doesn't
   * connect the app: flows run and report without a client, as they do in the app.
   */
  runFlow(label: string, options?: RunFlowOptions): Promise<FlowRun>;
  /** The steps a flow (the root flow or a subflow, by label) has run so far in this app. Readable after `stop` */
  flowSteps(label: string): FlowRunStep[];
  /** A running system's actor */
  system(systemId: string): AnyActorRef;
  /**
   * Subscribes to a feature's view as a window does (`useView`), the feature named as `sendToSystem` names a
   * system. Each call is its own subscriber, so two of them stand in for two windows; subscribers asking for the
   * same view with the same arguments share one watch, as the app's do. Ended when the app stops.
   */
  watchView<Result = unknown>(feature: string, view: string, args?: unknown): TestView<Result>;
  /** How many distinct views are being watched in this test file, and how many subscriptions share them */
  viewStats(): { views: number; subscriptions: number };
  /**
   * Stops the systems and ends pending `nextEmit`/`runFlow` waits with an "app stopped" error; later calls (`connect`,
   * `send`, `nextEmit`, `settle`, `runFlow`, `system`) fail with it too. Once no app runs, it runs each registered
   * pack's `lifecycle.onShutdown`, as the app does when it stops a pack, so state its modules keep outside the stopped
   * actors (schedules, listeners) doesn't reach the next test. The harness stops apps after each test.
   */
  stop(): void;
}

/** What test apps read of the test file's registered packs (host's PackRegistry, which the published declarations can't name) */
interface AppPacks {
  getLifecycleHooks(): PackLifecycleHooks[];
  getRegisteredSystems(): Map<string, AnyStateMachine>;
  getRegisteredPackSystemIds(packId: string): string[];
  /** What each surface receives, so a test app drops a send no surface declares, as the app does */
  getSurfaceEventValidationMap(): Map<string, Set<string>>;
  /** And what each system accepts, so a send a system declares no event for is reported rather than ignored */
  getEventValidationMap(): Map<string, Set<string>>;
  /** What a view's code is, which the view host reads and follows */
  getPackRegistration(packId: string): PackRegistration | null;
  onRegistrationChanged(listener: (packId: string) => void): () => void;

}

const running = new Set<TestApp>();
let registry: AppPacks | undefined;
let packId: string | undefined;
/** What the harness uses of the host's view host, in published types: the declarations can't name `@apackdev/host` */
interface TestViews {
  watch(request: ViewRequest, observer: (update: ViewUpdate) => void): () => void;
  stats(): { views: number; subscriptions: number };
  close(): void;
}
let views: TestViews | undefined;

/** @internal The harness sets the registry apps run the systems of, and the pack's id, which its bare system ids map with */
export function setAppPacks(packs: AppPacks, id?: string): void {
  views?.close();
  registry = packs;
  packId = id;
  // The test file's views, on whichever engine is bound when each starts: a test's reset binds a fresh one
  views = createViewHost({ ears: boundEars, packs });
}

/** @internal The test file's views, which apps and the harness's shell subscribe to as the app's windows do */
export function testViews(): TestViews {
  packs();
  return views!;
}

function packs(): AppPacks {
  if (!registry) throw new Error('Call setupPackTests() from a vitest setup file before startApp()');
  return registry;
}

/** @internal The harness stops apps a test left running; throws once all stopped if a pack's shutdown failed */
export function stopRunningApps(): void {
  const failures: unknown[] = [];
  for (const app of running) {
    try {
      app.stop();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Stopping the test apps failed');
}

const describeError = (error: unknown) => errorMessage(error);

/**
 * Runs each registered pack's `lifecycle.onInit` in registration order (dependencies first), as the API does at boot
 * before it starts the systems. The first app of a test starts the packs and the last one to stop shuts them down,
 * so each test's apps run between one onInit and one onShutdown.
 */
function startPacks(): void {
  for (const lifecycle of packs().getLifecycleHooks()) {
    try {
      lifecycle.onInit?.();
    } catch (error) {
      // As a failed boot: no app runs, so shut the packs down again for the next start
      let shutdown = '';
      try {
        shutDownPacks();
      } catch (shutdownError) {
        shutdown = ` Shutting the packs down after it failed too: ${describeError(shutdownError)}`;
      }
      throw new Error(`A pack's lifecycle.onInit failed when the test app started: ${describeError(error)}.${shutdown}`, { cause: error });
    }
  }
}

/** Runs each registered pack's `lifecycle.onShutdown`, as the app does when it stops a pack's systems */
function shutDownPacks(): void {
  const failures: string[] = [];
  for (const lifecycle of packs().getLifecycleHooks()) {
    try {
      lifecycle.onShutdown?.();
    } catch (error) {
      failures.push(describeError(error));
    }
  }
  if (failures.length > 0) throw new Error(`A pack's lifecycle.onShutdown failed when the test app stopped:\n  ${failures.join('\n  ')}`);
}

/** The registered system a name stands for, as the pack under test's `sendToSystem` resolves it */
const resolveSystemId = (name: string, registered: ReadonlyMap<string, AnyStateMachine>): string =>
  resolveRegistered('system', name, { packId, registered: [...registered.keys()] });

/**
 * The registered surface a name stands for, as the pack under test's own `broadcastToSurface` resolves it. A name no
 * surface is registered under throws at once, rather than leaving a wait for its events to time out.
 */
const resolveSurfaceId = (name: string): string =>
  resolveRegistered('surface', name, { packId, registered: [...packs().getSurfaceEventValidationMap().keys()] });

/** One event loop turn, after zero-delay timers already queued (xstate's `raise(…, { delay: 0 })`) */
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type RunNodeSpawned = SurfaceEvent & { type: 'RUN_NODE_SPAWNED'; runNode: { id: string; label?: string; kind?: string; eventType?: string }; flowRunNodeId: string; eventRunNodeId?: string };
type RunNodeUpdated = SurfaceEvent & { type: 'RUN_NODE_UPDATED'; data: { runNodeId: string; status: string } };

const isSpawn = (event: SurfaceEvent): event is RunNodeSpawned => event.type === 'RUN_NODE_SPAWNED';
const isUpdate = (event: SurfaceEvent): event is RunNodeUpdated => event.type === 'RUN_NODE_UPDATED';

/** A run node as the run history holds it: the brain keeps every node there, a finished run's included */
const readRunNode = (id: string) => testRunHistory().get(id as RunNodeId);

/** The label of the flow a flow node runs */
const flowLabelOf = (flowRunNodeId: string): string | undefined => {
  const flowId = readRunNode(flowRunNodeId)?.flowId;
  return flowId === undefined ? undefined : String((untypedQuery.ids(flowId).pickAll() as Array<{ label?: string }>)[0]?.label ?? flowId);
};

function runStep(spawned: RunNodeSpawned): FlowRunStep {
  const node = readRunNode(spawned.runNode.id);
  return {
    runNodeId: spawned.runNode.id,
    label: String(node?.label ?? spawned.runNode.label ?? ''),
    kind: String(node?.kind ?? spawned.runNode.kind ?? ''),
    status: String(node?.status ?? ''),
    input: node?.input ?? {},
    ...(node?.result !== undefined && { result: node.result }),
  };
}
const SETTLE_LIMIT = 1000;

/** Starts the named registered systems under the bus. The harness stops it after the test. */
export async function startApp(options: StartAppOptions): Promise<TestApp> {
  const registered = packs().getRegisteredSystems();
  // In registration order, as the app spawns them (a pack's settings system before the systems that use it)
  const named = options.systems === '*' ? undefined : new Set(options.systems.map((id) => resolveSystemId(id, registered)));
  const systems = named ? new Map([...registered].filter(([id]) => named.has(id))) : registered;

  const emitted: Message[] = [];
  const taken = new Set<number>();
  /** Pending waits for emitted events or run reports: each checks again on every event, and ends when the app stops */
  const waits = new Set<{ attempt(): boolean; end(error: Error): void }>();
  const wakeWaits = () => { for (const wait of waits) wait.attempt(); };
  /** The brain's run reports (RUN_NODE_SPAWNED, RUN_NODE_UPDATED), from its start: recorded before a client connects too */
  const reports: Array<RunNodeSpawned | RunNodeUpdated> = [];
  /** The label of the flow each reported node ran in, and of the flow each flow node runs (`flow:<id>`) */
  const flowLabels = new Map<string, string>();
  const record = (event: SurfaceEvent) => {
    if (!isSpawn(event) && !isUpdate(event)) return;
    reports.push(event);
    if (isSpawn(event)) {
      const flowLabel = flowLabelOf(event.flowRunNodeId);
      if (flowLabel !== undefined) flowLabels.set(event.runNode.id, flowLabel);
      if (event.runNode.kind === 'flow') {
        // A subflow's node carries its step's label: the flow it runs is its own label
        const subflowLabel = flowLabelOf(event.runNode.id);
        if (subflowLabel !== undefined) flowLabels.set(`flow:${event.runNode.id}`, subflowLabel);
      }
    }
    wakeWaits();
  };
  const stopRecording = [
    testRootEvents.onOutgoing((message) => {
      emitted.push(message);
      wakeWaits();
    }),
  ];

  const finished = (runNodeId: string) => reports.some((e) => isUpdate(e) && e.data.runNodeId === runNodeId && (e.data.status === 'completed' || e.data.status === 'failed'));
  const brainRunning = () => {
    const brainId = hasDesignation('brain') ? getDesignated('brain') : undefined;
    const brain = brainId === undefined ? undefined : bus.system.get(brainId);
    return (brain?.getSnapshot() as { matches(state: string): boolean } | undefined)?.matches('running') === true;
  };
  /** The running flows' run nodes and labels: the root flow's, and each subflow's not yet finished */
  /** The brain's session root: the newest root run still active */
  const rootRun = () => testRunHistory().findRuns().find((run) => run.parentId === undefined && run.status === 'active');
  const runningFlows = (): Array<{ runNodeId: string; label: string }> => [
    ...(brainRunning() && rootRun() ? [{ runNodeId: rootRun()!.id, label: flowLabelOf(rootRun()!.id) ?? '' }] : []),
    ...reports.filter(isSpawn).filter((e) => e.runNode.kind === 'flow' && !finished(e.runNode.id))
      .map((e) => ({ runNodeId: e.runNode.id, label: flowLabels.get(`flow:${e.runNode.id}`) ?? '' })),
  ];
  const runningFlowRunNodes = (label: string) => runningFlows().filter((flow) => flow.label === label).map((flow) => flow.runNodeId);
  const runningFlowLabels = () => runningFlows().map((flow) => flow.label);

  let activity = 0;
  let stopped = false;
  /** Whether the packs are up, so a start that failed before they were doesn't shut them down twice */
  let packsUp = false;
  const bus: Actor<ReturnType<typeof createBusMachine>> = createActor(createBusMachine({
    registry: packs(),
    systems: () => systems,
    onOutgoing: (event) => testRootEvents.emitOutgoing(event),
    listen: (send) => {
      const unsubscribes = [
        testRootEvents.onConnected(() => send({ type: 'CLIENT_CONNECTED' })),
        testRootEvents.onPackClientConnected((id) => send({ type: 'PACK_CLIENT_CONNECTED', packId: id })),
        testRootEvents.onIncoming((message) => send({ type: 'INCOMING', message })),
        testRootEvents.onSurfaceSend((message) => send({ type: 'OUTGOING', message })),
      ];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
  }), {
    systemId: HOST.bus,
    inspect: (inspection) => {
      activity++;
      // What systems send the bus for clients, connected or not
      if (inspection.type === '@xstate.event' && inspection.event.type === 'OUTGOING' && inspection.actorRef === (inspection.actorRef as AnyActorRef).system.get(HOST.bus)) {
        record((inspection.event as unknown as { message: Message }).message.event);
      }
    },
  });

  const stoppedError = () => new Error('The test app stopped (its test ended, or app.stop() ran) before this finished');
  /** The view subscriptions this app opened, which its stop ends */
  const watched = new Set<{ stop(): void }>();
  /** Resolves with what `check` finds once an event makes it find something; rejects when the app stops first */
  const waitForEmitted = <T>(check: () => T | undefined, timeoutMs: number, describe: () => string) => new Promise<T>((resolve, reject) => {
    if (stopped) return reject(stoppedError());
    const end = (settleWait: () => void) => {
      clearTimeout(timer);
      waits.delete(wait);
      settleWait();
    };
    const wait = {
      attempt: () => {
        const found = check();
        if (found === undefined) return false;
        end(() => resolve(found));
        return true;
      },
      end: (error: Error) => end(() => reject(error)),
    };
    const timer = setTimeout(() => wait.end(new Error(describe())), timeoutMs);
    if (!wait.attempt()) waits.add(wait);
  });

  /**
   * The app's calls still running: a stop ends them, and nobody need await one after that. A call made after the stop
   * rejects the same way, and is handled too, so `void app.nextEmit(…)` after it isn't an unhandled rejection.
   */
  const calls = new Set<Promise<unknown>>();
  const call = <T>(run: () => Promise<T>): Promise<T> => {
    if (stopped) {
      const rejected = Promise.reject(stoppedError());
      rejected.catch(() => {});
      return rejected;
    }
    const promise = run().finally(() => calls.delete(promise));
    calls.add(promise);
    return promise;
  };

  /** Settles, or throws `timedOut()` once `deadline` passes first */
  const settle = async (deadline = Infinity, timedOut?: () => string) => {
    for (let ticks = 0; ticks < SETTLE_LIMIT; ticks++) {
      if (timedOut && Date.now() > deadline) throw new Error(timedOut());
      const before = activity;
      await macrotask();
      if (activity === before) return;
    }
    throw new Error(`The app didn't settle after ${SETTLE_LIMIT} event loop turns: a system keeps sending events`);
  };

  /**
   * The one cause of "Sent: nothing" the failure message cannot otherwise show, appended when it applies.
   *
   * The bus handles `OUTGOING` only in `clientSeen`; in `awaitingClient` the event has no transition, so XState
   * discards it and nothing is logged, reported or recorded. Without this, a test whose system answered
   * correctly fails with an empty `Sent:` list and no way to tell "my handler never ran" from "my handler ran
   * and nobody was listening".
   *
   * Asked of the bus rather than tracked as a flag, because `CLIENT_CONNECTED` reaches every running bus — so
   * another app's `connect()` in the same test would set a flag on this one. The actor's own state is the
   * answer, read when the wait fails rather than when it started.
   */
  const heldForAClient = (): string => (bus.getSnapshot().value === 'awaitingClient'
    ? ' No client has connected, and the bus holds sends to surfaces until one does, so a reply had nowhere to go:'
      + ' `await app.connect()` before the send.'
    : '');

  const app: TestApp = {
    connect: () => call(async () => {
      testRootEvents.emitConnected();
      await settle();
    }),
    send: (systemId, event, options) => call(async () => {
      // Whether there is a `client` is the whole of what `reply` reads it for, which makes '' the one string
      // that lies: the field is present, so `reply` answers that connection, while the app delivers only to
      // the connection whose id matches (`api/src/transport/bus.ts`) and none is ever named ''. Refused rather
      // than passed, because the answer would otherwise be addressed to nobody and dropped in silence.
      if (options?.client === '') {
        throw new Error(
          "app.send was given client: '', which says the ask arrived on a connection and names none, so the "
          + 'reply would be addressed to nobody. Pass any non-empty name to stand in for a window or a driver, '
          + 'or leave it out to stand in for a system.',
        );
      }
      const sender = options?.sender === undefined ? {} : { sender: resolveSystemId(options.sender, systems) };
      // Unresolved: a connection id is not a ref
      const client = options?.client === undefined ? {} : { client: options.client };
      // Minted here when the caller gave none, so every ask a test makes carries one as every real send does —
      // a handler's `reply` then has a call to echo whether or not the spec cares which. Named `sentUnder`
      // rather than `call`, which is the enclosing helper this body runs inside
      const sentUnder = options?.call ?? newCall();
      const request = { ...event };
      const settingsAccess = options?.settingsAccess;
      if (settingsAccess) bindSettingsRequest(request, () => settingsAccess);
      testRootEvents.emitIncoming({ to: resolveSystemId(systemId, systems), event: request, call: sentUnder, ...sender, ...client });
      await settle();
      return sentUnder;
    }),
    emitted(surface) {
      const id = resolveSurfaceId(surface);
      return emitted.filter((message) => message.to === id).map((message) => message.event);
    },
    nextEmit: (surface, type, { timeoutMs = 5000, answering } = {}) => call(async () => {
      const id = resolveSurfaceId(surface);
      const wanted = answering === undefined ? '' : ` answering ${answering}`;
      // Named per send, since "a QUERY_RESULT arrived but answered something else" is the failure this option
      // exists to tell apart from "no QUERY_RESULT arrived", and only the envelope says which
      const describeSend = (m: Message) => `${m.to}:${m.event.type}${m.answering === undefined ? '' : ` answering ${m.answering}`}`;
      return waitForEmitted(() => {
        const index = emitted.findIndex((message, i) => !taken.has(i) && message.to === id && message.event.type === type
          && (answering === undefined || message.answering === answering));
        if (index === -1) return undefined;
        taken.add(index);
        return emitted[index].event;
      }, timeoutMs, () => `No ${type}${wanted} sent to ${id} within ${timeoutMs}ms. Sent: ${emitted.map(describeSend).join(', ') || 'nothing'}.${heldForAClient()}`);
    }),
    settle: () => call(() => settle()),
    runFlow: (label, { event, data, timeoutMs = 10_000 } = {}) => call(async () => {
      const brainId = hasDesignation('brain') ? getDesignated('brain') : undefined;
      if (!brainId || !systems.has(brainId)) {
        throw new Error("runFlow runs flows on the brain: start the app with the brain system, startApp({ systems: ['brain', …] })");
      }
      const flows = untypedQuery('Flow').pickAll() as Array<{ label?: string }>;
      if (!flows.some((flow) => flow.label === label)) {
        throw new Error(`No flow "${label}". Flows: ${flows.map((flow) => flow.label).join(', ') || 'none (apply the content first)'}`);
      }
      const flowRunNodeIds = runningFlowRunNodes(label);
      if (flowRunNodeIds.length === 0) {
        const runningLabels = [...new Set(runningFlowLabels())];
        const ranAndFinished = reports.some((e) => isSpawn(e) && e.runNode.kind === 'flow' && flowLabels.get(`flow:${e.runNode.id}`) === label);
        const why = ranAndFinished
          ? 'it ran and finished'
          : 'the brain runs the root flow (root: true) and the subflows running flows spawn: make it one of those, and import flows before startApp';
        throw new Error(`Flow "${label}" isn't running: ${why}. ${runningLabels.length > 0 ? `Running: ${runningLabels.join(', ')}` : 'No flow is running'}.`);
      }

      const eventType = event ?? 'flow.entry';
      const deadline = Date.now() + timeoutMs;
      // An event's tracks are the ones it triggers from here; entry tracks ran when the flow started
      const cursor = event === undefined ? 0 : reports.length;
      const since = () => reports.slice(cursor);
      const timedOut = () => `Flow "${label}" didn't finish "${eventType}" within ${timeoutMs}ms. Steps so far: ${since().filter(isSpawn).filter((e) => e.runNode.kind !== 'event' && flowRunNodeIds.includes(e.flowRunNodeId)).map((e) => `${e.runNode.label} (${runStep(e).status})`).join(', ') || 'none'}.`;
      if (event !== undefined) {
        testRootEvents.emitIncoming({ to: brainId, event: { type: 'TRIGGER_BRAIN_EVENT', eventType: event, payload: data } });
        await settle(deadline, timedOut);
      }

      const triggered = () => since().filter((e): e is RunNodeSpawned =>
        isSpawn(e) && flowRunNodeIds.includes(e.flowRunNodeId) && e.runNode.kind === 'event' && e.runNode.eventType === eventType);
      if (triggered().length === 0) {
        throw new Error(`Flow "${label}" has no track for "${eventType}".`);
      }
      const done = (id: string) => since().some((e) => isUpdate(e) && e.data.runNodeId === id && (e.data.status === 'completed' || e.data.status === 'failed'));
      /** Finished, or waiting by design: a waiting step, or a subflow whose own steps are all done or waiting */
      const settledNode = (spawned: RunNodeSpawned): boolean => {
        if (done(spawned.runNode.id)) return true;
        if (spawned.runNode.kind === 'flow') {
          const inner = since().filter((e): e is RunNodeSpawned => isSpawn(e) && e.flowRunNodeId === spawned.runNode.id && e.runNode.kind !== 'event');
          return inner.length > 0 && inner.every(settledNode);
        }
        const stepType = readRunNode(spawned.runNode.id)?.stepNodeType;
        return stepType !== undefined && stepRegistry.get(stepType)?.runtime?.waits === true;
      };
      const trackFinished = (eventRunNodeId: string) =>
        done(eventRunNodeId) || since().filter((e): e is RunNodeSpawned => isSpawn(e) && e.eventRunNodeId === eventRunNodeId && e.runNode.id !== eventRunNodeId).every(settledNode);
      const finishedTracks = () => {
        const ids = triggered().map((e) => e.runNode.id);
        return ids.every(trackFinished) ? ids : undefined;
      };
      let eventRunNodeIds: string[] | undefined;
      // A step reports completion before its flow starts the next step, so every started step can look settled
      // in between: check again once the systems have settled
      while (!eventRunNodeIds) {
        await waitForEmitted(finishedTracks, Math.max(deadline - Date.now(), 0), timedOut);
        await settle(deadline, timedOut);
        eventRunNodeIds = finishedTracks();
      }
      const tracks = new Set(eventRunNodeIds);
      return {
        eventRunNodeIds,
        steps: since().filter(isSpawn).filter((e) => e.runNode.kind !== 'event' && e.eventRunNodeId !== undefined && tracks.has(e.eventRunNodeId)).map((e) => runStep(e)),
      };
    }),
    flowSteps(label) {
      return reports.filter(isSpawn)
        .filter((e) => e.runNode.kind !== 'event' && flowLabels.get(e.runNode.id) === label)
        .map((e) => runStep(e));
    },
    system(systemId) {
      if (stopped) throw stoppedError();
      const actor = bus.system.get(resolveSystemId(systemId, systems));
      if (!actor) throw new Error(`System "${systemId}" isn't running`);
      return actor;
    },
    watchView<Result>(feature: string, view: string, args?: unknown): TestView<Result> {
      if (stopped) throw stoppedError();
      const updates: Array<ViewUpdate<Result>> = [];
      let read = 0;
      const unsubscribe = testViews().watch({ ref: resolveName(feature, packId), view, ...(args === undefined ? {} : { args }) }, (update) => {
        updates.push(update as ViewUpdate<Result>);
        wakeWaits();
      });
      const subscription: TestView<Result> = {
        updates,
        next: ({ timeoutMs = 5000 } = {}) => call(() => waitForEmitted(
          () => (read < updates.length ? updates[read++] : undefined),
          timeoutMs,
          () => `No update from view "${view}" of "${feature}" within ${timeoutMs}ms after the ${read} already read; it delivered: ${JSON.stringify(updates)}`,
        )),
        stop: () => {
          unsubscribe();
          watched.delete(subscription);
        },
      };
      watched.add(subscription);
      return subscription;
    },
    viewStats: () => testViews().stats(),
    stop() {
      if (!running.delete(app)) return;
      for (const subscription of watched) subscription.stop();
      stopped = true;
      stopRecording.forEach((unsubscribe) => unsubscribe());
      bus.stop();
      // A call the stop ends rejects for whoever awaits it, and isn't an unhandled rejection when nobody does
      for (const pending of calls) pending.catch(() => {});
      for (const wait of waits) wait.end(stoppedError());
      // Pack modules keep state outside the stopped actors (schedules, listeners): process-wide, so once no app runs
      if (running.size === 0 && packsUp) shutDownPacks();
    },
  };

  // The app is registered before anything that can throw, so a failed start is still stopped: otherwise its
  // recorders stay subscribed to testRootEvents for the rest of the file, waking waits for a dead app.
  running.add(app);
  try {
    // `running` already holds this app, so a size of 1 means it's the first
    if (running.size === 1) startPacks();
    // Not before: startPacks shuts the packs down again itself when it fails, and stop() must not repeat it
    packsUp = true;
    bus.start();
    await settle();
  } catch (error) {
    app.stop();
    throw error;
  }
  return app;
}
