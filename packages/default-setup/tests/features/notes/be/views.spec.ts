// The notes views and the answers to a window's writes, two windows at once. The tree reads no note's text, so typing
// in a note reaches the window with that note open and re-runs nothing else; every write is answered to the window
// that made it, since the surface holds its views behind its own unanswered writes.
import { describe, expect, it } from 'vitest'
import { startApp, takeSystemErrors } from '@apackdev/testing/harness'
import { repository } from '#generated/repository.ts'
import type { EARS } from '#generated/ears.ts'
import type { NoteDTO, NoteSummary } from '#generated/types.ts'

const NOTES = 'default-setup/notes'
const note = (title: string, content = '', parentId?: string) =>
  repository.noteCommands.create({ title, content, parentId }).id as EARS.EntityId
const titles = (update: { ok: boolean; value?: unknown }) => (update.ok ? (update.value as NoteSummary[]).map(each => each.title) : 'an error')

describe('the notes views', () => {
  it("reach the window with a note open with its text, and leave the other window's and the tree alone", async () => {
    const first = note('First', 'one')
    const second = note('Second', 'two')
    const app = await startApp({ systems: ['notes'] })
    const tree = app.watchView('notes', 'tree')
    const one = app.watchView<NoteDTO | null>('notes', 'note', { id: first })
    const other = app.watchView<NoteDTO | null>('notes', 'note', { id: second })
    expect(titles(await tree.next())).toEqual(['First', 'Second'])
    expect(await one.next()).toMatchObject({ ok: true, value: { content: 'one' } })
    expect(await other.next()).toMatchObject({ ok: true, value: { content: 'two' } })

    await app.send('notes', { type: 'UPDATE_NOTE', id: second, content: 'two, typed' })
    expect(await other.next()).toMatchObject({ ok: true, value: { content: 'two, typed' } })
    await app.settle()
    expect(one.updates, 'the other note\'s window heard nothing').toHaveLength(1)
    expect(tree.updates, 'and the tree, which reads no text, nothing either').toHaveLength(1)

    await app.send('notes', { type: 'UPDATE_NOTE', id: second, title: 'Second, renamed' })
    expect(titles(await tree.next())).toEqual(['First', 'Second, renamed'])
  })

  it('end a deleted note with null, move it to the trash, and drop it from the tree', async () => {
    const doomed = note('Doomed')
    const app = await startApp({ systems: ['notes'] })
    const open = app.watchView('notes', 'note', { id: doomed })
    const tree = app.watchView('notes', 'tree')
    const trash = app.watchView('notes', 'trash')
    await open.next(); await tree.next()
    expect(titles(await trash.next())).toEqual([])

    await app.send('notes', { type: 'DELETE_NOTE', id: doomed })
    expect(await open.next()).toMatchObject({ ok: true, value: null })
    expect(titles(await tree.next())).toEqual([])
    expect(titles(await trash.next())).toEqual(['Doomed'])
  })

  it('search titles, and list what the welcome page shows', async () => {
    note('Groceries'); note('Gardening'); note('Taxes')
    const seen = note('Seen')
    const app = await startApp({ systems: ['notes'] })
    expect(titles(await app.watchView('notes', 'search', { text: 'ga' }).next())).toEqual(['Gardening'])

    await app.send('notes', { type: 'VIEW_NOTE', id: seen })
    await app.send('notes', { type: 'UPDATE_NOTE', id: seen, favorite: true })
    const welcome = await app.watchView<{ recent: Array<{ title: string }>; favorites: Array<{ title: string }> }>('notes', 'recent', { limit: 20 }).next()
    expect(welcome.ok && welcome.value.recent.map(each => each.title)).toEqual(['Seen'])
    expect(welcome.ok && welcome.value.favorites.map(each => each.title)).toEqual(['Seen'])
  })
})

describe('a write to a note', () => {
  const asked = { sender: NOTES, client: 'c-main' }

  it('answers the window that created a note with it, and every tree has it', async () => {
    const app = await startApp({ systems: ['notes'] })
    await app.connect()
    const tree = app.watchView('notes', 'tree')
    await tree.next()

    const call = await app.send('notes', { type: 'CREATE_NOTE', title: 'Fresh' }, asked)
    const created = await app.nextEmit('notes', 'NOTE_CREATED', { answering: call }) as unknown as { note: NoteSummary }
    expect(created.note).toMatchObject({ title: 'Fresh', parentId: null })
    expect(created.note).not.toHaveProperty('content')
    expect(titles(await tree.next())).toEqual(['Fresh'])
  })

  it('answers each write, a landed one and a refused one alike, and runs one nobody asked for', async () => {
    const id = note('Note')
    const app = await startApp({ systems: ['notes'] })
    await app.connect()

    const landed = await app.send('notes', { type: 'UPDATE_NOTE', id, title: 'Renamed' }, asked)
    await app.nextEmit('notes', 'NOTE_WRITTEN', { answering: landed })
    const refused = await app.send('notes', { type: 'UPDATE_NOTE', id: 'Note-missing', title: 'Nothing' }, asked)
    expect(await app.nextEmit('notes', 'NOTE_WRITE_FAILED', { answering: refused })).toMatchObject({ error: expect.stringContaining('Note-missing') })

    await app.send('notes', { type: 'UPDATE_NOTE', id, title: 'Renamed by nobody' })
    expect(repository.noteQueries.byId(id)?.title).toBe('Renamed by nobody')
    expect(takeSystemErrors(), 'the asked refusal is its window\'s to show').toEqual([])

    // A refusal nobody asked for has no window to show it, so it is reported
    await app.send('notes', { type: 'UPDATE_NOTE', id: 'Note-missing', title: 'Nothing' })
    await app.settle()
    expect(takeSystemErrors()).toEqual([expect.objectContaining({ source: 'notes', message: expect.stringContaining('Note-missing') })])
  })
})
