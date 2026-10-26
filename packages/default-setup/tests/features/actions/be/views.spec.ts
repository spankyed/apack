// The actions views, two windows at once: each window's subscription is its own, so an edit or a delete reaches the
// windows showing that action and no other, one window reading further down the list moves nobody else's, and an
// import lists each action once. Each `watchView` is one window's `useView`.
import { describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import type { ActionEntity } from '@apackdev/sdk'

const create = (label: string) => repository.actionCommands.create({ label, input: {}, actionFn: 'return "hi"' })
const labels = (actions: ActionEntity[]) => actions.map((action) => action.label)

describe('the actions views', () => {
  it("reach each window with its own open action's edits and deletes, and leave the other window's alone", async () => {
    const a = create('a')
    const b = create('b')
    const app = await startApp({ systems: ['actions'] })
    const first = app.watchView<ActionEntity | null>('actions', 'byId', { id: a.id })
    const second = app.watchView<ActionEntity | null>('actions', 'byId', { id: b.id })
    expect(await first.next()).toMatchObject({ ok: true, value: { label: 'a' } })
    expect(await second.next()).toMatchObject({ ok: true, value: { label: 'b' } })

    await app.send('actions', { type: 'UPDATE_ACTION', actionId: b.id, label: 'b, renamed' })
    expect(await second.next()).toMatchObject({ ok: true, value: { label: 'b, renamed' } })
    await app.send('actions', { type: 'DELETE_ACTION', actionId: b.id })
    expect(await second.next(), 'the deleted action is gone from the window that had it open').toMatchObject({ ok: true, value: null })

    await app.settle()
    expect(first.updates, 'the other window heard nothing').toHaveLength(1)
  })

  it('keep each window on its own page', async () => {
    for (const label of ['one', 'two', 'three']) create(label)
    const app = await startApp({ systems: ['actions'] })
    const short = app.watchView<{ actions: ActionEntity[]; totalCount: number }>('actions', 'list', { limit: 1, categories: [] })
    const long = app.watchView<{ actions: ActionEntity[]; totalCount: number }>('actions', 'list', { limit: 2, categories: [] })
    const shortPage = await short.next()
    const longPage = await long.next()
    expect(shortPage.ok && { shown: labels(shortPage.value.actions), total: shortPage.value.totalCount }).toEqual({ shown: ['one'], total: 3 })
    expect(longPage.ok && labels(longPage.value.actions)).toEqual(['one', 'two'])

    // The first window reads further down, which is a subscription of its own: the second window's page stays put
    short.stop()
    const further = app.watchView<{ actions: ActionEntity[]; totalCount: number }>('actions', 'list', { limit: 3, categories: [] })
    const furtherPage = await further.next()
    expect(furtherPage.ok && labels(furtherPage.value.actions)).toEqual(['one', 'two', 'three'])
    await app.settle()
    expect(long.updates).toHaveLength(1)
  })

  it('list each imported action once, the import arriving as one change', async () => {
    const app = await startApp({ systems: ['actions'] })
    const list = app.watchView<{ actions: ActionEntity[]; totalCount: number }>('actions', 'list', { limit: null, categories: [] })
    expect(await list.next()).toMatchObject({ ok: true, value: { actions: [], totalCount: 0 } })

    await app.send('actions', { type: 'IMPORT_ACTIONS', actions: ['x', 'y', 'z'].map((label) => ({ label, actionFn: 'return "hi"' })) })
    const imported = await list.next()
    expect(imported.ok && { shown: labels(imported.value.actions), total: imported.value.totalCount }).toEqual({ shown: ['x', 'y', 'z'], total: 3 })
    await app.settle()
    expect(list.updates, 'three writes in one handler are one re-run').toHaveLength(2)
  })

  it('filter the list by category, a action in none being in no filter', async () => {
    repository.actionCommands.create({ label: 'creative', input: {}, actionFn: 'return ""', category: 'Creative' })
    repository.actionCommands.create({ label: 'technical', input: {}, actionFn: 'return ""', category: 'Technical' })
    create('uncategorised')
    const app = await startApp({ systems: ['actions'] })
    const creative = app.watchView<{ actions: ActionEntity[]; totalCount: number }>('actions', 'list', { limit: 20, categories: ['Creative'] })
    const page = await creative.next()
    expect(page.ok && { shown: labels(page.value.actions), total: page.value.totalCount }).toEqual({ shown: ['creative'], total: 1 })
  })
})
