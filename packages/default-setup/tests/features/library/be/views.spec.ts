// The library views and the answers to a window's writes. The index and each folder a window shows are views, so a
// write reaches every window showing what it changed and re-runs nothing else; a symlinked folder is on disk, which no
// view can watch, so its view says so, the window fetches it, and a write there is announced (`FOLDER_CHANGED`).
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startApp } from '@apackdev/testing/harness'
import { importCompiledContent } from '@apackdev/sdk/utils'
import { repository } from '#generated/repository.ts'
import type { EARS } from '#generated/ears.ts'
import type { DocumentView, FolderContents, FolderView, LibraryIndex } from '#generated/types.ts'

/** Where `apack pack build` writes this pack's compiled content */
const DIST = path.resolve(import.meta.dirname, '../../../../dist', 'runtime', 'content')
const LIBRARY = 'default-setup/library'
const asked = { sender: LIBRARY, client: 'c-main' }

const folder = (name: string, parentId?: EARS.EntityId) => repository.libraryCommands.createCollection(name, undefined, parentId).id as EARS.EntityId
const names = (update: { ok: boolean; value?: unknown }) => {
  const view = update.value as FolderView
  return update.ok && !view.onDisk ? view.contents.items.map(item => item.name) : 'not stored contents'
}
const documentNames = (update: { ok: boolean; value?: unknown }) => (update.ok ? (update.value as LibraryIndex).documents.map(each => each.name) : 'an error')

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))
const diskFolder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library-views-'))
  dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'on-disk.md'), 'from disk')
  return dir
}

describe('the library views', () => {
  it("reach the window showing the folder a write changed, and leave another folder's alone", async () => {
    const drafts = folder('Drafts')
    const archive = folder('Archive')
    const app = await startApp({ systems: ['library'] })
    const one = app.watchView('library', 'folder', { folderId: drafts })
    const other = app.watchView('library', 'folder', { folderId: archive })
    expect(names(await one.next())).toEqual([])
    expect(names(await other.next())).toEqual([])

    await app.send('library', { type: 'CREATE_DOCUMENT', name: 'Plan', content: [], tags: [], collectionId: drafts })
    expect(names(await one.next())).toEqual(['Plan'])
    await app.settle()
    expect(other.updates, "the other folder's window heard nothing").toHaveLength(1)
  })

  it('name every document however deep, with its tags, and drop a deleted one', async () => {
    importCompiledContent({ compiledDir: DIST, include: { commands: true } })
    const app = await startApp({ systems: ['library'] })
    const index = app.watchView('library', 'index')
    // The commands documents live two folders down, in internal/commands
    expect(documentNames(await index.next())).toEqual(expect.arrayContaining(['Claude Code commands', 'Codex commands']))

    await app.send('library', { type: 'CREATE_DOCUMENT', name: 'Tagged', content: [], tags: ['note', 'draft'] })
    const created = await index.next()
    if (!created.ok) throw new Error(created.error)
    const tagged = (created.value as LibraryIndex).documents.find(each => each.name === 'Tagged')!
    expect(tagged).toMatchObject({ tags: ['note', 'draft'], shortCode: expect.stringMatching(/^DOC-\d+$/) })

    await app.send('library', { type: 'DELETE_ITEMS', ids: [tagged.id] })
    expect(documentNames(await index.next())).not.toContain('Tagged')
  })

  it('end a deleted document with null', async () => {
    const id = repository.libraryCommands.createDocument('Doomed', [], []).id as EARS.EntityId
    const app = await startApp({ systems: ['library'] })
    const open = app.watchView<DocumentView>('library', 'document', { id })
    expect(await open.next()).toMatchObject({ ok: true, value: { onDisk: false, document: { name: 'Doomed' } } })

    await app.send('library', { type: 'DELETE_ITEMS', ids: [id] })
    expect(await open.next()).toMatchObject({ ok: true, value: { onDisk: false, document: null } })
  })
})

describe('a symlinked folder', () => {
  it('is on disk: its view says so, and the window fetches its contents', async () => {
    const linked = repository.libraryCommands.createSymlinkCollection('Linked', diskFolder()).id as EARS.EntityId
    const app = await startApp({ systems: ['library'] })
    await app.connect()
    expect(await app.watchView('library', 'folder', { folderId: linked }).next()).toEqual({ ok: true, value: { onDisk: true }, commit: expect.any(Number) })

    const call = await app.send('library', { type: 'GET_FOLDER_CONTENTS', folderId: linked }, asked)
    const fetched = await app.nextEmit('library', 'FOLDER_CONTENTS_LOADED', { answering: call }) as unknown as { data: FolderContents }
    expect(fetched.data.items.map(item => item.name)).toEqual(['on-disk.md'])
  })

  it('announces a write under it, which no view can see, and is reported broken once its folder is gone', async () => {
    const dir = diskFolder()
    const linked = repository.libraryCommands.createSymlinkCollection('Linked', dir).id as EARS.EntityId
    const app = await startApp({ systems: ['library'] })
    await app.connect()

    await app.send('library', { type: 'CREATE_DOCUMENT', name: 'written.md', content: [], tags: [], collectionId: linked })
    expect(await app.nextEmit('library', 'FOLDER_CHANGED')).toMatchObject({ folderId: linked })
    expect(fs.readdirSync(dir)).toContain('written.md')

    fs.rmSync(dir, { recursive: true })
    const call = await app.send('library', { type: 'CHECK_SYMLINKS', ids: [linked] }, asked)
    expect(await app.nextEmit('library', 'SYMLINKS_CHECKED', { answering: call })).toMatchObject({ ids: [linked], broken: [linked] })
  })
})

describe('a write to the library', () => {
  it('answers the window that made a folder with it, and every window showing its parent has it', async () => {
    const app = await startApp({ systems: ['library'] })
    await app.connect()
    const root = app.watchView('library', 'folder', { folderId: null })
    await root.next()

    const call = await app.send('library', { type: 'CREATE_COLLECTION', name: 'Fresh' }, asked)
    const created = await app.nextEmit('library', 'COLLECTION_CREATED', { answering: call }) as unknown as { data: { collection: { name: string } } }
    expect(created.data.collection.name).toBe('Fresh')
    expect(names(await root.next())).toContain('Fresh')
  })

  it('answers each write, a landed one and a refused one alike, and runs one nobody asked for', async () => {
    const linked = repository.libraryCommands.createSymlinkCollection('Linked', diskFolder()).id
    const app = await startApp({ systems: ['library'] })
    await app.connect()

    const landed = await app.send('library', { type: 'CREATE_COLLECTION', name: 'Asked' }, asked)
    await app.nextEmit('library', 'COLLECTION_CREATED', { answering: landed })
    const refused = await app.send('library', { type: 'UPDATE_SYMLINK_PATH', collectionId: linked, newPath: path.join(os.tmpdir(), 'no-such-library-folder') }, asked)
    expect(await app.nextEmit('library', 'LIBRARY_WRITE_FAILED', { answering: refused })).toMatchObject({ error: expect.stringContaining('no-such-library-folder') })

    await app.send('library', { type: 'CREATE_COLLECTION', name: 'Unasked' })
    await app.settle()
    expect(repository.libraryQueries.getCollections().map(each => each.name)).toContain('Unasked')
  })
})
