// The notes system's contract: what it receives, what its own children send it, what it sends its surface,
// and its context. Its own module, not the feature's types barrel: `#generated/types` star-exports that,
// and one `Contract` per feature would collide there. Codegen reads this without running anything.
import type { IncomingNoteEvents, NoteAsks, OutgoingNotesEvents } from './types.ts';

export type Contract = {
  incoming: IncomingNoteEvents
  outgoing: OutgoingNotesEvents
  asks: NoteAsks
}
