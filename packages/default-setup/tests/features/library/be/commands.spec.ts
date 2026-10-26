// The chat's slash commands are the fields of every document of `documentType: 'commands'`. The documents
// are the SDK's entities and the derivation is the SDK's (`commandsFromDocuments`), so the app reads its own
// rows: this feature is the editor, and contributes nothing to serving the list. What this spec holds is
// that the content pipeline still lands commands the app can read, and that editing one through this
// feature is noticed.
//
// **One source.** A command is a document with a type, so there is no merge, no precedence rule and no
// folder deciding what a document is; a name two documents define keeps the first. This pack ships its
// own in `src/content/commands/internal/`, and a document the user types anywhere is served the same.
//
// **One destination.** The app holds the list rather than the chat, beside the other facts a window needs
// whatever surface is open — so an editor in a window with no chat open still offers every command.
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { registerPack, startApp, unregisterPack, type TestApp } from '@apackdev/testing/harness'
import { importCompiledContent } from '@apackdev/sdk/utils'
import { commandsFromDocuments } from '@apackdev/sdk/commands'
import { createCommandsApplier, createDocumentsApplier, createFormatApplier } from '@apackdev/sdk/content'
import { repository } from '#generated/repository.ts'
import manifest from '../../../../apack.json'

/** Where `apack pack build` writes this pack's compiled content */
const DIST = path.resolve(import.meta.dirname, '../../../../dist', 'runtime', 'content')

const commandNames = (event: unknown) => ((event as { commands: Array<{ name: string }> }).commands).map((command) => command.name)
const commandDocuments = () => repository.libraryQueries.getDocuments().filter((document) => document.documentType === 'commands')
const field = (key: string, value: string) => [{ type: 'field' as const, fields: [{ key, value }] }]
const documentNamed = (name: string) => repository.libraryQueries.getDocuments().find((document) => document.name === name)!

/**
 * The dependent pack, registered as the app registers an installed pack: the SDK's appliers for its
 * `documents` and `commands` keys and one for default-setup's notes format, as its registration carries them.
 * It declares no commands — a pack contributes them as content, under the SDK's `commands` key.
 */
function registerTeamNotes(): void {
  registerPack({
    id: 'team-notes',
    appliers: [
      createDocumentsApplier(),
      createCommandsApplier(),
      createFormatApplier({ key: 'notes', entities: ['Note'], identity: ['title', 'parent'], relKind: 'contains' }),
    ],
  })
}
registerTeamNotes()
function reregisterTeamNotes(): void {
  unregisterPack('team-notes')
  registerTeamNotes()
}
afterEach(() => reregisterTeamNotes())

const dependentDirs: string[] = []
afterAll(() => {
  unregisterPack('team-notes')
  for (const dir of dependentDirs) fs.rmSync(dir, { recursive: true, force: true })
})

/** A pack depending on default-setup, with its document records compiled as its `documents` key writes them */
function dependentPack(records: unknown[], key = 'documents'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependent-commands-'))
  dependentDirs.push(dir)
  fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, packId: 'team-notes', entries: [] }))
  fs.writeFileSync(path.join(dir, `${key}.content.json`), JSON.stringify({ records }))
  return dir
}

const document = (name: string, command: string) =>
  ({ entity: 'Document', name, content: field(command, 'Team argument'), tags: [],
    documentType: 'commands', contentHash: `team-${command}` })

/** Its own command document, written under the SDK's `commands` key */
const dependentPackCommands = (documentName: string, command: string) =>
  dependentPack([document(documentName, command)], 'commands')

/** The systems a command case needs: the owner, the app that publishes, and what the owner's boot reaches */
const SYSTEMS = ['library', 'threads', 'brain', 'host/application', 'host/settings', 'host/packs']

async function appliedApp(): Promise<TestApp> {
  importCompiledContent({ compiledDir: DIST, include: { commands: true } })
  // threads checks onboarding with the brain when a client connects
  const app = await startApp({ systems: SYSTEMS })
  await app.connect()
  await connectionPublish(app)
  return app
}

/**
 * Takes the publish the connection itself made, so a later `nextEmit` is the one the case's change caused.
 * The app publishes on every `SEND_STATE` and the bus sends one after each connection, so there is always
 * exactly one waiting here.
 */
const connectionPublish = (app: TestApp) => app.nextEmit('host/application', 'COMMANDS_UPDATED')

describe('slash commands from the library commands folder', () => {
  it("lists the commands default-setup declares, then its Claude Code and Codex documents'", async () => {
    const app = await appliedApp()
    expect(commandDocuments().map((document) => document.name).sort()).toEqual(['Chat commands', 'Claude Code commands', 'Codex commands'])

    // Published on the connection, as the shell's other two facts are
    const names = commandNames(app.emitted('host/application').find((event) => event.type === 'COMMANDS_UPDATED'))
    // Document order then name, so the chat's own document leads
    expect(names.slice(0, 2)).toEqual(['pr2md', 'instructions'])
    expect(names).toEqual(expect.arrayContaining(['cc-resume', 'cc-goal', 'cdx-resume', 'cdx-goal']))
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(commandsFromDocuments().map((command) => command.name))
  })

  it('lists a command from any command document, wherever it sits', async () => {
    await appliedApp()
    repository.libraryCommands.createDocument('elsewhere', field('loose', 'Anywhere'), [], undefined, undefined, undefined, 'commands')

    expect(commandsFromDocuments().map((command) => command.name)).toContain('loose')
  })

  it('adds the commands of a document created in the folder, and sends the chat the new list', async () => {
    const app = await appliedApp()
    await app.send('library', { type: 'CREATE_DOCUMENT', name: 'mine', content: field('my-command', 'Arguments'), tags: [], documentType: 'commands' })
    const updated = await app.nextEmit('host/application', 'COMMANDS_UPDATED')
    expect(commandNames(updated)).toContain('my-command')
    expect(commandNames(updated)).toContain('cc-resume')
  })

  // Editing one is why they are documents at all, and it is the one cause a connection, a pack change and a
  // data replacement all miss — so it is the whole reason the owner tells the app the list moved.
  it('serves a command the user adds by editing a document, and publishes the new list', async () => {
    const app = await appliedApp()
    const document = documentNamed('Chat commands')

    await app.send('library', { type: 'UPDATE_DOCUMENT', id: document.id, name: document.name, content: field('standup', 'Topic'), tags: [] })

    const published = commandNames(await app.nextEmit('host/application', 'COMMANDS_UPDATED'))
    expect(published).toContain('standup')
    // The edit replaced that document's whole field section, so what it used to list is gone with it
    expect(published).not.toContain('pr2md')
    expect(published).toContain('cc-resume')
    // An update that says nothing about the type leaves the document a command list, which is what keeps it one
    expect(documentNamed('Chat commands').documentType).toBe('commands')
  })

  it('removes the commands of a deleted document, and sends the chat the new list', async () => {
    const app = await appliedApp()
    await app.send('library', { type: 'DELETE_ITEMS', ids: [documentNamed('Claude Code commands').id] })
    const afterDelete = commandNames(await app.nextEmit('host/application', 'COMMANDS_UPDATED'))
    expect(afterDelete).not.toContain('cc-resume')
    expect(afterDelete).toContain('pr2md')
  })

  // What a document is travels with it, which is the point of typing it rather than its folder
  it('keeps a command document its commands when it moves', async () => {
    const app = await appliedApp()
    const before = commandsFromDocuments().map((command) => command.name)
    await app.send('library', { type: 'MOVE_ITEMS', ids: [documentNamed('Codex commands').id], targetFolderId: null })
    await app.settle()
    expect(commandsFromDocuments().map((command) => command.name)).toEqual(before)
  })

  it("reports only failure for content that does not name its pack, even when no section is selected", async () => {
    // With every section deselected no applier runs, so nothing else reads the missing pack id
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unnamed-content-'))
    dependentDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, entries: [] }))
    const nothing = Object.fromEntries(Object.keys(manifest.content.sources).map((key) => [key, []]))
    const app = await startApp({ systems: SYSTEMS })
    await app.connect()

    await app.send('host/packs', { type: 'IMPORT_PACK_CONTENT', directory: dir, include: nothing, mode: 'replace-on-collision', restartBrain: false })
    const failed = await app.nextEmit('host/settings', 'PACK_CONTENT_IMPORT_FAILED') as unknown as { error: string }

    expect(failed.error).toContain('packId')
    expect(app.emitted('host/settings').map((event) => event.type)).not.toContain('PACK_CONTENT_IMPORTED')
  })

  it("reports the records a content import couldn't write, with the counts of the rest", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failing-content-'))
    dependentDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'content.json'), JSON.stringify({ version: 1, packId: manifest.id, entries: [] }))
    const note = (title: string) => ({ entity: 'Note', title, noteType: 'document', content: 'x', contentHash: `hash-${title}` })
    fs.writeFileSync(path.join(dir, 'notes.content.json'), JSON.stringify({ records: [note(''), note('kept')] }))
    const app = await startApp({ systems: SYSTEMS })
    await app.connect()

    await app.send('host/packs', { type: 'IMPORT_PACK_CONTENT', directory: dir, include: { notes: null }, mode: 'replace-on-collision', restartBrain: false })
    const imported = await app.nextEmit('host/settings', 'PACK_CONTENT_IMPORTED') as unknown as { result: Record<string, { created: number }>; errors: string[] }

    expect(imported.result.notes.created).toBe(1)
    expect(imported.errors).toHaveLength(1)
    expect(imported.errors[0]).toMatch(/^notes: .*Title is required/)
  })

  it('sends the chat the commands a pack content import brings', async () => {
    const app = await startApp({ systems: SYSTEMS })
    await app.connect()
    await connectionPublish(app)
    await app.send('host/packs', { type: 'IMPORT_PACK_CONTENT', directory: DIST, include: { commands: null }, mode: 'replace-on-collision', restartBrain: false })
    expect(commandNames(await app.nextEmit('host/application', 'COMMANDS_UPDATED'))).toContain('cdx-goal')
  })

  it("keeps the chat's own commands when the CLI documents are gone", async () => {
    const app = await appliedApp()
    await app.send('library', { type: 'DELETE_ITEMS', ids: [documentNamed('Claude Code commands').id, documentNamed('Codex commands').id] })

    expect(commandNames(await app.nextEmit('host/application', 'COMMANDS_UPDATED'))).toEqual(['pr2md', 'instructions'])
  })

  it("sends nothing for a change that doesn't alter the commands", async () => {
    const app = await appliedApp()
    const published = app.emitted('host/application').filter((event) => event.type === 'COMMANDS_UPDATED').length
    await app.send('library', { type: 'CREATE_DOCUMENT', name: 'notes', content: field('not-a-command', 'x'), tags: [] })
    await app.settle()
    // The owner compares the list before and after its own write, so a document that is not a command list
    // never reaches the app at all — the one dedupe left, and the only place that can make it
    expect(app.emitted('host/application').filter((event) => event.type === 'COMMANDS_UPDATED')).toHaveLength(published)
    expect(commandsFromDocuments().map((command) => command.name)).not.toContain('not-a-command')
  })

  it("nests a dependent pack's command document in default-setup's folders, and lists its commands", async () => {
    await appliedApp()
    const before = repository.libraryQueries.getCollections()

    importCompiledContent({ compiledDir: dependentPackCommands('Team commands', 'team-standup') })

    const collections = repository.libraryQueries.getCollections()
    expect(collections.filter((collection) => collection.name === 'internal')).toHaveLength(1)
    expect(collections.find((collection) => collection.name === 'internal')!.id).toBe(before.find((collection) => collection.name === 'internal')!.id)
    expect(commandDocuments().map((document) => document.name)).toContain('Team commands')
    expect(commandsFromDocuments().map((command) => command.name)).toEqual(expect.arrayContaining(['team-standup', 'cc-resume']))
  })

  // The bus asks every system to publish when a pack is installed, updated or rebuilt while the app runs
  it('sends the chat the commands a pack written while the app runs brings', async () => {
    const app = await appliedApp()
    importCompiledContent({ compiledDir: dependentPackCommands('Team commands', 'team-standup') })

    await app.send('host/application', { type: 'SEND_STATE' })

    expect(commandNames(await app.nextEmit('host/application', 'COMMANDS_UPDATED'))).toContain('team-standup')
  })

  // Unconditionally, as `SURFACE_VISIBILITY_UPDATED` and `PACK_RUNTIMES_UPDATED` are: the app reads the list from
  // the designation on each send and holds none of it, so it has nothing to compare an unchanged list against.
  // Only the owner dedupes, and it dedupes a *change* rather than a publish — see the case above.
  it("publishes the list again when asked to, whether or not it moved", async () => {
    const app = await appliedApp()
    const before = app.emitted('host/application').filter((event) => event.type === 'COMMANDS_UPDATED').length

    await app.send('host/application', { type: 'SEND_STATE' })
    await app.settle()

    const sent = app.emitted('host/application').filter((event) => event.type === 'COMMANDS_UPDATED')
    expect(sent).toHaveLength(before + 1)
    expect(commandNames(sent.at(-1))).toContain('pr2md')
  })

  it("shows the library index what a pack written while the app runs brings, with nobody asking", async () => {
    const app = await appliedApp()
    const index = app.watchView<{ documents: Array<{ name: string }> }>('library', 'index')
    await index.next()

    importCompiledContent({ compiledDir: dependentPackCommands('Team commands', 'team-standup') })

    const update = await index.next()
    expect(update.ok && update.value.documents.map((document) => document.name)).toContain('Team commands')
  })



  it('keeps the first definition of a command two documents define', async () => {
    await appliedApp()
    const original = commandsFromDocuments().find((command) => command.name === 'cc-resume')!
    repository.libraryCommands.createDocument('zz-override', field('cc-resume', 'Shadowed'), [], undefined, undefined, undefined, 'commands')
    expect(commandsFromDocuments().filter((command) => command.name === 'cc-resume')).toEqual([original])
  })
})
