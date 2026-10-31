// The notes a message brings beside the ones it mentions: fused from how much each matters from the mentioned notes,
// by the links between notes, and how well it matches the message's words (`noteQueries.relatedToAll`)
import { describe, expect, it } from 'vitest'
import { repository } from '#generated/repository.ts'
import { resolveReferences } from '#features/threads/be/services/chat.ts'
import type { EARS } from '#generated/ears.ts'

const link = (id: string) => `[see](apack-ref://note/${id})`
const note = (title: string, content = '') => repository.noteCommands.create({ title, content }).id as EARS.EntityId
const mention = (refId: string, label: string) => ({ refType: 'note' as const, refId, shortCode: '', label })

describe('the notes related to a message', () => {
  it('fuse the notes linked to the mentioned ones with those matching its words, the mentioned ones left out', () => {
    const far = note('Far', 'nothing here')
    const linked = note('Linked', link(far))
    const both = note('Both', 'the rollout checklist')
    const words = note('Words', 'rollout notes')
    note('Unrelated', 'nothing here')
    const mentioned = note('Mentioned', `${link(linked)} ${link(both)}`)

    const chosen = repository.noteQueries.relatedToAll([mentioned], 'rollout', 10)
    expect(chosen[0], 'linked and matching both ranks first').toBe(both)
    expect(chosen).toEqual(expect.arrayContaining([linked, far, words]))
    expect(chosen).not.toContain(mentioned)
    expect(repository.noteQueries.relatedToAll([mentioned], 'rollout', 2)).toHaveLength(2)
    expect(repository.noteQueries.relatedToAll([mentioned], '', 10), 'no words: the links alone').toEqual(
      expect.arrayContaining([both, linked, far]))
    expect(repository.noteQueries.relatedToAll([mentioned], '', 10)).not.toContain(words)
  })

  it('follow the mentioned notes in the prompt, labelled as related and cut to a length, and only when a note is mentioned', async () => {
    const long = note('Long', `${'word '.repeat(1000)}`)
    const mentioned = note('Mentioned', link(long))
    const { textPrefix } = await resolveReferences({ context: [mention(mentioned, 'Mentioned')] }, 'what is this')
    expect(textPrefix).toContain('--- Note: Mentioned ---')
    const related = textPrefix.slice(textPrefix.indexOf('--- Related note: Long ---'))
    expect(related.startsWith('--- Related note: Long ---')).toBe(true)
    expect(related.length).toBeLessThan(2100)
    expect(textPrefix).not.toContain('--- Related note: Mentioned')

    const { textPrefix: none } = await resolveReferences({ files: [{ path: '/tmp/a.txt', name: 'a.txt' } as never] }, 'word')
    expect(none).not.toContain('Related note')
  })
})
