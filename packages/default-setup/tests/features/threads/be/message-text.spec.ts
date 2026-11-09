// A streamed reply's text is appended to child rows and folded into `Message.text` when the turn ends.
// What these hold is the consequence that is not obvious: `Message.text` is the field the text index
// reads, so a tail still in segments is a tail no search finds — and a turn can end without folding.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import { EARS, query } from '#generated/ears.ts'

const thread = () => repository.threadCommands.create({ topic: 'Turn', instructions: '' }).id as EARS.EntityId

/**
 * A message whose text is a prefix on the row and the rest in segments, as a streaming turn leaves it.
 *
 * `addMessage` trims, so the seam must not fall on a space — the offset is into what the row holds. In the
 * real flow this cannot bite: the writer's offsets are its own buffer's and it appends from 0, splicing
 * over the `Thinking…` placeholder.
 */
function streaming(threadId: EARS.EntityId, prefix: string, tail: string) {
  const { id } = repository.chatCommands.addMessage({ threadId, text: prefix, sender: 'assistant', skipRelink: true })
  repository.chatCommands.appendMessageText({ messageId: id, at: prefix.length, text: tail })
  return id
}

describe('a message whose text is still arriving', () => {
  it('reads as the whole text, prefix and segments together', async () => {
    await startApp({ systems: ['threads'] })
    const id = streaming(thread(), 'the first half', ' and the second')

    expect(repository.chatQueries.messageById(id)?.text).toBe('the first half and the second')
  })

  /**
   * **The behaviour change this introduces, stated as a test rather than a comment.**
   *
   * `.search` reads `Message.text`, which holds the prefix, so a term only in the tail is not found until
   * a fold. Before this, the row was rewritten whole on every commit, so search was behind by one commit
   * instead of one fold.
   */
  it('is searchable by its prefix, and by its tail once folded', async () => {
    await startApp({ systems: ['threads'] })
    const threadId = thread()
    const id = streaming(threadId, 'alpha beginning', ' omega ending')

    const found = (text: string) => repository.chatQueries.searchMessages(text).map((hit) => hit.messageId)
    expect(found('alpha')).toContain(id)
    expect(found('omega')).not.toContain(id)

    repository.chatCommands.foldMessageText({ messageId: id })

    expect(found('omega')).toContain(id)
    expect(query.ids(id).outEdges(EARS.RelKind.HAS_MESSAGE_TEXT, EARS.Entity.MessageText)).toEqual([])
  })

  /**
   * The repair for the one exit a turn's owner cannot cover: the process ending mid-turn. Nothing streams
   * at boot, so a message holding segments then was left unfolded — the marker, in place of a status.
   */
  it('is folded at boot when a turn ended without folding', async () => {
    await startApp({ systems: ['threads'] })
    const id = streaming(thread(), 'cut', ' short')

    expect(repository.chatCommands.foldStrandedMessageText()).toBe(1)

    expect(query.ids(id).pickOne(['text'] as const)?.text).toBe('cut short')
    // And nothing to fold the second time
    expect(repository.chatCommands.foldStrandedMessageText()).toBe(0)
  })

  /** A segment is a turn's working state and never the user's, so it goes with the message */
  it('loses its segments when its thread is deleted', async () => {
    await startApp({ systems: ['threads'] })
    const threadId = thread()
    streaming(threadId, 'going', ' away')
    expect(query(EARS.Entity.MessageText).ids()).toHaveLength(1)

    repository.threadCommands.delete(threadId)

    expect(query(EARS.Entity.MessageText).ids()).toEqual([])
  })
})
