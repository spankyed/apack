// The prompts views, two windows at once: each window's subscription is its own, so an edit or a delete reaches the
// windows showing that prompt and no other, one window reading further down the list moves nobody else's, and an
// import lists each prompt once. Each `watchView` is one window's `useView`.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import type { PromptEntity } from '@apackdev/sdk'

const create = (label: string) => repository.promptCommands.create({ label, inputs: {}, templateFn: 'return "hi"' })
const labels = (prompts: PromptEntity[]) => prompts.map((prompt) => prompt.label)

describe('the prompts views', () => {
  it("reach each window with its own open prompt's edits and deletes, and leave the other window's alone", async () => {
    const a = create('a')
    const b = create('b')
    const app = await startApp({ systems: ['prompts'] })
    const first = app.watchView<PromptEntity | null>('prompts', 'byId', { id: a.id })
    const second = app.watchView<PromptEntity | null>('prompts', 'byId', { id: b.id })
    expect(await first.next()).toMatchObject({ ok: true, value: { label: 'a' } })
    expect(await second.next()).toMatchObject({ ok: true, value: { label: 'b' } })

    await app.send('prompts', { type: 'UPDATE_PROMPT', promptId: b.id, label: 'b, renamed' })
    expect(await second.next()).toMatchObject({ ok: true, value: { label: 'b, renamed' } })
    await app.send('prompts', { type: 'DELETE_PROMPT', promptId: b.id })
    expect(await second.next(), 'the deleted prompt is gone from the window that had it open').toMatchObject({ ok: true, value: null })

    await app.settle()
    expect(first.updates, 'the other window heard nothing').toHaveLength(1)
  })

  it('keep each window on its own page', async () => {
    for (const label of ['one', 'two', 'three']) create(label)
    const app = await startApp({ systems: ['prompts'] })
    const short = app.watchView<{ prompts: PromptEntity[]; totalCount: number }>('prompts', 'list', { limit: 1, categories: [] })
    const long = app.watchView<{ prompts: PromptEntity[]; totalCount: number }>('prompts', 'list', { limit: 2, categories: [] })
    const shortPage = await short.next()
    const longPage = await long.next()
    expect(shortPage.ok && { shown: labels(shortPage.value.prompts), total: shortPage.value.totalCount }).toEqual({ shown: ['one'], total: 3 })
    expect(longPage.ok && labels(longPage.value.prompts)).toEqual(['one', 'two'])

    // The first window reads further down, which is a subscription of its own: the second window's page stays put
    short.stop()
    const further = app.watchView<{ prompts: PromptEntity[]; totalCount: number }>('prompts', 'list', { limit: 3, categories: [] })
    const furtherPage = await further.next()
    expect(furtherPage.ok && labels(furtherPage.value.prompts)).toEqual(['one', 'two', 'three'])
    await app.settle()
    expect(long.updates).toHaveLength(1)
  })

  it('list each imported prompt once, the import arriving as one change', async () => {
    const app = await startApp({ systems: ['prompts'] })
    const list = app.watchView<{ prompts: PromptEntity[]; totalCount: number }>('prompts', 'list', { limit: null, categories: [] })
    expect(await list.next()).toMatchObject({ ok: true, value: { prompts: [], totalCount: 0 } })

    await app.send('prompts', { type: 'IMPORT_PROMPTS', prompts: ['x', 'y', 'z'].map((label) => ({ label, templateFn: 'return "hi"' })) })
    const imported = await list.next()
    expect(imported.ok && { shown: labels(imported.value.prompts), total: imported.value.totalCount }).toEqual({ shown: ['x', 'y', 'z'], total: 3 })
    await app.settle()
    expect(list.updates, 'three writes in one handler are one re-run').toHaveLength(2)
  })

  it('filter the list by category, a prompt in none being in no filter', async () => {
    repository.promptCommands.create({ label: 'creative', inputs: {}, templateFn: 'return ""', category: 'Creative' })
    repository.promptCommands.create({ label: 'technical', inputs: {}, templateFn: 'return ""', category: 'Technical' })
    create('uncategorised')
    const app = await startApp({ systems: ['prompts'] })
    const creative = app.watchView<{ prompts: PromptEntity[]; totalCount: number }>('prompts', 'list', { limit: 20, categories: ['Creative'] })
    const page = await creative.next()
    expect(page.ok && { shown: labels(page.value.prompts), total: page.value.totalCount }).toEqual({ shown: ['creative'], total: 1 })
  })
})
