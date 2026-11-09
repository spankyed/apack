// The threads repository's update: a null clears a field, since no field of the shape holds one, which is how an
// action (code no compiler checks) clears a thread's forced mode when onboarding ends
import { expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { query, type EARS } from '#generated/ears.ts'

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
