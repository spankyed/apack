// Names the message a system is handling, for the duration of the call that delivers it.
//
// **It is a plain variable, set and restored around the send, and that is the whole mechanism** — the same
// one the renderer uses, so the two halves of the app behave identically and there is one thing to know.
//
// It was an `AsyncLocalStorage` until this file said otherwise, because `reply()` read the scope *at the
// moment it was called* and a backend handler routinely answers after an `await`. That requirement left when
// `reply` became something a handler is *handed*: the wrapper reads the delivery synchronously as the handler
// is entered (`_replyTo(_currentDelivery())`, `@apackdev/sdk/framework`), before any `await` can have happened,
// and the handler closes over the result. Measured on removal — the whole host suite (3077) and the pack
// suite (787) passed, `reply.spec.ts`'s two-overlapping-asks case included, which is the case its own header
// named as the one thing a single variable could not do.
//
// **What is given up is a label on four sends.** Across both packages, four sends are made after an `await`
// inside one action — `database`'s `resetDatabase`, which fires `RESTART_BRAIN` and three surface
// notifications. None of them is answered, so none needs a return address, and `Message.from` still names the
// pack because that is stamped from the pack's identity rather than from here.
//
// **What is gained is more than one mechanism instead of two.** An async store is inherited by anything the
// handler creates inside it, a timer included — so a send made minutes later, long after the asker stopped
// waiting, carried that asker's address, and a `reply` made there would have answered a request nobody was
// listening for. Binding at entry cannot do that: a handler either took an answer with it or it did not.
import { _runDelivery, type _Asker, type Message } from '@apackdev/sdk/events';

/**
 * The way back to whoever sent this message, read off the envelope.
 *
 * **One reader, because the two doors used to each build it and could disagree.** A `sender` with a `client` is
 * a surface or a claimed participant on that connection; a `sender` without one came from the backend, so it is
 * a system reachable over the bus; no `sender` means nobody said where an answer would go, and there is then
 * nothing for a handler to answer with.
 *
 * `client` is never read from the wire — the API mints it per connection and stamps it on the way in — so this
 * is a return address a sender cannot forge into pointing at someone else's window.
 */
function askerOf({ sender, client }: Pick<Message, 'sender' | 'client'>): _Asker | undefined {
  if (sender === undefined) return undefined;
  return client === undefined ? { kind: 'bus', ref: sender } : { kind: 'connection', ref: sender, client };
}

/**
 * Runs `body` as the handling of `message`, whose event the receiver is handed as `event`: a send made inside it
 * carries the handler's ref as `Message.sender`, and a handler of that event is handed the answer for this message.
 *
 * It takes the envelope rather than a prepared delivery so that reading a return address happens in one place
 * (`askerOf`), which is what stops the bus's two doors from drifting apart.
 *
 * Synchronous by design — see the header. A send a handler makes after an `await` carries no sender, which
 * `tests/bus/delivery-is-synchronous.spec.ts` pins, so the limit is a decision rather than a surprise.
 */
export function deliverAs<T>(message: Pick<Message, 'to' | 'sender' | 'client' | 'call'>, event: object, body: () => T): T {
  return _runDelivery({ receiver: message.to, asker: askerOf(message), event, ...(message.call === undefined ? {} : { call: message.call }) }, body);
}
