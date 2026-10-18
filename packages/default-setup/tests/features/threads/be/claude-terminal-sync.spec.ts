import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EntityId } from '#generated/services.ts'
import type { ClaudeNativeTerminalOwner } from '#features/code/be/services/claude-code/terminal-owner.ts'
import { createClaudeNativeJournalReader } from '#features/code/be/services/claude-code/terminal-journal.ts'
const fake = vi.hoisted(() => ({
  messages: [] as Record<string, unknown>[],
  thread: { context: {} as Record<string, unknown> },
  broadcast: vi.fn(),
}))
vi.mock('#generated/events.ts', () => ({ broadcastToPlugin: fake.broadcast }))
vi.mock('#generated/repository.ts', () => ({ repository: {
  chatQueries: { threadData: () => ({ ...fake.thread, messages: [] }), messageById: (id: string) => fake.messages.find(message => message.id === id) },
  threadQueries: { byId: () => fake.thread },
  chatCommands: {
    addMessage: (message: Record<string, unknown>) => { const row = { ...message, id: String(fake.messages.length) }; fake.messages.push(row); return row },
    updateMessageState: vi.fn(),
  },
  threadCommands: { update: (_: unknown, updates: { context: Record<string, unknown> }) => { fake.thread.context = updates.context } },
} }))
vi.mock('#features/threads/be/services/chat.ts', () => ({ updateMessageState: vi.fn((id: string, updates: Record<string, unknown>) => { Object.assign(fake.messages.find(message => message.id === id)!, updates) }) }))
vi.mock('#features/threads/be/services/threads.ts', () => ({ updateChatState: vi.fn() }))
const sessionId = '11111111-1111-1111-1111-111111111111'
let directory: string
beforeEach(async () => {
  vi.resetModules()
  directory = await mkdtemp(join(tmpdir(), 'native-sync-'))
  fake.messages.length = 0; fake.thread.context = { claudeCode: { sessionId } }; fake.broadcast.mockClear()
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
it.each([false, true])('persists the final row beyond the batch boundary on exit, damaged row: %s', async damaged => {
  const path = join(directory, sessionId + '.jsonl'), read = createClaudeNativeJournalReader()
  const row = (uuid: string, text: string) => JSON.stringify({ sessionId, uuid, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n'
  await writeFile(path, row('22222222-2222-2222-2222-222222222222', 'a'.repeat(1300000)) + (damaged ? '{broken\n' : '') + row('33333333-3333-3333-3333-333333333333', 'b'.repeat(1300000)) + row('44444444-4444-4444-4444-444444444444', 'Final native answer'))
  let exited = false, release: (() => Promise<void>) | undefined
  const owner: ClaudeNativeTerminalOwner = {
    uiTransport: { promptHosts: { register: () => () => {}, answers: () => [], detach() {} }, request: async () => { throw new Error('UI is not used in the persistence fixture') }, subscribe: () => () => {} },
    get state() { return { ownerId: 'owned', sessionId, cwd: directory, status: exited ? 'exited' as const : 'live' as const, busy: false, tasks: [] } },
    busy: false, done: Promise.resolve(), output: [], records: [],
    beforeRelease(listener) { release = listener },
    readJournal: () => read([{ sessionId, path }], { final: exited }),
    subscribe: () => () => {}, input: () => false, resize: () => false, close: async () => {}, kill() {},
    submit: async () => { throw new Error('No prompt submission in this fixture') },
  }
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true)
  expect(release).toBeDefined()
  exited = true; await release!()
  expect(fake.messages, JSON.stringify(fake.thread.context)).not.toEqual([])
  expect(fake.messages.map(message => (message.context as Record<string, unknown>).cliUuid)).toEqual(['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'])
  expect(fake.messages.at(-1)?.text).toBe('Final native answer')
  expect(fake.thread.context.claudeCode).toMatchObject(damaged ? { chatState: 'error', sessionError: 'Native transcript contains invalid JSON' } : { chatState: 'paused', sessionError: undefined })
})

it.each([false, true])('retains receipt-bound references when journal arrives before receipt: %s', async journalFirst => {
  const uuid = '55555555-5555-5555-5555-555555555555', otherUuid = '66666666-6666-6666-6666-666666666666'
  const entry = (id: string) => ({ sessionId, row: { sessionId, uuid: id, type: 'user', message: { content: 'Native rewritten text' } } })
  let release!: () => Promise<void>, active = true
  const readJournal = vi.fn(async () => ({ entries: journalFirst ? [entry(uuid), entry(otherUuid)] : [], pending: false, problems: [] }))
  const owner = { state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: false,
    readJournal, beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  const history = syncClaudeTerminalThread('thread' as EntityId, owner, () => active)
  await vi.waitFor(() => expect(readJournal).toHaveBeenCalled())
  // Allow the first journal batch to be persisted before attaching the receipt.
  await Promise.resolve()
  const references = { images: [{ name: 'original.png', url: 'media://message/original.png' }], files: [{ name: 'source.ts', path: '/project/source.ts', typeLabel: 'TypeScript', isImage: false }] }
  history.acceptSubmission({ sessionId, uuid, text: 'Native rewritten text' }, references)
  references.images[0].name = 'mutated later'
  readJournal.mockResolvedValue({ entries: [entry(uuid), entry(otherUuid)], pending: false, problems: [] })
  await release()
  expect(fake.messages).toHaveLength(2)
  expect(fake.messages[0]).toMatchObject({ text: 'Native rewritten text', references: { images: [{ name: 'original.png' }], files: [{ name: 'source.ts' }] } })
  expect(fake.messages[1].references).toBeUndefined()
  active = false
  history.acceptSubmission({ sessionId, uuid, text: '' }, { images: [{ name: 'stale', url: 'media://stale/x' }] })
  expect((fake.messages[0].references as typeof references).images[0].name).toBe('original.png')
})
