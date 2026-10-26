// Who hears a code result, which every handler here rests on: the window that asked, and nobody else. A code result
// is data its asker shows — a file, a diff, a status, a pull request — so with no asker there is nobody to show it to.
// What happens unasked — a file changing on disk, the repository changing, the directory moving, a terminal's
// lifecycle — is news, broadcast where it happens with no listing on it, and each window asks for what it shows.
import type { Reply } from '@apackdev/sdk/events';
import type { OutgoingCodeEvents } from './contract.ts';

/** Answers whoever asked; a result nobody asked for goes nowhere */
export const answer = (reply: Reply<OutgoingCodeEvents> | undefined, event: OutgoingCodeEvents): void => reply?.(event);

/** `answer` bound to one handler's `reply`, for a handler that answers from callbacks it hands on */
export const answering = (reply: Reply<OutgoingCodeEvents> | undefined) => (event: OutgoingCodeEvents): void => answer(reply, event);
