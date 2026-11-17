// The E2E suite's door to the backend's systems, `window.__e2eSystems`: what `@apackdev/testing`'s `app.send` and
// `app.ask` call, and nothing else does.
//
// **Through this window's connection, so a spec's send is a window's send.** A handler that answers the window it
// was asked from (`sendToWindow(client, …)`, a terminal sizing to whoever asked) answers this one, and the surface
// the spec is watching updates as it would for a person. A connection of the fixture's own would answer itself.
//
// **A door of its own** because the suite has no other: a send to a system is otherwise tRPC over the window's
// WebSocket, which only the renderer holds. Borrowing a door production code needs would make it load-bearing for
// the suite, and removing it would then break the suite for reasons that have nothing to do with it.
//
// `send` returns the API's acceptance rather than dropping a refusal into a toast as the shell's sends do, so a
// spec that names a system nothing provides, or an event it does not take, fails saying so.
//
// `ask` is a send with a return address. The window claims `HOST.e2e` on its connection before each ask
// (`bus.claim` grants a connection a name it already holds, and a reconnect has lost it), and sends with it as the
// `sender` and a fresh call, so the system's `reply` comes back here. `receiveE2eAnswer` takes it off the
// subscription before the shell sees it and settles the ask whose call it answers. Matched by the call, as every
// ask in the app is, so two asks in flight, or an unrelated broadcast of the same type, cannot be taken for each
// other.
import { HOST } from '@apackdev/host/fe';
import { newCall, type Message } from '@apackdev/sdk/events';
import { _performanceEnvelope } from '@apackdev/sdk/runtime';
import { trpc } from '@/transport';

type SystemEvent = Message['event'];

/** The asks waiting for an answer, by the call each was sent under */
const waiting = new Map<string, (answer: SystemEvent) => void>();

export interface E2eSystems {
  /** Sends a backend system an event, resolving once the API accepted it and rejecting with its refusal */
  send(to: string, event: SystemEvent): Promise<void>;
  /** Sends as `send` does, resolving with the event the system's `reply` answers it with */
  ask(to: string, event: SystemEvent): Promise<SystemEvent>;
}

export const e2eSystems: E2eSystems = {
  send: async (to, event) => {
    await trpc.bus.send.mutate(_performanceEnvelope({ to, event, call: newCall() }));
  },

  ask: async (to, event) => {
    await trpc.bus.claim.mutate({ as: HOST.e2e });
    const call = newCall();
    // Waiting before the send, so an answer that arrives before the mutation resolves is not missed
    const answer = new Promise<SystemEvent>((resolve) => { waiting.set(call, resolve); });
    try {
      await trpc.bus.send.mutate(_performanceEnvelope({ to, event, sender: HOST.e2e, call }));
    } catch (error) {
      waiting.delete(call);
      throw error;
    }
    return answer;
  },
};

/**
 * Takes a message addressed to `HOST.e2e` off the window's subscription, settling the ask it answers; `false` for
 * any other message, which goes on to the shell.
 *
 * Every message to that name is taken, an answer to no waiting ask included, since no surface could receive it.
 * That one is reported rather than dropped silently: it is a system answering one ask twice, or a call it was not
 * asked under, and either is a fault in the system.
 */
export function receiveE2eAnswer(message: Message): boolean {
  if (message.to !== HOST.e2e) return false;
  const settle = message.answering === undefined ? undefined : waiting.get(message.answering);
  if (settle === undefined) {
    console.warn(`[e2e-door] ${message.event.type} came to ${HOST.e2e} answering ${message.answering ?? 'no call'}, which no ask is waiting for`);
    return true;
  }
  waiting.delete(message.answering!);
  settle(message.event);
  return true;
}
