// Events the app's clients send its backend systems (the API's `bus.send`): checked against the registered systems,
// logged by type and target, and put on the root event bus the app bus listens to (the SDK's bound transport).
import { _rootEvents } from '@apackdev/sdk/runtime';
import { createLogger } from '@apackdev/sdk/logger';
import type { PackRegistry } from '../packs/registry.ts';
import { senderSuffix, type Message } from '@apackdev/sdk/events';

const logger = createLogger('app-events');

/** A client sent an event to a system that isn't registered, or of a type that system doesn't accept */
export class UnknownClientEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownClientEventError';
  }
}

/**
 * Checks a client's message against the systems in `registry` (`getEventValidationMap()`; a `*` entry accepts any type),
 * logs it and emits it on the root event bus. Throws `UnknownClientEventError` for an unknown system or event type.
 */
export function receiveClientEvent(registry: Pick<PackRegistry, 'getEventValidationMap'>, message: Message): void {
  const { to, from, event } = message;
  // The sending pack and what within it made the send, when the send stamped them (`defineEvents`,
  // `createActionEmitter`). A send that stamped neither carries none.
  const suffix = senderSuffix(message);
  const sender = suffix && ` sent${suffix}`;
  const validTypes = registry.getEventValidationMap().get(to);
  if (!validTypes) {
    throw new UnknownClientEventError(`Unknown system: "${to}"${sender}`);
  }
  if (!validTypes.has('*') && !validTypes.has(event.type)) {
    throw new UnknownClientEventError(`Unknown event "${event.type}" for system "${to}"${sender}`);
  }

  // The type, the target and who sent it — never the payload. `terminal.TERMINAL_INPUT` carries a keystroke,
  // so a payload here is every password typed at a `sudo` or `ssh` prompt written to `main.log` and
  // `main.jsonl`, which outlive the session and get attached to bug reports. A payload worth reading is worth
  // reading at the handler, where what it holds is known; a per-type allow-list at this seam is the deny-list
  // that rotted into this. Not even behind the debug gate: debug is what gets turned on when a terminal
  // misbehaves, which is exactly when keystrokes would be captured.
  logger.info(`→ Incoming: "${event.type}"`, { to, ...(from ? { from } : {}), ...(message.via ? { via: message.via } : {}) });
  _rootEvents.emitIncoming(message);
}
