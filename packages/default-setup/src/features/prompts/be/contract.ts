// The prompts system's contract: what it receives, what its own children send it, what it sends its surface,
// and its context. Its own module, not the feature's types barrel: `#generated/types` star-exports that,
// and one `Contract` per feature would collide there. Codegen reads this without running anything.
import type { PromptAsks, IncomingPromptEvents, OutgoingPromptEvents } from './types.ts';

export type Contract = {
  incoming: IncomingPromptEvents
  outgoing: OutgoingPromptEvents
  asks: PromptAsks
}
