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
