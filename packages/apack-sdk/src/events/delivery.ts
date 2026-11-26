/**
 * Which message is being handled right now, so a handler can answer its sender without being told who that is.
 *
 * **Why this is not a field on the event.** The envelope's central rule forbids it: `event` arrives exactly as
 * the sender wrote it, which `outgoing-events.spec.ts` pins with a deliberate `surfaceId` collision. So the
 * address is kept *beside* the handler, and this is where.
 *
 * Handlers read the connection the message arrived on via `currentClient()` at entry, and `@apackdev/state`
 * `answers` handlers reply via `_replyTo` over the delivery they were entered in. Neither reads this scope later than entry.
 *
 * What is left here is the plumbing that still has to be ambient: the bus opens a scope per delivery, and
 * `createSends` reads its `receiver` to stamp `Message.sender` on an ordinary send. That one cannot be a
 * parameter, because every send in pack code would have to carry it.
 *
 * **One reader, and it is a plain variable set and restored around the delivery.** It is exact for what reads
 * it: an answer's address is read synchronously as its handler is entered, before any `await` can have happened,
 * so no store has to follow a handler across one — see `@apackdev/host/bus`'s `delivery.ts`.
 *
 * **Four doors set it, and that they are doors rather than call sites is the point.** On the backend,
 * `@apackdev/host/bus`'s `deliverAs`: the bus routing a message to a system, and the host handing one to an early
 * system. In a window, `notifySurfaceActor` and `sendToSurfaceActor` — the two functions every send to a surface's actor goes through — and
 * `useSurface`, which wraps the actor it gives a component rather than any one send.
 *
 * It was a list of four *places* until a test asked each of them to answer, and the real number was nine: the
 * shell reached surfaces from eight sites and named them at one, so a surface handling anything the backend
 * broadcast, or its own `SURFACE_ACTIVATED`, sent on with no `sender` and could not be answered. A count a
 * reader has to keep is the failure; the two `*SurfaceActor` functions are the correction.
 *
 * **Three ways a send ends up outside any delivery**, all of which leave `Message.sender` absent, so the system
 * it reaches cannot answer it. Worth knowing in this order, because only the first is widely known:
 *
 * 1. **After an `await`, or from a timer or callback the handler created.** This paragraph said the opposite
 *    until 2026-10-06 — that an `await` was fine and so was a timer, because both inherit the scope. That was
 *    true of the `AsyncLocalStorage` this replaced and is false of a plain variable, which is restored when the
 *    delivering call returns. `@apackdev/host`'s `tests/bus/delivery-is-synchronous.spec.ts` pins the real
 *    behaviour, and it is a decision rather than a limitation: see that file and `@apackdev/host/bus`'s
 *    `delivery.ts` for what the store cost and what dropping it bought.
 * 2. **A lifecycle or publish path, which opens no delivery at all** — no `await` need be involved. The bus
 *    pushes `CLIENT_CONNECTED`, `SEND_STATE`, `PACK_CHANGED`, `DATA_REPLACED` and `DATA_CHANGED_ELSEWHERE` with a bare `actor.send`
 *    (`sendToRunning` and `askToPublish`, `@apackdev/host/bus`'s `machine.ts`), as the host does for an early
 *    system's pair. That is right rather than missed: those are facts with nobody waiting on them, and
 *    `SEND_STATE` wants a broadcast and not an answer. An ask arriving that way is answered to nobody, which is
 *    what "nobody asked" is supposed to look like.
 * 3. **An asynchronous state callback — a `loads` / `calls` completion, a `run` callback, or a delayed
 *    event.** Any work triggered after a tick runs outside the original delivery scope.
 *
 * **What this costs: most backend sends carry no sender, and almost none of them wants one.** A census of the
 * send sites lived here and is gone, for two reasons worth keeping. It sized no decision — nothing was chosen
 * differently because the number was what it was — and it did not add up: its two halves came to more than the
 * total it opened with, and the line survived review in that state because a figure reads as evidence whether
 * or not anyone can check it. And nothing re-derives it: whether a send site sits inside a delivery is a
 * question about what called what at runtime, which no check here answers, so the number could only ever go
 * stale in place.
 *
 * The claim that mattered is not a count: a send that wants an answer and cannot be made inside a delivery
 * needs its address threaded explicitly. An ask's answer is the half of that which already works, since its
 * address is bound as its handler is entered and never comes back here, however long the handler awaits.
 */

/**
 * The way back to whoever asked.
 *
 * **Each variant names a channel, not a kind of participant**, because the channel is the only thing answering
 * needs and the participant does not determine it. A **surface** asker appears as `connection` when the answerer
 * is on the backend and as `window` when the answerer is beside it in the same window — same participant, two
 * ways back. A **system** asker is always `bus`. A participant that claimed a name on its connection (a drive
 * session) is a `connection` like a surface, which is what makes it answerable without being a surface at all.
 *
 * **One value rather than two optional fields, because the third case had no spelling.** This was
 * `replyTo?: string` beside `client?: string`, where a present `client` meant "answer out to that connection"
 * and an absent one meant "answer in to a system". A window has no connection id of its own — the window *is*
 * the client — so "a surface in this window asked" could not be said, and a feature's system and surface share
 * one ref, so the ref cannot supply it either. A third boolean would have worked and would have been the third
 * unchecked field; a variant is one the switch has to handle.
 *
 * Which channels exist depends on which side is answering, and `_replyTo` holds that table: the backend reaches
 * `bus` and `connection`, a window reaches `bus` and `window`. The two remaining cells are impossible and throw
 * — there is no window-to-window channel, and a window cannot address another window's connection.
 *
 * **`connection` covering two kinds of participant is a decision, not an oversight**, and splitting it is the
 * obvious tidy-up to refuse. A surface in another window and a claimed participant (`host/drive`) share that
 * variant, and the one place the difference matters already asks the authority rather than the asker:
 * `routeOutgoing` (`@apackdev/host/bus`'s `machine.ts`) looks the ref up in the participant claims and, for a
 * claimed name, delivers to the connection holding it instead of checking the event against a surface's
 * declared list. Tested, not merely intended — `participants.spec.ts`'s *"leaves an answer addressed to the
 * connection that asked"* is that path.
 *
 * So a fourth variant would be a *copy* of something re-derived at send time, and copies of this one go stale:
 * a claim lives exactly as long as its socket, while an answer's address is bound at entry, so a handler
 * that answers after an `await` could carry a tag that was true when the delivery opened and is not when the
 * answer is sent. The lookup cannot be wrong that way. It would also take `askerOf` — a leaf that imports
 * nothing but this module — a dependency on the claims registry, and grow `_replyTo`'s table from six cells to
 * eight with two more impossible ones to document.
 *
 * **What would change the answer**: an answer that has to be *shaped* differently per participant — a
 * different envelope, a different validation, a different failure — because the kind would then be needed when
 * the answer is built rather than when it is routed, and the lookup would have to move earlier. Diagnostics
 * are not that: `senderSuffix` already names the ref, which is the part anyone can act on.
 *
 * @internal Host and SDK only. Pack code never names it: an ask is answered by its `answers` table, which takes no address.
 */
export type _Asker =
  /** Over the backend bus, which is where a system is */
  | { kind: 'bus'; ref: string }
  /** Out over one connection, where a surface in another window or a claimed participant is */
  | { kind: 'connection'; ref: string; client: string }
  /** Inside this window, where a surface beside the answerer is */
  | { kind: 'window'; ref: string };

/**
 * The message being handled, as much of it as answering needs.
 *
 * @internal Host and SDK only. Pack code never names it: an ask is answered by its `answers` table, which takes no address.
 */
export interface _Delivery {
  /** The ref of the participant being handled. A send made during the delivery stamps it as `Message.sender`. */
  receiver: string;
  /** Where an answer goes, when the message said. Absent for a send that named no sender. */
  asker?: _Asker;
  /**
   * The call being handled, so an answer can name it as the one it answers.
   *
   * Read here rather than from the event, because an answer's address is bound as the handler is entered, so
   * an answer sent after an `await` still names the request it is for. `Message.call` is where it comes from,
   * and `answering ?? call` is what a door injects into the delivered event for the receiver's guards.
   */
  call?: string;
  /**
   * The event the receiver is handed — the very object, as the door passed it to the actor. A handler answers this
   * message and only this one: the same object forwarded on (a system routing it to a child) is still the message,
   * while an event a handler makes while handling it (a system telling its children something of its own) is not,
   * and its handler answers nobody — or it would answer the first message's asker about something it never asked.
   */
  event?: object;
  /**
   * Where the event is one of the receiver's declared asks: the failure kinds its contract declares, and whether a
   * handler took it. Set by the bus, which reads the declaration, and marked by the handler that answers it — after
   * the delivery the bus answers an ask no handler took (`unavailable`), so every ask is answered.
   */
  ask?: _AskDelivery;
}

/** An ask being delivered: what its declaration says it may fail as, and whether a handler took it */
export interface _AskDelivery {
  readonly kinds: readonly string[];
  taken: boolean;
}

/** The holder, and the whole mechanism — in a window and on the backend alike */
let current: _Delivery | undefined;

/**
 * The message being handled in this call stack, if any.
 *
 * @internal Host and SDK only: a pack's handler is handed the connection it serves as `client`.
 */
export function _currentDelivery(): _Delivery | undefined {
  return current;
}

/**
 * Runs `body` as the handling of `delivery`, restoring whatever was being handled before.
 *
 * @internal Called by the doors named above: `deliverAs` on the backend, `notifySurfaceActor`,
 * `sendToSurfaceActor` and `useSurface` in a window.
 */
export function _runDelivery<T>(delivery: _Delivery, body: () => T): T {
  const previous = current;
  current = delivery;
  try {
    return body();
  } finally {
    current = previous;
  }
}

