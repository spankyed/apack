// Who hears the outcome of a thread operation, which is the one branch several of them rest on.
//
// Opening a thread was broadcast, so **every** window loaded that thread's chat and switched to it: a window
// showing thread Y was yanked to thread X because someone clicked X in another window. The tab that follows
// amplified it — each window then asked for its tab and each answer went to all of them again.
//
// It takes the answer rather than finding one, so the two arms are ordinary arguments and a service can be
// told how to answer without reaching for the delivery in scope. Reply **or** broadcast, never both: a window
// showing the result of work it did not do is the whole defect.
import { broadcastToSurface } from '#generated/events.ts';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingThreadsEvents } from './types.ts';

/** What may fall back to every window: a command's outcome, which someone must hear, and never data a window shows */
export type ThreadsOutcomeType = 'SHOW_THREAD' | 'THREAD_CHAT_ERROR' | 'THREADS_EXPORT_FAILED' | 'THREADS_EXPORTED' | 'THREADS_IMPORT_FAILED' | 'THREADS_IMPORTED'
export type ThreadsOutcome = Extract<OutgoingThreadsEvents, { type: ThreadsOutcomeType }>

/**
 * Answers whoever asked, and tells every window when nobody did.
 *
 * The fallback is not a safety net, it is the right answer for an ask with no sender: a thread opened by an
 * action — onboarding, a session restore, a summarise — has no window waiting on it, and every window showing
 * threads should follow. Ten of the fourteen callers that open a thread chat are action code, which runs a tick
 * after whatever triggered it (`delivery-is-synchronous.spec.ts`), so they have no sender to answer and could
 * not acquire one by being written differently.
 */
export const answer = (
  reply: Reply<OutgoingThreadsEvents> | undefined,
  event: ThreadsOutcome,
): void => (reply ? reply(event) : broadcastToSurface('threads', event));

// Named `answer` to match the five sibling features' helpers, which `an-outcome-goes-to-whoever-asked.spec.ts`
// finds by the call in front of an outcome's payload. The module name says whose it is; only this feature's
// needed a module of its own, because a service sends on the handler's behalf and needs the same decision.
