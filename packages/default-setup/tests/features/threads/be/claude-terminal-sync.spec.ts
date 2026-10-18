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
vi.mock('#features/threads/be/services/chat.ts', () => ({ sendBlockMessage: vi.fn((options: Record<string, unknown>) => { const row = { ...options, id: String(fake.messages.length) }; fake.messages.push(row); return { messageId: row.id } }), updateMessageState: vi.fn((id: string, updates: Record<string, unknown>) => { Object.assign(fake.messages.find(message => message.id === id)!, updates) }) }))
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
    setPermissionMode: async mode => mode, holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getReadDialogs: vi.fn(async () => []), answerReadDialog: vi.fn(async () => {}), getModels: async () => ({ models: [] }), setModel: async model => model,
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
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getReadDialogs: vi.fn(async () => []), state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: false,
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

it.each([true, false])('joins native task status only to its structured Agent record, matching identity: %s', async matching => {
  const uuid = '77777777-7777-7777-7777-777777777777', agentId = 'native-agent'
  const assistant = { sessionId, row: { sessionId, uuid, type: 'assistant', message: { content: [{ type: 'tool_use', id: 'agent-tool', name: 'Agent', input: {} }, { type: 'tool_use', id: 'other-tool', name: 'Read', input: {} }] } } }
  const result = { sessionId, row: { sessionId, uuid: '88888888-8888-8888-8888-888888888888', type: 'user', sourceToolAssistantUUID: matching ? uuid : 'foreign', toolUseResult: { agentId }, message: { content: [{ type: 'tool_result', tool_use_id: 'agent-tool', content: 'Launched' }] } } }
  let release!: () => Promise<void>
  const tasks = [{ id: agentId, name: 'worker', status: 'running', statusText: 'Native progress' }]
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getReadDialogs: vi.fn(async () => []), state: { ownerId: 'owner', sessionId, status: 'live', tasks }, busy: false,
    readJournal: vi.fn(async () => ({ entries: [assistant, result], pending: false, problems: [] })),
    beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true)
  const entries = () => (fake.messages[0]?.blocks as { props: { entries: { nativeAgent?: unknown }[] } }[])[0].props.entries
  try {
    await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
    expect(entries()[0].nativeAgent).toEqual(matching ? tasks[0] : undefined)
    expect(entries()[1].nativeAgent).toBeUndefined()
    tasks[0] = { ...tasks[0], status: 'completed', statusText: 'Finished' }
    await vi.waitFor(() => expect(entries()[0].nativeAgent).toEqual(matching ? tasks[0] : undefined))
    tasks.length = 0
    await vi.waitFor(() => expect(entries()[0].nativeAgent).toBeUndefined())
  } finally { await release() }
})

it('retires inline approval on native payload replacement and exit without duplicating it', async () => {
  let release!: () => Promise<void>
  const dialog = { id: 'dialog-1', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId, requestId: 'tool-read', toolName: 'Read' as const,
    title: 'Read file', question: 'Allow this read?', input: { file_path: '/outside/fixture.txt' } }
  const getReadDialogs = vi.fn(async () => [dialog])
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), getReadDialogs, state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: true,
    readJournal: vi.fn(async () => ({ entries: [], pending: false, problems: [] })),
    beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true)
  await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
  expect(fake.thread.context.claudeCode).toMatchObject({ chatState: 'paused', pendingControlRequest: { nativeTerminal: { ownerId: 'owner', revision: dialog.revision } } })
  await vi.waitFor(() => expect(getReadDialogs.mock.calls.length).toBeGreaterThan(1))
  expect(fake.messages).toHaveLength(1)
  dialog.revision = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  await vi.waitFor(() => expect(fake.messages).toHaveLength(2))
  expect(fake.messages[0]).toMatchObject({ blockResponse: { cancelled: true } })
  getReadDialogs.mockResolvedValue([])
  await release()
  expect(fake.messages[1]).toMatchObject({ blockResponse: { cancelled: true } })
  expect(fake.thread.context.claudeCode).toMatchObject({ pendingControlRequest: undefined })
})
