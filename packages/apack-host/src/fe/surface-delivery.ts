import { _performanceCarrier, _withPerformanceDelivery } from '@apackdev/sdk/runtime';
// Handing an event to an actor in this window, named so the handler can be answered.
//
// **At the seam rather than in the shell, because more than one feature hands events to actors.** It was the
// application feature's, and the packs feature reaching it is the cross-feature import `check:specifiers`
// refuses — which left that feature sending to the shell's actor directly, and a direct send is the one thing
// this exists to replace. A port two features need lives here, as `pack-frontends.ts` does.
//
// **Two functions, because a hand-off either answers a question or does not, and that is not a flag.** Every
// send to an actor in this window goes through one of them. Which one a call site picks says what it is doing,
// and the asked one takes an address that cannot be absent — so a caller holding a maybe-asker has to say what
// it does when there is nobody, in the branch rather than in a sentinel the type could not check.
import type { AnyActorRef, AnyEventObject } from 'xstate';
import { _callOn, _runDelivery, type _Asker, type Message } from '@apackdev/sdk/events';

/**
 * Hands an actor an event nobody asked for: a lifecycle event, a hotkey, a navigation, a pack coming or going.
 * The handler is handed no `reply`, which is what "nobody asked" is meant to look like.
 *
 * The common case, and so the short one — twelve call sites against the two that carry an address.
 */
export function notifySurfaceActor(actor: AnyActorRef, ref: string, event: AnyEventObject, call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>): void {
  const delivered = call === undefined ? event : { ...event, ..._callOn(call) };
  const send = () => actor.send(delivered);
  _runDelivery({ receiver: ref, event: delivered, ...(call?.call === undefined ? {} : { call: call.call }) }, () =>
    _withPerformanceDelivery(delivered, _performanceCarrier(call?.diagnostics), send));
}

/**
 * Hands an actor an event someone is waiting on, naming the asker for as long as it is handled, so the
 * handler is handed a `reply` that reaches them.
 *
 * **The address is a parameter and cannot be absent**, which is the whole of what the shape enforces. It was
 * `_Asker | undefined` with a `NOBODY_ASKED` constant beside it, and twelve of the fourteen call sites passed
 * that constant — so the sentinel *was* the default spelling, and a careless fifteenth site would have copied
 * it from its neighbour exactly as readily as it would have omitted an argument. A required parameter whose
 * usual value is a name for nothing asks for a token, not a decision. Two functions ask for the decision.
 *
 * What no signature prevents is a caller that *has* an asker calling `notifySurfaceActor` anyway. That is a
 * semantic choice, and `tests/features/application/fe/surface-reply.spec.ts` is what catches it.
 *
 * **The scope a *sender* was in does not reach the receiver**, which is the second thing this buys and the
 * reason the bypasses were worth closing: measured 2026-10-06, a surface reaching the shell's actor directly
 * from inside its own delivery left the shell handling the event as that surface, with that surface's asker — so
 * a send the shell made there was stamped with a surface that did not make it, and a handler it ran was handed a
 * `reply` addressed to a system that had asked the surface something else.
 *
 * **Both take an actor, not a lookup that may miss.** Whether a missing surface is a bug or an ordinary race
 * differs by call site — the shell's own lifecycle sends address a surface it just spawned, where absence is an
 * invariant broken and worth a crash, while a send arriving for a surface whose pack has unloaded is neither. A
 * `?.` here would have levelled those two to the quieter one, which it briefly did.
 */
export function sendToSurfaceActor(actor: AnyActorRef, ref: string, event: AnyEventObject, asker: _Asker, call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>): void {
  const delivered = call === undefined ? event : { ...event, ..._callOn(call) };
  const send = () => actor.send(delivered);
  _runDelivery({ receiver: ref, asker, event: delivered, ...(call?.call === undefined ? {} : { call: call.call }) }, () =>
    _withPerformanceDelivery(delivered, _performanceCarrier(call?.diagnostics), send));
}
