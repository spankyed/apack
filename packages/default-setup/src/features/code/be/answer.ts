// Who hears a code result, which every handler here rests on: the window that asked, and when nobody asked — the git
// watcher's refresh, an action — every window showing the code surface, which all show the one repository.
import { broadcastToSurface } from '#generated/events.ts';
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingCodeEvents } from './contract.ts';

/** Answers whoever asked, and tells every window when nobody did. Reply or broadcast, never both. */
export const answer = (reply: Reply<OutgoingCodeEvents> | undefined, event: OutgoingCodeEvents): void =>
  (reply ? reply(event) : broadcastToSurface('code', event));

/** \`answer\` bound to one handler's \`reply\`, for a handler that answers from callbacks it hands on */
export const answering = (reply: Reply<OutgoingCodeEvents> | undefined) => (event: OutgoingCodeEvents): void => answer(reply, event);
