import { _performanceCarrier, _withPerformanceDelivery } from '@apackdev/sdk/runtime';
// Handing an event to a surface in this window, named so the handler can be answered.
//
// **At the seam rather than in the shell, because more than one feature hands events to surfaces.** It was the
// application feature's, and the packs feature reaching it is the cross-feature import `check:specifiers`
// refuses — which left that feature sending to the shell directly, and a direct send is the one thing
// this exists to replace. A port two features need lives here, as `pack-frontends.ts` does.
//
// **Two functions, because a hand-off either answers a question or does not, and that is not a flag.** Every
// send to a surface in this window goes through one of them. Which one a call site picks says what it is doing,
// and the asked one takes an address that cannot be absent — so a caller holding a maybe-asker has to say what
// it does when there is nobody, in the branch rather than in a sentinel the type could not check.
import type { SurfaceEvent } from '@apackdev/sdk/fe';
import { _callOn, _runDelivery, type _Asker, type Message } from '@apackdev/sdk/events';

/** Any surface handle that accepts events. */
export interface SurfaceEventTarget {
  send(event: SurfaceEvent): void;
}

/**
 * Hands a surface an event nobody asked for: a lifecycle event, a hotkey, a navigation, a pack coming or going.
 * The handler is handed no `reply`, which is what "nobody asked" is meant to look like.
 */
export function notifySurfaceActor(actor: SurfaceEventTarget, ref: string, event: SurfaceEvent, call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>): void {
  const delivered = call === undefined ? event : { ...event, ..._callOn(call) };
  const send = () => actor.send(delivered);
  _runDelivery({ receiver: ref, event: delivered, ...(call?.call === undefined ? {} : { call: call.call }) }, () =>
    _withPerformanceDelivery(delivered, _performanceCarrier(call?.diagnostics), send));
}

/**
 * Hands a surface an event someone is waiting on, naming the asker for as long as it is handled, so the
 * handler is handed a `reply` that reaches them.
 */
export function sendToSurfaceActor(actor: SurfaceEventTarget, ref: string, event: SurfaceEvent, asker: _Asker, call?: Pick<Message, 'call' | 'answering' | 'diagnostics'>): void {
  const delivered = call === undefined ? event : { ...event, ..._callOn(call) };
  const send = () => actor.send(delivered);
  _runDelivery({ receiver: ref, asker, event: delivered, ...(call?.call === undefined ? {} : { call: call.call }) }, () =>
    _withPerformanceDelivery(delivered, _performanceCarrier(call?.diagnostics), send));
}
