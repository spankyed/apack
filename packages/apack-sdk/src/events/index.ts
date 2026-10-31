import { _performanceExecution, type PerformanceCarrier } from '../runtime/performance.ts';
// Messaging between frontend surfaces and backend systems. Frontend-safe: no Node modules and no
// `services`, since pack frontends get this module from the host (the `sdkEvents` global).
import { boundHost, _isHostBound } from '../runtime/host-runtime.ts';
import { _isFeHostBound, boundFeHost } from '../runtime/fe-host.ts';
import { getDesignated } from '../designations/index.ts';
import { resolveName, splitRef, type FeatureRef } from '../ids/refs.ts';
import { randomId } from '../utils/random-id.ts';
import type { ApplicationHotkeys } from '../types/index.ts';
import { eventTypes } from './event-types.ts';
import { _currentDelivery, type _Delivery } from './delivery.ts';
import type { ContractIncoming, ContractOutgoing, SystemEvents } from '../framework/define-system.ts';

export { eventTypes, type TypeOfEvent } from './event-types.ts';
export { _currentDelivery, _runDelivery, type _Delivery, type _Asker } from './delivery.ts';

/**
 * A message on the bus: the ref of the system or surface it goes to, and the event exactly as the sender wrote it.
 * Where it goes is never a field of the event, so an event may carry any field (a `surfaceId` of its own included).
 * Messages sent in (`sendToSystem`) go to systems, and messages sent out (`broadcastToSurface`) to surfaces.
 */
export interface Message {
  /** Ephemeral diagnostic context; it does not route, authorize or identify the sender. */
  diagnostics?: PerformanceCarrier;
  to: string;
  event: { type: string; [key: string]: unknown };
  /**
   * The id of the pack that sent it, stamped by the sends `#generated/events` builds (`defineEvents`) and by the
   * emitter an action runs with (`createActionEmitter`). Diagnostics name it: a dropped or unroutable message says
   * who sent it instead of leaving that to a grep.
   *
   * Absent on a send made for no pack in particular — `reportError`'s, which sends on behalf of whoever called it
   * and is told a source rather than a pack. Nothing routes or refuses on it — treat it as a label, not a claim:
   * a sender that doesn't stamp is not thereby untrusted, and one that does has not been checked.
   */
  from?: string;
  /**
   * What within the sender made it, where the sender has a name for that: `action:<label>` for an action, and for
   * a `reportError` the source it was given (`'bus'`, `'step-runtime'`). Each is the string that also names the
   * corresponding logger, so a dropped send and the log lines around it are one grep apart.
   *
   * An action is why this exists. It is the one sender a pack cannot point at in its own source — content a user
   * writes, edits and exports — so `from` naming its pack leaves the useful half of "who sent this" unsaid. `from`
   * keeps one meaning, the pack; `'<pack>/<action>'` would read as a `<packId>/<featureId>` ref and give anything
   * parsing it a confident wrong answer.
   *
   * Between the two, every send carries a pack, a source, or both — except `services.emitter` reached outside an
   * action, where neither is in scope. A label like `from`: nothing routes or refuses on it.
   */
  via?: string;
  /**
   * Which connection to deliver to, where the message is for one rather than all of them. Absent means every
   * connection, which is what a notification wants and what a backend send has always done.
   *
   * Unlike `from` and `via`, this one routes — so it is never read from the wire. The API mints it per
   * WebSocket connection and stamps it on the way in (`createRpcContext`, `packages/api/src/transport/context.ts`),
   * which is what makes it a return address a sender cannot forge. A client that puts a `client` on a send has
   * it dropped at the boundary, like any other field the input schema does not name.
   *
   * **A reload ends the connection, and an answer in flight for it is dropped.** The id is per connection, so a
   * window that reloads mid-request is a different one and the subscription filters the reply out — where the
   * old broadcast would have reached it. That is the trade an addressed answer makes, and the app already has
   * the primitive for it: a view that asks for data asks again on `CLIENT_CONNECTED`.
   */
  client?: string;
  /**
   * The ref of the participant that sent it: a feature's system or surface, or a participant that claimed a name
   * (`host/drive`). What `reply` answers, so a handler never has to be told who asked.
   *
   * Stamped where a send is *made*, which is during the handling of another message — `createSends` reads it from
   * the delivery in scope (`_currentDelivery`). It cannot be stamped from the sender's own identity, because a
   * pack's generated sends know their pack and not which of its features called them.
   *
   * Distinct from `from`, which names the pack: two features of one pack are one `from` and two `sender`s. Note
   * that `MessageSender` is `Pick<Message, 'from' | 'via'>` and so does **not** include this — it is the type of
   * the sender *labels*, which say who to blame in a diagnostic, where this says where to send an answer.
   *
   * A client may set it, unlike `client`, and the API's `bus.send` checks that it names something addressable —
   * not that the caller is it. So this is an **address, not an authenticated identity**: a handler that branches
   * on it is taking the sender's word. What bounds that word is `client`, since a reply goes to the connection
   * the ask arrived on, so the most a forged one buys is making a system answer *you* while believing it
   * answered somebody else. `bus.send` has the rest, including what closing it properly would take.
   */
  sender?: string;
  /**
   * The call this message **is** — minted by every send, so a request can be named by the answer to it.
   *
   * It exists because correlation was a three-step obligation every feature discharged by hand — mint an id,
   * store it, settle it — and the failures distributed across the steps rather than clustering: the database
   * did all three, settings declared a `requestId` end to end and minted none, actions and prompts stored one
   * and never cleared it, and a terminal's id did not exist until its answer, so nothing the asker sent could
   * have identified it. One id on the envelope serves all four shapes, because a per-send id is what works
   * when there is no natural key, no domain id that distinguishes windows, and nothing to key on yet.
   *
   * **Optional in the type and set by every send.** It cannot be required: `reply` takes an event and nothing
   * else, so `_replyTo` has no caller to source one from, and the pack test harness's `app.send` is built on
   * every field past `event` being omittable. What holds the invariant is `createSends`, which is the one
   * place a send is built, plus the spec that every verb stamps one.
   *
   * A pack never writes this. `sendToSystem` returns the call it used and takes one for the case that needs
   * the id before the send happens; the other three verbs mint internally and say nothing about it.
   */
  call?: string;
  /**
   * The call this message **answers** — set by `_replyTo` and by nothing else, so a reader can treat it as
   * "a `reply` built this, for that request" rather than a hint.
   *
   * Absent, or a call: there is no "not answering" value and nobody should be computing one. It was
   * `answering?: true` until the envelope carried a call, which is the same fact with the request named.
   *
   * It exists because an undeliverable answer is not the same event as an undeliverable command. A command was
   * given by someone who is still there to be told it failed; an answer has no user behind it, and the asker may
   * simply be gone — a pack unloading mid-request is a race, not a mistake. So the renderer's wire send keeps the
   * log and drops the toast for one of these (`renderer/src/transport/client.ts`), and the bus's two drop
   * diagnostics mark the report as an answer rather than naming the verb the caller did not call.
   *
   * **On the wire in both directions, which is a change.** This said "local to each side, and deliberately not
   * on the wire", on the reasoning that every reader was in the window or on the backend that built the
   * message. Carrying a call makes that false: a window's ask crosses inbound and its answer comes back out,
   * and a *system* asking a window is answered inbound — so a round trip correlates only if both fields
   * survive `bus.send`'s whitelist. Both are named there now.
   */
  answering?: string;
}

/**
 * What a send takes beside the event, for the one send that can be asked under a call the caller already has.
 *
 * Written out at every `sendToSystem` overload before this existed, which is seven copies of one shape for
 * the compiler to keep agreeing by hand.
 */
export interface CallOptions {
  /** The call to ask under. Given none, the send mints one and returns it. */
  call?: string;
}

/**
 * Tags this process once, so a call is one increment.
 *
 * **Every send mints a call, and two of those sends are hot** — a log line per log line, a `terminal.OUTPUT`
 * per pty chunk, thousands during a build. So minting has to be arithmetic: per-call entropy means a CSPRNG
 * call, a typed-array allocation and a `BigInt.toString` on that path, where the uniqueness it buys is
 * available from one random tag taken at load.
 */
const PROCESS_TAG = randomId({ includeTimestamp: false });

/** The last call this process minted. A plain integer, so it cannot wrap back onto a live call. */
let minted = 0;

/**
 * A new call id, unique across every window and every burst.
 *
 * **Across windows by the process tag, within one by the counter**, which is what the two uniqueness
 * requirements each need: an answer can reach every window, so a bare counter would collide with another
 * window's; and a burst of sends shares a millisecond, so a clock cannot separate them.
 *
 * **Guessable, deliberately.** `c-<tag>-7` implies `c-<tag>-8`, and that costs nothing here because a call
 * routes nothing and refuses nothing — it is read only by whoever is holding the matching ask. `client` is
 * the field that routes, and the API mints that per connection with its own entropy. A call is not a
 * capability and must not become one.
 *
 * Exported for the one shape that needs the id before the send happens — an `enqueueActions` body, where the
 * send is deferred past the `assign` that stores it. Every other caller lets the send mint and takes what
 * `sendToSystem` returns.
 */
export const newCall = (): string => `c-${PROCESS_TAG}-${++minted}`;

/**
 * The call a delivered event belongs to, or nothing for one that belongs to none.
 *
 * **Why the event and not a handed member.** A correlation is read in a transition guard, and a guard is
 * handed `{ context, event }` and nothing else — `defineHandlers` wraps a machine's *actions*, not its
 * guards. Context cannot be written before a guard runs, so the event is the only channel to one, and a
 * reserved key on it is how a call reaches a guard without every machine declaring a field for it.
 *
 * The key is `_call` and the delivery doors inject it. It holds the message's `answering`, so it is present
 * on an answer and absent on anything else — a request's own call is on the envelope for `reply` to echo and
 * has no reader on the event.
 *
 * **Reserved**: the injected value wins over a pack's own field of that name, which `outgoing-events.spec.ts`
 * pins beside its deliberate `surfaceId` collision, and the `reserved-event-keys` pack rule refuses one
 * written in any pack's source.
 *
 * @internal Host and SDK only, and the restriction is the point. A raw call invites `===` against a stored
 * one, which answers *true* when both are absent — so a guard written the obvious way admits an
 * uncorrelated answer whenever nothing is outstanding. Pack code asks `answersCall` or `settleCall`
 * instead, which cannot be spelled that way; `check:specifiers` refuses this import in a pack.
 */
export const _callOf = (event: { [key: string]: unknown }): string | undefined => {
  const call = event[_CALL_KEY];
  return typeof call === 'string' ? call : undefined;
};

/**
 * Whether this event answers the one ask `outstanding` names — `false` when nothing is outstanding.
 *
 * For a correlation holding at most one ask at a time: store what `sendToSystem` returned, clear it when
 * the answer lands, read it with this. Either spelling of an empty slot is accepted, so a machine's choice
 * of `null` or `undefined` decides nothing.
 *
 * **"Nothing outstanding answers nothing" has to be built in**, which is why this is a function and why
 * `_callOf` is not a pack's to call: `_callOf(event) === context.pending` is `undefined === undefined` with
 * no ask in flight, so the obvious spelling admits an answer nobody asked for — and no ask in flight is the
 * resting state.
 */
export const answersCall = (
  event: { [key: string]: unknown },
  outstanding: string | null | undefined,
): boolean => outstanding != null && _callOf(event) === outstanding;

/**
 * `pending` with `value` recorded under `call`, for a correlation holding several asks at once.
 *
 * The pair with `settleCall` — record what an ask meant when you make it, settle it when its answer
 * arrives. Keyed by the call, because a domain id identifies the row and not the ask: an answer naming a
 * row says nothing about which ask for it, nor which window asked. Immutable, so it composes with `assign`.
 */
export const recordCall = <T>(pending: Record<string, T>, call: string, value: T): Record<string, T> =>
  ({ ...pending, [call]: value });

/**
 * What this event's ask recorded, and `pending` without it: read and remove in one step.
 *
 * `recorded` is `undefined` for an event answering no ask this record knows — already settled, or never
 * made here — and `pending` then comes back unchanged. Taking `pending` and dropping `recorded` is how a
 * *failed* ask settles.
 *
 * It takes the **event**, not a call, which is the whole reason it exists: a pack never holds a call read
 * off an event, so it cannot write the comparison `answersCall` exists to prevent.
 */
export const settleCall = <T>(
  pending: Record<string, T>,
  event: { [key: string]: unknown },
): { recorded?: T; pending: Record<string, T> } => {
  const call = _callOf(event);
  if (call === undefined || !(call in pending)) return { pending };
  const { [call]: recorded, ...rest } = pending;
  return { recorded, pending: rest };
};

/**
 * The reserved key `callOf` reads, and the doors write.
 *
 * `_`-prefixed for what the prefix means everywhere here — not yours to write — and a key rather than a
 * member because the thing it sits in is an open bag (`{ type: string; [key: string]: unknown }`) where a
 * collision is possible. `Message.call` is un-prefixed for the opposite reason: a closed interface has
 * nothing to collide with, and a pack *does* supply a call through `sendToSystem`.
 *
 * @internal Host and SDK only. Pack code asks `answersCall` or `settleCall` and never names the key.
 */
export const _CALL_KEY = '_call';

/**
 * What a door adds to the event it delivers, so the receiver's guards can read the call it answers.
 *
 * **Only an answer carries one, and a notification must not.** A request's own call has no reader on the
 * event — whoever receives one answers it with `reply`, which takes the call from the delivery — so it is
 * the asker that needs a call, and only on the answer. Injecting the message's `call` as well would put a
 * `_call` on every notification, which belongs to no ask, and a system recording what it heard would record
 * one too.
 *
 * @internal Called by the delivery doors. Pack code reads the result through `answersCall` or `settleCall`.
 */
export const _callOn = (message: Pick<Message, 'answering'>): { [_CALL_KEY]?: string } =>
  message.answering === undefined ? {} : { [_CALL_KEY]: message.answering };

/**
 * How a diagnostic names who sent a message, as a suffix to append: ` by "default-setup" (action:summarise)`,
 * or `''` when the message says neither. Every place that reports an undeliverable message appends this, so they
 * word it the same and a field added to the sender reaches all of them at once. It says nothing about whether a
 * sender may send: nothing routes on either field, and a drop that names no sender just has one fewer clue.
 */
export function senderSuffix({ from, via }: Pick<Message, 'from' | 'via'>): string {
  if (from && via) return ` by "${from}" (${via})`;
  if (from) return ` by "${from}"`;
  if (via) return ` by ${via}`;
  return '';
}

/** A surface's name → the events that surface receives. Each pack's `#generated/events` defines its `SendableSurfaceEvents`. */
export type SurfaceEvents = { [surface: string]: { type: string } };

/**
 * What every surface receives when its feature's settings change, so no pack declares it: the settings as they now
 * apply. The feature's system gets the same event, with the changes (`SystemEvents`).
 */
export type FeatureSettingsUpdated = { type: 'FEATURE_SETTINGS_UPDATED'; settings: unknown };

/** Open a canonical entity ID at this surface's declared destination. */
export type OpenEntity = { type: 'OPEN_ENTITY'; id: import('@apackdev/ears').EARS.EntityId };

/** The event types every surface receives from the app, beside those its pack's systems declare. */
export const SURFACE_EVENT_TYPES = eventTypes<FeatureSettingsUpdated | OpenEntity>()('FEATURE_SETTINGS_UPDATED', 'OPEN_ENTITY');

/** `M` keyed `<PackId>/<key>`: a pack's features by their refs */
export type Qualified<PackId extends string, M> = { [K in keyof M & string as `${PackId}/${K}`]: M[K] };

/**
 * `M`, keyed by refs, as pack `PackId`'s code names its keys: its own features by feature id (their refs are for
 * other packs), every other feature by ref
 */
export type WithOwnNames<PackId extends string, M> = {
  [K in keyof M & string as K extends `${PackId}/${infer FeatureId}` ? FeatureId : K]: M[K]
};

/** A system's name → the events that system receives. Each pack's `#generated/events` defines its `PackSystemEvents`. */
export type SystemEventMap = { [system: string]: { type: string } };

/** Whether `T` is a union of several types */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : false;

/** `Event` for one target and one event type; otherwise nothing is sendable, but `type` stays for completions */
type OneSend<Unions extends boolean, Type, Event> = true extends Unions ? { type: Type; 'send one event type to one target': never } : Event;

/** The members of `E` whose `type` (a literal, a union or a template literal) accepts `Type` */
type EventsOfType<E, Type> = E extends { type: infer T } ? (Type extends T ? E : never) : never;

/** Each member of `E` without `type`, keeping named fields beside an index signature (which `Omit` drops) */
type WithoutType<E> = E extends unknown ? { [K in keyof E as K extends 'type' ? never : K]: E[K] } : never;

/*
 * The `*Of` names below, with `SurfaceStateOf` (`fe/surface.ts`), are the vocabulary generated code is written in:
 * `generate-entries` emits them into every pack's `#generated/events`. That is what they are for, and why a system
 * contract's two published halves get one each even though `ContractIncoming` and `ContractOutgoing` already read
 * those fields — the layer that packs depend on stays a surface this package can keep still while the readers
 * under it change. They span both contract kinds, where `Contract*` covers `SystemContract` alone.
 */

/**
 * The events a system receives, from its feature's `Contract` — what a sender may write. Its `internal` half isn't
 * here: those are what the system's own children send it, and no other feature's to send.
 */
export type IncomingEventsOf<C> = ContractIncoming<C>;

/** The events a system sends to surfaces, from its feature's `Contract` */
export type OutgoingEventsOf<C> = ContractOutgoing<C>;

/**
 * Every event a surface's `Contract` says another surface may send it, across audiences. Generated code builds each
 * surface's inbox with it, as it builds a system's with `OutgoingEventsOf`. A contract with no `inbox` publishes
 * state only and receives nothing but its own system's events.
 */
export type SurfaceInboxOf<C> = C extends { inbox: infer Audiences }
  ? Extract<Audiences[keyof Audiences], { type: string }>
  : never;

/**
 * The half of a surface's inbox a *dependent pack* may send: its `public` audience alone. The `pack` audience is
 * what this pack's own features send it — a sibling asking for a panel, a link opening a note — and publishing it
 * would make every dependent's completions carry commands only the owning pack can meaningfully send.
 *
 * Generated code builds `PackSurfaceEvents` with this and `OwnSurfaceEvents` with `SurfaceInboxOf`, which is the
 * whole of the split: one contract, two readers.
 */
export type PublicSurfaceInboxOf<C> = C extends { inbox: { public: infer Events } }
  ? Extract<Events, { type: string }>
  : never;

/**
 * Events the host app's own surfaces receive from packs. The host declares them here, as a pack's surface declares
 * its own in its `Contract`; `#generated/events` includes this map, so any pack may send them.
 */
export type HostSurfaceEvents = {
  'host/application':
    // The app's own send after each client connection (`ApplicationConnectedEvent`, @apackdev/host/bus): whether
    // the user onboarded, which surfaces' tabs show, and the surface the user last had open
    | { type: 'CLIENT_CONNECTED'; hasOnboarded: boolean; surfaceVisibility: Record<string, boolean>; lastActiveSurface?: string }
    | { type: 'APPLICATION_HOTKEYS'; hotkeys: ApplicationHotkeys }
    // The app's own send when a surface's tab is shown or hidden, or a pack's defaults change
    | { type: 'SURFACE_VISIBILITY_UPDATED'; surfaceVisibility: Record<string, boolean> }
    // The app's own send when the chat's slash commands change: the feature playing the `commands` designation came,
    // went or wrote, so the shell holds the list every editor in this window reads
    | { type: 'COMMANDS_UPDATED'; commands: import('../commands/index.ts').PackCommand[] }
    // The user finished onboarding: the shell leaves its onboarding layout
    | { type: 'ONBOARDING_COMPLETE' }
    // Opens a surface, by its ref, in the app's main windows (a popout keeps the surface it shows) and hands its actor
    // `events`; the shell waits for a surface whose pack's frontend is still loading
    | { type: 'OPEN_SURFACE'; surface: string; events?: Array<{ type: string; [key: string]: unknown }> };
  /**
   * The app's Settings view. A pack sends it what only that pack can find out about its own things, for the view to
   * show — the code feature's CLI resolution, for one. The settings themselves are the app's.
   */
  'host/settings':
    | { type: 'HELP.OPEN'; target: import('../framework/pack-help.ts').HelpTarget }
    | { type: 'CLI_TEST_RESULT'; provider: string; success: boolean; error?: string; resolvedPath?: string };
};

/** Events the host app's own systems receive from pack code, which names them `host/<feature>` */
export type HostSystemEvents = {
  // A pack whose data changed outside a pack change (its content imported) has the running systems read it again
  'host/bus': { type: 'PACK_CHANGED'; packId: string };
  // The feature playing the `commands` designation wrote: it says so rather than sending the list, since the app
  // reads the list from the designation and every window needs it, not whoever happened to be told
  'host/application': { type: 'COMMANDS_CHANGED' };
};

/**
 * The event types the host's systems accept from pack code, which the app checks a client's send against as it checks
 * a pack system's: from a frontend as from a backend
 */
export const HOST_SYSTEM_EVENT_TYPES = {
  'host/bus': eventTypes<HostSystemEvents['host/bus']>()('PACK_CHANGED'),
  'host/application': eventTypes<HostSystemEvents['host/application']>()('COMMANDS_CHANGED'),
} satisfies Record<keyof HostSystemEvents, readonly string[]>;

/**
 * The event types each host surface receives, as a value the app can check a send against and the build can
 * read the host's surfaces from. A pack's own surfaces get this generated from their systems' specs.
 */
export const HOST_SURFACE_EVENT_TYPES = {
  'host/application': eventTypes<HostSurfaceEvents['host/application']>()('CLIENT_CONNECTED', 'APPLICATION_HOTKEYS', 'SURFACE_VISIBILITY_UPDATED', 'COMMANDS_UPDATED', 'ONBOARDING_COMPLETE', 'OPEN_SURFACE'),
  'host/settings': eventTypes<HostSurfaceEvents['host/settings']>()('CLI_TEST_RESULT', 'HELP.OPEN'),
} satisfies Record<keyof HostSurfaceEvents, readonly string[]>;

/**
 * Delivers an event to a backend system: in the renderer over its API client, elsewhere onto the bound app's bus.
 * A bound frontend wins, as it does for the registered packs' lookups (`_boundPackExtensions`).
 */
function withDiagnostics(message: Message): Message {
  const carrier = _performanceExecution()?.capture();
  return carrier?.traceparent ? { ...message, diagnostics: carrier } : message;
}

function sendIncoming(message: Message): void {
  message = withDiagnostics(message);
  if (_isFeHostBound()) boundFeHost().client.send(message);
  else if (_isHostBound()) boundHost().transport.rootEvents.emitIncoming(message);
  else throw new Error('No host is bound to send events through: call bindHost(runtime) (backend) or bindFeHost(runtime) (frontend) from @apackdev/sdk/runtime first');
}

/**
 * Delivers an event to a surface in **this window**, through the shell. The window-local counterpart of
 * `sendIncoming`: no bus, no other window, and the two are the only channels a window has.
 *
 * It takes the whole message rather than reading the sender from the delivery in scope, because `reply` is
 * bound at entry and may be called long after its delivery has returned — the one caller that cannot rely on
 * ambient scope is the one that most needs the address to arrive.
 *
 * Through the shell rather than at the actor, because "is that surface here yet" is the shell's question and it
 * already answers it for `OPEN_SURFACE`: a surface whose pack's frontend is still loading is waited for, and one
 * no pack provides is reported to the user once loading settles.
 */
function deliverInWindow(message: Message): void {
  message = withDiagnostics(message);
  const ref = message.to;
  if (!splitRef(ref)) throw new Error(`"${ref}" doesn't name a surface: a surface is named "<packId>/<featureId>"`);
  const { from, via, sender, answering, call, diagnostics } = message;
  boundFeHost().application.send({
    type: 'SEND_TO_SURFACE',
    ...(diagnostics && { diagnostics }),
    surface: ref,
    events: [message.event],
    ...(from ? { from } : {}),
    ...(via ? { via } : {}),
    // Forwarded by name, like every other field here — which is why this door is the one place a new envelope
    // field is lost quietly rather than loudly, and why `shell-envelope-parity.spec.ts` holds the two shapes
    // to each other the way `bus-message-parity.spec.ts` does for the wire
    ...(call ? { call } : {}),
    // Whether a person is waiting on this, which decides how the shell reports a surface that isn't there: a
    // command someone gave is worth a toast, an answer to a question is not. It rides on the envelope, so this
    // door and the renderer's wire send read one field rather than each being told separately
    ...(answering ? { answering } : {}),
    // The window's counterpart of the bus's `askerOf`: each door turns the envelope's `sender` into the channel
    // it arrived on, because that door is the only place the channel is known. This one stays inside the window,
    // so a surface answering it answers an actor beside it rather than something over the bus.
    ...(sender ? { asker: { kind: 'window', ref: sender } as const } : {}),
  });
}

/** What binds a set of sends: how a name becomes a ref, and the pack making them. */
export interface SendBinding {
  /** A name the caller writes → the ref it stands for. The unbound sends take refs already, so a name is its own ref. */
  resolve?: (name: string) => string;
  /**
   * The pack these sends are made by, stamped on every message as `Message.from`. Absent where there is no pack to
   * name: `reportError` sends for a caller that is a logger source, and binds only `via`.
   */
  from?: string;
  /**
   * What within the sender is making them, stamped as `Message.via`: `action:<label>` for the emitter an action
   * runs with (`createActionEmitter`), and its source for `reportError`, which has no pack to name.
   */
  via?: string;
}

/**
 * The four sends, bound to whoever is making them. One place builds a send, so what travels beside the event —
 * `from` and `via` — is threaded here rather than added as a parameter to each of them, and to every caller
 * that has nothing to pass.
 *
 * **`call` is the one thing that could not follow that policy, and `sendToSystem` takes it.** A binding is one
 * value for the life of a pack; a call is one value per send, so `SendBinding` cannot carry it. Minting still
 * happens here — all four verbs stamp one, and 728 call sites across the repo are untouched — but an *ask*
 * needs the id before the answer can be matched against it, and in an `enqueueActions` body the send is
 * deferred past the `assign` that would store it. So `sendToSystem` accepts one and returns the one it used,
 * and the three verbs nobody asks with keep their signatures exactly.
 */
export function createSends({ resolve = (name: string) => name, from, via }: SendBinding = {}) {
  // Only the fields this binding has. An envelope carrying `from: undefined` reads as a sender that was there and
  // got lost, and adds a key to every log line and every message that crosses the wire.
  const labels = { ...(from ? { from } : {}), ...(via ? { via } : {}) };
  // Where an answer to this send would go. A send is almost always made while handling another message, and the
  // handler's own ref is the address — read from the delivery rather than from the binding, which knows the pack
  // and not which feature called it. Absent outside a delivery (host plumbing, a timer), and `reply` says so
  // rather than guessing.
  const answerAddress = () => {
    const receiver = _currentDelivery()?.receiver;
    return receiver ? { sender: receiver } : {};
  };

  return {
    broadcastToSurface(name: string, event: { type: string; [key: string]: unknown }): void {
      // The two sends share a signature, so the compiler can't tell a caller it picked the wrong one: say which it
      // is. Reaching for the other from here is the likely mistake, not a missing bindHost.
      if (!_isHostBound() && _isFeHostBound()) {
        throw new Error(`broadcastToSurface("${name}") is the backend's, over the bus to every window. In the renderer, send to this window's surface with sendToSurface from #generated/events`);
      }
      boundHost().transport.rootEvents.emitSurfaceSend(withDiagnostics({ to: resolve(name), event, call: newCall(), ...labels, ...answerAddress() }));
    },

    sendToSurface(name: string, event: { type: string; [key: string]: unknown }): void {
      // The two sends share a signature, so the compiler can't tell a caller it picked the wrong one: say which it is.
      if (!_isFeHostBound() && _isHostBound()) {
        throw new Error(`sendToSurface("${name}") is the renderer's, to this window's surface. On the backend, send over the bus with broadcastToSurface from #generated/events`);
      }
      deliverInWindow({ to: resolve(name), event, call: newCall(), ...labels, ...answerAddress() });
    },

    /**
     * Sends an event to a surface on **one connection** — the window a handler is serving — rather than to
     * every window showing it.
     *
     * The pair with `broadcastToSurface` is the whole point, and which to reach for follows the job: news
     * every window needs is a broadcast, and anything only the window that asked should act on is this.
     * Before it existed a system could be *answered* by a window but could only *ask* by broadcasting, so
     * one question collected one answer per open window.
     *
     * **The connection is a parameter, not something this finds.** A handler is handed the one it is
     * serving (`client`, beside `reply`), so the address survives an `await` or being stored for later —
     * which is the same reason `reply` is handed rather than read from the scope at the moment it is
     * called. Reading it here instead would throw for exactly the handlers that most need it.
     *
     * What does *not* survive an await is `Message.sender`: `answerAddress()` reads the delivery when the
     * send is made, by the one exception documented there. So a send made later reaches the right window
     * carrying no sender, and that window cannot answer it.
     */
    sendToWindow(client: string, name: string, event: { type: string; [key: string]: unknown }): void {
      // An empty connection would send with none, and absent means *every* connection — the silent
      // widening from one window to all of them that this verb exists to prevent. The type says `string`,
      // so reaching this takes a cast or untyped code; it is a gate on the one wrong value, not on a shape.
      if (!client) {
        throw new Error(`sendToWindow("${name}") was given no connection to send to. A handler is handed the one it is serving as \`client\`, which is absent when the message came from another system or from nothing — to reach every window showing that surface, use broadcastToSurface.`);
      }
      boundHost().transport.rootEvents.emitSurfaceSend(withDiagnostics({ to: resolve(name), event, call: newCall(), ...labels, ...answerAddress(), client }));
    },

    /**
     * Sends an event to a backend system, and answers with the call it was sent under.
     *
     * **The call is returned, and may be supplied.** Returned because an ask has to store what it asked
     * under; supplied because the shape most asks are written in — an `enqueueActions` body — defers the
     * send past the `assign` that stores it, so the id has to exist before the send does (`newCall`). Given
     * one, this uses it; given none, it mints. Either way the answer to it carries the same value as
     * `Message.answering`, which `callOf` reads off the delivered event.
     *
     * The three other verbs take no call, because nothing asks with them: a broadcast has no single asker,
     * and the two addressed surface sends are answers or news. One of them gains the parameter the day
     * something asks with it, and not before.
     */
    sendToSystem(to: SystemTarget, event: { type: string; [key: string]: unknown }, options?: CallOptions): string {
      const call = options?.call ?? newCall();
      sendIncoming({ to: typeof to === 'string' ? resolve(to) : getDesignated(to.role), event, call, ...labels, ...answerAddress() });
      return call;
    },
  };
}

/** The sends made by nobody in particular: the untyped ones below, which packs and tooling use directly. */
const unboundSends = createSends();

/**
 * Sends an event to a surface through the bus, which delivers it once a client is connected — and to **every**
 * window showing that surface, since a surface runs once per window. Backend only.
 *
 * That reach is the reason for the name. `sendToSurface` beside it is the renderer's, and goes to one window's actor.
 * A backend send that only one window should act on says so in the event, as the host's `OPEN_SURFACE` does.
 *
 * Untyped: packs use the `broadcastToSurface` from their `#generated/events`.
 */
export function untypedBroadcastToSurface(to: string, event: { type: string; [key: string]: unknown }): void {
  unboundSends.broadcastToSurface(to, event);
}

/**
 * @internal Sends an event to the surface at `ref` in **this window**, through the shell — no bus, no other window.
 * The renderer half of `sendToSurface`, which `defineEvents` types per receiving surface.
 *
 * A surface runs once per window, so this is what UI coordination wants: the artifact opens where the user clicked.
 *
 * It goes through the shell rather than to the actor directly, because "is that surface here yet" is the shell's
 * question and it already answers it for `OPEN_SURFACE`: a surface whose pack's frontend is still loading is waited
 * for, and one no pack provides is reported to the user once loading settles. Reaching past the shell meant two
 * owners of that question giving different answers — this one threw. It is a send, not a navigation, so the surface
 * the user has open doesn't change.
 */
export function _sendToLocalSurface(ref: string, event: { type: string; [key: string]: unknown }): void {
  unboundSends.sendToSurface(ref, event);
}

/**
 * Sends an event to a surface in the one window being served, rather than to every window showing it.
 * Backend only, and only while handling a message that came from a connection.
 *
 * Untyped: packs use the `sendToWindow` from their `#generated/events`.
 */
export function untypedSendToWindow(client: string, to: string, event: { type: string; [key: string]: unknown }): void {
  unboundSends.sendToWindow(client, to, event);
}

/** A system: its ref, or the role a system plays (`{ role: 'brain' }`), found when the message is sent */
export type SystemTarget = string | { role: string };

/**
 * What a handler answers its asker with. Absent where the message named no sender, which is the whole point:
 * "is there anybody to answer?" is a question the type asks rather than one a global is probed for.
 *
 * **It is a send, not a resolve, so calling it twice sends twice — on purpose.** Nothing here is at-most-once
 * and nothing should be: there is no request id to answer against and an XState machine cannot await, so the
 * asker handles each answer as an event like any other. A handler that reports progress and then a result is
 * doing something ordinary, and refusing the second call would forbid it to protect against a mistake nobody
 * has made. What a double call cannot do is go somewhere unexpected: both answers carry the same address, so
 * the risk is a confused asker rather than a leak.
 *
 * Two things follow, and the second is the one to hold onto. A handler must not treat `reply` as evidence that
 * it has not already answered — it has no memory. And **a correlating layer built on top of this owns
 * at-most-once itself**: the moment answers are matched to requests, a second answer to a settled request is a
 * real error, and the place to refuse it is that layer, where the request id exists. Putting the rule here
 * instead would make it unavailable exactly where it could be checked properly.
 */
export type Reply<E extends { type: string } = { type: string; [key: string]: unknown }> = (event: E) => void;

/**
 * The answer function for one delivery, or nothing when that message named no sender.
 *
 * **Bound, not ambient.** It closes over the delivery it was built from, so a handler that stores it — in a
 * callback, a listener, an actor's input — still answers the right asker later. Reading the scope at use
 * instead is what makes a stored answer reach nobody: measured, a callback registered inside a delivery and
 * fired outside one saw no sender at all.
 *
 * **The asker names the way back, and which ways exist depends on which side is answering.** Three channels
 * against two sides is six cells, and two of them cannot happen:
 *
 * | the asker | answered on the backend | answered in a window |
 * |---|---|---|
 * | `bus` | in, onto the bus, to the asking system | out over this window's connection |
 * | `connection` | out to that connection alone | **impossible** — a window reaches no other connection |
 * | `window` | **impossible** — there is no window-local bus here | to the surface beside the answerer |
 *
 * The two throw rather than falling back, because either would be a message delivered in the wrong process and
 * a silent broadcast is how that used to show up. `bus` answered in a window goes *out*, which looks like an
 * exception and is not: the window's one channel to the backend is its connection, and the API routes the
 * message on from there.
 *
 * **Both are assertions, not gates, and that is why they stay throws.** Nothing can reach either: an asker is
 * built at one of three doors and each door can only build the channel it is — `askerOf`
 * (`@apackdev/host/bus`'s `delivery.ts`) returns `bus` or `connection`, `connection.ts` in the shell returns
 * `bus`, `deliverInWindow` returns `window`, and `useSurface` builds no asker at all. So the subject is this
 * program's own construction rather than anything a caller passes, and a `reportError` here would turn a
 * proven-impossible state into a line in a log while the process carried on inside it.
 *
 * Being unreachable means a mutation is the only way to watch them, so here are the two edits that fire them.
 * For the window cell: make the shell's `connection.ts` pass the message's `client` through as a
 * `{ kind: 'connection' }` asker instead of the `{ kind: 'bus' }` it builds. For the backend cell: make
 * `askerOf` return `{ kind: 'window' }`. Each is one line, and each is a real way someone could get this
 * wrong, which is what makes them worth naming rather than a trick to make a branch run.
 *
 * The messages say the host built the delivery, not that the handler called `reply` wrongly, because a pack's
 * handler is where the throw lands and it is the one party that cannot have caused it.
 *
 * The host is resolved on each call rather than at binding, so building one costs nothing and needs no app.
 *
 * @internal The SDK builds these for handlers (`defineHandlers`, `@apackdev/sdk/framework`); pack code receives
 * one rather than making it, which is what replaced an exported `reply()` that read the scope itself.
 */
export function _replyTo(delivery: _Delivery | undefined): Reply | undefined {
  if (delivery?.asker === undefined) return undefined;
  const { asker, receiver, call } = delivery;
  return (event) => {
    // The call this answers, read off the delivery rather than the event: `reply` is bound at handler entry,
    // so an answer sent after an `await` still names the request it is for
    // Its own call as well as the one it answers: a reply is a message, so it mints like every other send and
    // can itself be answered — which is the pattern this channel already supports. `answering` names another
    // message's call; `call` names this one.
    const message = withDiagnostics({ to: asker.ref, event, sender: receiver, call: newCall(), ...(call === undefined ? {} : { answering: call }) });
    if (_isFeHostBound()) {
      if (asker.kind === 'window') { deliverInWindow(message); return; }
      if (asker.kind === 'bus') { boundFeHost().client.send(message); return; }
      throw new Error(`Can't answer "${asker.ref}" on connection "${asker.client}" from a window: a window reaches the backend and the surfaces beside it, not another window's connection. Nothing in this window builds a connection asker, so the delivery was constructed wrongly rather than answered wrongly — the handler that called reply is not at fault.`);
    }
    const { rootEvents } = boundHost().transport;
    if (asker.kind === 'connection') { rootEvents.emitSurfaceSend({ ...message, client: asker.client }); return; }
    if (asker.kind === 'bus') { rootEvents.emitIncoming(message); return; }
    throw new Error(`Can't answer the "${asker.ref}" surface in its own window from the backend: there is no window-local bus here, so a backend send to a surface either reaches every window (broadcastToSurface) or one connection (sendToWindow). Nothing on the backend builds a window asker, so the delivery was constructed wrongly rather than answered wrongly — the handler that called reply is not at fault.`);
  };
}

/**
 * The connection a delivery's asker arrived on, or nothing where it named none.
 *
 * **Given the delivery rather than reading the scope**, for `_replyTo`'s reason: both handed members come
 * off one read taken as the handler is entered, so an address a handler stores still points at the window
 * it was serving. A system knows no other window — nothing holds a registry of them — so this is the whole
 * of what `sendToWindow` can address.
 *
 * @internal The SDK hands these to handlers (`defineHandlers`, `@apackdev/sdk/framework`); pack code receives
 * one rather than asking for it.
 */
export function _clientOf(delivery: _Delivery | undefined): string | undefined {
  const asker = delivery?.asker;
  return asker?.kind === 'connection' ? asker.client : undefined;
}

/**
 * Sends an event to a backend system, by ref or by the role it plays. Untyped: packs use the `sendToSystem` from
 * their `#generated/events`, which takes names and checks the event against what the system declares.
 */
export function untypedSendToSystem(to: SystemTarget, event: { type: string; [key: string]: unknown }, options?: CallOptions): string {
  return unboundSends.sendToSystem(to, event, options);
}


/** Calls `callback` each time a client connects; returns the unsubscribe (backend only) */
export function onConnected(callback: () => void): () => void {
  return boundHost().transport.rootEvents.onConnected(callback);
}

/** Calls `callback` with each message sent to a backend system; returns the unsubscribe (backend only) */
export function onIncoming(callback: (message: Message) => void): () => void {
  return boundHost().transport.rootEvents.onIncoming(callback);
}

/** `sendToSurface` typed against a surface event map; any feature's surface, by its ref, takes what every surface does */
export type TypedSendToSurface<M extends SurfaceEvents> = (<P extends keyof M & string>(
  surface: P,
  event: OneSend<IsUnion<P>, M[P]['type'], M[P]>,
) => void) & ((surface: FeatureRef, event: FeatureSettingsUpdated) => void);

/**
 * `sendToWindow` typed against a surface event map, with the connection it addresses in front.
 *
 * `TypedSendToSurface` with that one parameter added through both arms, so a surface's events are checked
 * exactly as a broadcast's are and only the address differs. `client` is `string` rather than
 * `string | undefined` deliberately: a handler is handed `client?: string`, so it cannot call this until
 * it has said what it does when there is no window — which is `reply?.()`'s discipline written for a
 * three-argument send.
 */
export type TypedSendToWindow<M extends SurfaceEvents> = (<P extends keyof M & string>(
  client: string,
  surface: P,
  event: OneSend<IsUnion<P>, M[P]['type'], M[P]>,
) => void) & ((client: string, surface: FeatureRef, event: FeatureSettingsUpdated) => void);

/**
 * `sendToSystem` typed against a system event map; `type` picks the event, so a missing field names it. A role
 * (`{ role: 'brain' }`) names whichever system plays it, which the build can't know, so its event is unchecked. Any
 * feature's system, named by its ref, takes the events every system does (`SystemEvents`).
 */
export type TypedSendToSystem<S extends SystemEventMap> = (<Id extends keyof S & string, Type extends S[Id]['type']>(
  system: Id,
  event: OneSend<IsUnion<Id> | IsUnion<Type>, Type, { type: Type } & WithoutType<EventsOfType<S[Id], Type>>>,
  options?: CallOptions,
) => string) & ((target: { role: string }, event: { type: string; [key: string]: unknown }, options?: CallOptions) => string) & ((system: FeatureRef, event: SystemEvents, options?: CallOptions) => string);

/** A pack's typed sends */
export interface TypedEvents<P extends SurfaceEvents, S extends SystemEventMap> {
  /** Backend: over the bus, to every window showing that surface */
  broadcastToSurface: TypedSendToSurface<P>;
  /** Backend: to that surface on one connection — the window a handler is serving, handed to it as `client` */
  sendToWindow: TypedSendToWindow<P>;
  /** Renderer: straight to this window's actor for that surface */
  sendToSurface: TypedSendToSurface<P>;
  sendToSystem: TypedSendToSystem<S>;
}

/**
 * The sends `#generated/events` builds for pack `packId`. A pack names its own features by id and every other
 * feature, the host's included, as `<packId>/<featureId>` (`@apackdev/sdk/ids`). The types reject a name nothing declares, and the app reports a
 * send it has no receiver for.
 */
export function defineEvents<P extends SurfaceEvents, S extends SystemEventMap>(packId: string): TypedEvents<P, S> {
  return createSends({ resolve: (name) => resolveName(name, packId), from: packId }) as unknown as TypedEvents<P, S>;
}
