// The threads repository's update: a null clears a field, since no field of the shape holds one, which is how an
// action (code no compiler checks) clears a thread's forced mode when onboarding ends
import { expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { query, EARS } from '#generated/ears.ts'

const thread = () => repository.threadCommands.create({ topic: 'Birth', instructions: '', forcedMode: 'Birth' }).id as EARS.EntityId<'Thread'>

it('clears a field given null, and writes the rest of the update', () => {
  const id = thread()
  repository.threadCommands.update(id, { forcedMode: null, topic: 'Welcome' })
  const row = query.ids(id).pickOne()!
  expect(row).not.toHaveProperty('forcedMode')
  expect(row.topic).toBe('Welcome')
  // A field already gone is no write, and no refusal
  expect(() => repository.threadCommands.update(id, { forcedMode: null })).not.toThrow()
})

/**
 * **Two blocks of a type, and only one holds the button.**
 *
 * A block is a row, and `writeMessageBlock` resolves one by *type* — which is right for a streaming writer
 * that owns the only block of its own, and wrong for anything walking a message's blocks. Writing them back
 * by type put the second one's content on the first one's row and left the second holding stale content.
 *
 * The case asserts both rows, because the defect wrote a correct-looking value to the wrong row: checking
 * only the block that was toggled passes while its neighbour carries the same buttons.
 */
it('toggles the button in the block that holds it, not the first of its type', () => {
  const threadId = thread()
  const { id } = repository.chatCommands.addMessage({
    threadId,
    text: 'Pick',
    sender: 'assistant',
    blocks: [
      { type: 'button-group', props: { buttons: [{ id: 'left', toggleStates: true, state: 'off' }] } },
      { type: 'button-group', props: { buttons: [{ id: 'right', toggleStates: true, state: 'off' }] } },
    ],
  })

  repository.chatCommands.updateMessageBlockResponse({ messageId: id, response: { buttonId: 'right' } })

  const blocks = repository.chatQueries.blocksOf(id)
  expect(blocks).toHaveLength(2)
  expect(blocks[0]!.props.buttons[0]).toMatchObject({ id: 'left', state: 'off' })
  expect(blocks[1]!.props.buttons[0]).toMatchObject({ id: 'right', state: 'on' })
})

/**
 * **A block is destroyed from two places and only one remembered its children.**
 *
 * A message being trashed or destroyed walks them; `removeMessageBlock` destroyed the block alone, which
 * left its text segments and tool entries as rows nothing reaches — invisible, since no read starts from
 * them. One function discards them now, so a third caller cannot forget.
 */
it('takes a block\'s children with it when the block is removed', () => {
  const threadId = thread()
  const { id } = repository.chatCommands.addMessage({
    threadId, text: 'working', sender: 'assistant',
    blocks: [{ type: 'tool-activity', props: { state: 'streaming' } }],
  })
  const blockId = query.ids(id).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)[0]!.target
  repository.chatCommands.writeToolEntry({ blockId, entry: { id: 'tool-1', tool: 'Read', summary: 'a.ts', status: 'ok' } })
  repository.chatCommands.appendMessageBlockText({ blockId, at: 0, text: 'thinking' })
  expect(query(EARS.Entity.ToolEntry).ids()).toHaveLength(1)
  expect(query(EARS.Entity.BlockText).ids()).toHaveLength(1)

  repository.chatCommands.removeMessageBlock({ messageId: id, type: 'tool-activity' })

  expect(query(EARS.Entity.ToolEntry).ids()).toEqual([])
  expect(query(EARS.Entity.BlockText).ids()).toEqual([])
})

/**
 * **A position taken from the count collides the moment one is removed.**
 *
 * Two blocks at 0 and 1, remove the first, and a count gives the next one 1 — beside the block already
 * there, so the order a read sorts by is a tie and which comes first is arbitrary. The position is the
 * furthest recorded plus one, which stays unique for the life of the message.
 */
it('gives a block added after a removal a position of its own', () => {
  const threadId = thread()
  const { id } = repository.chatCommands.addMessage({
    threadId, text: 'working', sender: 'assistant',
    blocks: [{ type: 'thinking', props: { content: 'first' } }, { type: 'tool-activity', props: { state: 'done' } }],
  })

  repository.chatCommands.removeMessageBlock({ messageId: id, type: 'thinking' })
  repository.chatCommands.writeMessageBlock({ messageId: id, block: { type: 'markdown', props: { content: 'last' } } })

  const positions = query.ids(id).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)
    .map((edge) => (edge.info as { index: number }).index)
  expect(new Set(positions).size, `two blocks share a position: ${positions.join(', ')}`).toBe(positions.length)
  // And the order a read gives them follows: the survivor, then the new one
  expect(repository.chatQueries.messageById(id)?.blocks?.map((block) => block.type)).toEqual(['tool-activity', 'markdown'])
})

/**
 * **A copied block must name its own row, and bring its entries' details with it.**
 *
 * `props.blockId` is what the component asks `entryDetails` for, so a block copied with the id it was read
 * under asks about a row in the thread it came from — one that is gone the moment that thread is deleted,
 * and one an import's database never had. And a read leaves `details` out on purpose, so a fork or an
 * export that copied what it read dropped every tool call's input and output silently.
 */
it('gives a copied block its own row and keeps its entries\' details', () => {
  const source = thread()
  const { id: messageId } = repository.chatCommands.addMessage({
    threadId: source, text: 'working', sender: 'assistant',
    blocks: [{ type: 'tool-activity', props: { state: 'done' } }],
  })
  const blockId = query.ids(messageId).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)[0]!.target
  repository.chatCommands.writeToolEntry({
    blockId,
    entry: { id: 'tool-1', tool: 'Read', summary: 'a.ts', status: 'ok', details: { output: 'the whole file' } },
  })
  repository.chatCommands.compactMessageBlock({ blockId })

  // What a copier reads, which is what a fork and an export both write somewhere else
  const copied = repository.chatQueries.blocksForCopy(messageId)
  expect(copied[0]!.props.entries[0].details, 'the details travel with the entry').toEqual({ output: 'the whole file' })

  const target = thread()
  const { id: forked } = repository.chatCommands.addMessage({
    threadId: target, text: 'working', sender: 'assistant', blocks: copied,
  })
  const newBlock = query.ids(forked).outEdges(EARS.RelKind.HAS_BLOCK, EARS.Entity.Block)[0]!.target

  expect(newBlock, 'a new row').not.toBe(blockId)
  const props = repository.chatQueries.messageById(forked)?.blocks?.[0]?.props
  expect(props?.blockId, 'which is the row the copy names').toBe(newBlock)
  // Held under the block's own attribute, as the app holds them — not left in the props a read carries
  expect(props?.entries?.[0]).not.toHaveProperty('details')
  expect(repository.chatQueries.entryDetails(newBlock)).toEqual({ 'tool-1': { output: 'the whole file' } })
})
