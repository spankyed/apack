// What a message's view costs to read while a turn streams, which is the other half of what a turn costs.
//
// **The writes were bounded and the reads were not.** A tool entry is a row and is written once, but
// `details.output` is the whole tool result — a `Read` of a large file is that file — and it was carried in
// the block's props. A message's view re-runs on every append, so every re-run assembled every tool's full
// output to draw rows showing a 120-character summary of each. The cost was O(re-runs x total output) on a
// read path, where the write path had just been brought to O(total output).
//
// So `details` is its own read now (`entryDetails`), asked for by the window that has the block open. These
// cases hold both halves: what the message's view carries, and that the details are still reachable.
import { describe, expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { type EARS } from '#generated/ears.ts'

/** A tool output the size the product really stores: a file read, not a status line */
const OUTPUT = 'x'.repeat(4_096)
const TOOLS = 60

function turnWithTools(): { messageId: EARS.EntityId; blockId: EARS.EntityId } {
  const threadId = repository.threadCommands.create({ topic: 'A turn', instructions: '' }).id as EARS.EntityId<'Thread'>
  const messageId = repository.chatCommands.addMessage({ threadId, text: '', sender: 'assistant' }).id as EARS.EntityId

  // The write answers its row id, which is what a streaming writer holds. A block carries `blockId` in its
  // props only once it has entries, there being nothing to ask details for before then
  const blockId = repository.chatCommands.writeMessageBlock({
    messageId,
    block: { type: 'tool-activity', props: { label: 'Working', state: 'streaming', defaultOpen: false } },
  })!

  for (let tool = 0; tool < TOOLS; tool++) {
    repository.chatCommands.writeToolEntry({
      blockId,
      entry: {
        id: `tool-${tool}`,
        tool: 'Read',
        summary: `src/file-${tool}.ts`,
        status: 'ok',
        outputSummary: `${OUTPUT.slice(0, 117)}…`,
        details: { output: OUTPUT },
      } as never,
    })
  }
  return { messageId, blockId }
}

/** The bytes a read of the message's blocks hands back, which is what its view sends a window */
const readBytes = (messageId: EARS.EntityId) => JSON.stringify(repository.chatQueries.blocksOf(messageId)).length

describe('what a streaming message costs to read', () => {
  /**
   * **The bound this split exists for**, stated as a multiple of what the rows hold rather than a byte
   * count: a view re-runs on every append, so what matters is whether one re-run carries the turn's whole
   * output or only what its rows draw.
   *
   * **Measured on this fixture — 60 tools each with a 4KB output, as the product stores them: one read was
   * 259,866 bytes and is now 12,665, which is 20.5x apart.** What multiplies it is the number of times the
   * view re-runs, which for a streaming turn is once per append and once per entry write, so the figure to
   * compare is per re-run rather than per turn.
   *
   * The bound is absolute rather than derived from `OUTPUT`, because one derived from it would scale with
   * the fixture and could not catch `details` being carried again.
   */
  it('carries what the rows draw, not every tool output', () => {
    const PER_ENTRY_CEILING = 400
    const { messageId } = turnWithTools()

    const bytes = readBytes(messageId)

    // Each entry's row fields are a tool name, a path, a status and a capped summary — a few hundred bytes.
    // Carrying `details` put a whole 4KB output in each, which this ceiling is an order of magnitude under
    expect(bytes).toBeLessThan(TOOLS * PER_ENTRY_CEILING)
  })

  /** And the details are still there, for the window that opens the block */
  it('serves every entry its full output through its own read', () => {
    const { blockId } = turnWithTools()

    const details = repository.chatQueries.entryDetails(blockId)

    expect(Object.keys(details)).toHaveLength(TOOLS)
    expect(details['tool-7']?.output).toBe(OUTPUT)
  })
})

/**
 * **A finished turn is the case most of a thread is in**, and the one where the two bounds meet.
 *
 * `compactMessageBlock` folds a block's children into it when its writer finishes, so the entry rows a
 * hover would have read are gone. Folding the details into `props` with the rest would have put the turn's
 * whole output back into every read of the message — which is the cost this split exists to remove, paid
 * for the life of the thread rather than the length of the turn. They go under their own attribute instead,
 * which a message's read does not name.
 */
describe('after its writer finished and the block was compacted', () => {
  it('still serves every entry its full output, and still reads small', () => {
    const { messageId, blockId } = turnWithTools()

    repository.chatCommands.compactMessageBlock({ blockId })

    // The rows are gone: this is the state a thread sits in, not a transient one
    expect(repository.chatQueries.blocksOf(messageId)).toHaveLength(1)
    expect(readBytes(messageId)).toBeLessThan(TOOLS * 400)

    const details = repository.chatQueries.entryDetails(blockId)
    expect(Object.keys(details)).toHaveLength(TOOLS)
    expect(details['tool-7']?.output).toBe(OUTPUT)
  })
})
