// The E2E suite's door to the backend's systems, `window.__e2eSystems`: what `@apackdev/testing`'s `app.send` and
// `app.ask` call, and nothing else does.
//
// Rides directly over this window's `@apackdev/link` connection so asks correlate natively by per-link id without
// claiming a participant name, and `send` rejects on server validation refusal.
import { _answered, _failedAnswer, newCall, type AskFailure, type Message } from '@apackdev/sdk/events';
import { _performanceCarrier, _performanceEnvelope } from '@apackdev/sdk/runtime';
import { windowTransport } from '@/transport';

type SystemEvent = Message['event'];

export interface E2eSystems {
  /** Sends a backend system an event, resolving once the API accepted it and rejecting with its refusal */
  send(to: string, event: SystemEvent): Promise<void>;
  /** Executes a backend ask natively over `@apackdev/link`, returning the `ASK_ANSWERED` or `ASK_FAILED` event */
  ask(to: string, event: SystemEvent): Promise<SystemEvent>;
}

export const e2eSystems: E2eSystems = {
  send: async (to, event) => {
    await windowTransport.linkSend(_performanceEnvelope({ to, event, call: newCall() }));
  },

  ask: async (to, event) => {
    const { type, ...args } = event;
    const outcome = await windowTransport.linkAsk(to, type, args, {
      diagnostics: _performanceCarrier(),
    });
    return outcome.ok
      ? _answered(type, outcome.value)
      : _failedAnswer(type, outcome.failure as AskFailure);
  },
};
