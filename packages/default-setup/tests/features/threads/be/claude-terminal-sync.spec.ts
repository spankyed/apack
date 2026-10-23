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
  chatQueries: { threadData: () => ({ ...fake.thread, messages: fake.messages }), messageById: (id: string) => fake.messages.find(message => message.id === id) },
  threadQueries: { byId: () => fake.thread },
  chatCommands: {
    addMessage: (message: Record<string, unknown>) => { const row = { ...message, id: String(fake.messages.length) }; fake.messages.push(row); return row },
    updateMessageState: vi.fn(),
  },
  threadCommands: { update: (_: unknown, updates: { context: Record<string, unknown> }) => { fake.thread.context = updates.context } },
} }))
vi.mock('#features/threads/be/services/chat.ts', () => ({ sendBlockMessage: vi.fn((options: Record<string, unknown>) => { const row = { ...options, id: String(fake.messages.length) }; fake.messages.push(row); return { messageId: row.id } }), updateMessageState: vi.fn((id: string, updates: Record<string, unknown>) => { Object.assign(fake.messages.find(message => message.id === id)!, updates) }) }))
vi.mock('#features/threads/be/services/threads.ts', () => ({ updateChatState: vi.fn() }))
const readLaunch = async () => undefined
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
  const row = (uuid: string, text: string) => JSON.stringify({ sessionId, uuid, timestamp: '2026-10-20T10:00:00Z', type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n'
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
    setPermissionMode: async mode => mode, holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getPlanDialogs: vi.fn(async () => []), answerPlanDialog: vi.fn(async () => {}), getBashDialogs: vi.fn(async () => []), answerBashDialog: vi.fn(async () => {}), refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: vi.fn(async () => []), answerFileDialog: vi.fn(async () => {}), controlMcpServer: vi.fn(async () => ({mcpServers:[]})), operateTask: vi.fn(async () => ({ stopped: true })), getMcpStatus: vi.fn(async () => ({mcpServers:[]})), getModels: async () => ({ models: [] }), renameSession: vi.fn(async (title: string) => ({ title, message: 'Renamed' })), setModel: async model => model,
  }
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  expect(release).toBeDefined()
  exited = true; await release!()
  expect(fake.messages, JSON.stringify(fake.thread.context)).not.toEqual([])
  expect(fake.messages.map(message => (message.context as Record<string, unknown>).cliUuid)).toEqual(['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'])
  expect(fake.messages.at(-1)?.text).toBe('Final native answer')
  expect(fake.messages.at(-1)?.context).toMatchObject({claudeTerminalMessage:{timestamp:Date.parse('2026-10-20T10:00:00Z'),order:3}})
  expect(fake.thread.context.claudeCode).toMatchObject(damaged ? { chatState: 'error', sessionError: 'Native transcript contains invalid JSON' } : { chatState: 'paused', sessionError: undefined })
})

it.each([false, true])('retains receipt-bound references when journal arrives before receipt: %s', async journalFirst => {
  const uuid = '55555555-5555-5555-5555-555555555555', otherUuid = '66666666-6666-6666-6666-666666666666'
  const entry = (id: string) => ({ sessionId, row: { sessionId, uuid: id, type: 'user', message: { content: 'Native rewritten text' } } })
  let release!: () => Promise<void>, active = true
  const readJournal = vi.fn(async () => ({ entries: journalFirst ? [entry(uuid), entry(otherUuid)] : [], pending: false, problems: [] }))
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getPlanDialogs: vi.fn(async () => []), answerPlanDialog: vi.fn(async () => {}), getBashDialogs: vi.fn(async () => []), answerBashDialog: vi.fn(async () => {}), refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: vi.fn(async () => []), state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: false,
    readJournal, beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  const history = syncClaudeTerminalThread('thread' as EntityId, owner, () => active, readLaunch)
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
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), answerQuestionDialog: vi.fn(async () => {}), getPlanDialogs: vi.fn(async () => []), answerPlanDialog: vi.fn(async () => {}), getBashDialogs: vi.fn(async () => []), answerBashDialog: vi.fn(async () => {}), refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: vi.fn(async () => []), state: { ownerId: 'owner', sessionId, status: 'live', tasks }, busy: false,
    readJournal: vi.fn(async () => ({ entries: [assistant, result], pending: false, problems: [] })),
    beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  const entries = () => (fake.messages[0]!.blocks as { props: { entries: { nativeAgent?: unknown }[] } }[])[0].props.entries
  try {
    await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
    expect(entries()[0].nativeAgent).toEqual(matching ? { ...tasks[0], ownerId: 'owner', sessionId } : undefined)
    expect(entries()[1].nativeAgent).toBeUndefined()
    tasks[0] = { ...tasks[0], status: 'completed', statusText: 'Finished' }
    await vi.waitFor(() => expect(entries()[0].nativeAgent).toEqual(matching ? { ...tasks[0], ownerId: 'owner', sessionId } : undefined))
    tasks.length = 0
    await vi.waitFor(() => expect(entries()[0].nativeAgent).toBeUndefined())
  } finally { await release() }
})

it.each(['Read', 'Bash', 'ExitPlanMode', 'Workflow', 'WebFetch', 'Skill'] as const)('retires %s approval on native payload replacement and exit without duplication', async toolName => {
  let release!: () => Promise<void>
  const dialog = { id: 'dialog-1', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId, requestId: 'tool-read', toolName: 'Read' as const,
    title: 'Read file', question: 'Allow this read?', input: { file_path: '/outside/fixture.txt' } }
  const bashDialog = { id: dialog.id, revision: dialog.revision, sessionId, requestId: 'tool-bash', toolName: 'Bash' as const, command: 'printf original', cwd: '/workspace', input: { command: 'printf original' } }
  const planDialog = { id: dialog.id, revision: dialog.revision, sessionId, requestId: 'tool-plan', toolName: 'ExitPlanMode' as const, input: {}, presentation: { plan: '# Original plan', empty: false, withheld: false, choices: [] } }
  const workflowDialog = { id: dialog.id, revision: dialog.revision, sessionId, requestId: 'tool-workflow', toolName: 'Workflow' as const, input: { script: 'original' }, presentation: { token: 'a'.repeat(64), ready: true, withheld: false, script: 'original', choices: [] } }
  const toolDialog = { id: dialog.id, revision: dialog.revision, sessionId, requestId: 'tool-permission', toolName: toolName === 'Skill' ? 'Skill' as const : 'WebFetch' as const, input: { url: 'https://example.invalid/notes' }, presentation: { title: 'Original tool permission', details: [{ label: 'Target', value: 'Original preview' }], ready: true, token: 'a'.repeat(64), choices: [] } }
  const getToolPermissionDialogs = vi.fn(async () => toolName === 'Skill' || toolName === 'WebFetch' ? [toolDialog] : [])
  const getWorkflowDialogs = vi.fn(async () => toolName === 'Workflow' ? [workflowDialog] : [])
  const getPlanDialogs = vi.fn(async () => toolName === 'ExitPlanMode' ? [planDialog] : [])
  const getFileDialogs = vi.fn(async () => toolName === 'Read' ? [dialog] : [])
  const getBashDialogs = vi.fn(async () => toolName === 'Bash' ? [bashDialog] : [])
  const owner = { holdQuestionDialog: vi.fn(async () => {}), renderQuestionDialog: vi.fn(async () => { throw new Error('Question rendering is not used in this fixture') }), getQuestionDialogs: vi.fn(async () => []), getPlanDialogs, answerPlanDialog: vi.fn(async () => {}), getBashDialogs, answerBashDialog: vi.fn(async () => {}), refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs, answerToolPermissionDialog: vi.fn(async () => {}), getWorkflowDialogs, getFileDialogs, state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: true,
    readJournal: vi.fn(async () => ({ entries: [], pending: false, problems: [] })),
    beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
  expect(fake.thread.context.claudeCode).toMatchObject({ chatState: 'paused', pendingControlRequest: { nativeTerminal: { ownerId: 'owner', revision: dialog.revision } } })
  await vi.waitFor(() => expect(getFileDialogs.mock.calls.length).toBeGreaterThan(1))
  expect(fake.messages).toHaveLength(1)
  dialog.revision = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  bashDialog.revision = dialog.revision
  planDialog.revision = dialog.revision
  workflowDialog.revision = dialog.revision
  toolDialog.revision = dialog.revision
  await vi.waitFor(() => expect(fake.messages).toHaveLength(2))
  expect(fake.messages[0]).toMatchObject({ blockResponse: { cancelled: true } })
  getToolPermissionDialogs.mockResolvedValue([])
  getWorkflowDialogs.mockResolvedValue([])
  getFileDialogs.mockResolvedValue([])
  getBashDialogs.mockResolvedValue([])
  getPlanDialogs.mockResolvedValue([])
  await release()
  expect(fake.messages[1]).toMatchObject({ blockResponse: { cancelled: true } })
  expect(fake.thread.context.claudeCode).toMatchObject({ pendingControlRequest: undefined })
})

it('refreshes native file readiness and permission scope without replacing the pending approval', async () => {
  let release!: () => Promise<void>
  const approval = { ready: false, token: 'a'.repeat(64), choices: [{ value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: true }] }
  const dialog = { id: 'file-dialog', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId, requestId: 'file-write', toolName: 'Write' as const,
    title: 'Write file', question: 'Allow?', input: { file_path: '/workspace/file.txt', content: 'original' }, approval }
  const owner = { state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: true,
    refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: async () => [dialog], getBashDialogs: async () => [], getQuestionDialogs: async () => [], getPlanDialogs: async () => [],
    readJournal: async () => ({ entries: [], pending: false, problems: [] }),
    beforeRelease(listener: () => Promise<void>) { release = listener },
  } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  try {
    await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
    const message = fake.messages[0]
    dialog.approval = { ...approval, ready: true, token: 'b'.repeat(64), choices: [...approval.choices, { value: 'yes-session', label: 'Original session scope', decision: 'allow', feedback: false }] }
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ pendingControlRequest: { nativeTerminal: { file: { ready: true, token: 'b'.repeat(64), choices: dialog.approval.choices } } } }))
    expect(fake.messages).toHaveLength(1)
    expect(fake.messages[0]).toBe(message)
    expect(message).not.toHaveProperty('blockResponse')
  } finally { await release() }
})

it('publishes targeted Plan/Edit transitions from observed native mode without an approval callback', async () => {
  let release!: () => Promise<void>
  const readJournal = vi.fn(async () => ({ entries: [], pending: false, problems: [] }))
  const metadata = { cwd: '/workspace', model: 'fixture', turns: 1, startedAt: 100, permissionMode: 'default' }
  const owner = { state: { ownerId: 'owner', sessionId, status: 'live', tasks: [], session: metadata }, busy: false,
    refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: vi.fn(async () => []), answerWorkflowDialog: vi.fn(async () => {}), getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: async () => [], getBashDialogs: async () => [], getQuestionDialogs: async () => [], getPlanDialogs: async () => [],
    readJournal, beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  try {
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ permissionMode: 'default' }))
    metadata.permissionMode = 'plan'
    await vi.waitFor(() => expect(fake.broadcast).toHaveBeenCalledWith('threads', { type: 'SET_PHASE', source: 'native', threadId: 'thread', phase: 'Plan' }))
    const before = fake.broadcast.mock.calls.filter(([, event]) => event.type === 'SET_PHASE').length
    const polls = readJournal.mock.calls.length
    await vi.waitFor(() => expect(readJournal.mock.calls.length).toBeGreaterThan(polls + 1))
    expect(fake.broadcast.mock.calls.filter(([, event]) => event.type === 'SET_PHASE')).toHaveLength(before)
    metadata.permissionMode = 'acceptEdits'
    await vi.waitFor(() => expect(fake.broadcast).toHaveBeenCalledWith('threads', { type: 'SET_PHASE', source: 'native', threadId: 'thread', phase: 'Edit' }))
    metadata.permissionMode = 'auto'
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ permissionMode: 'auto' }))
    expect(fake.broadcast.mock.calls.filter(([, event]) => event.type === 'SET_PHASE')).toHaveLength(before + 1)
  } finally { await release() }
})

it('reports native pending workflows as working without turning them into Agents or blocking submission', async () => {
  let release!: () => Promise<void>
  const state = { ownerId: 'owner', sessionId, status: 'live', tasks: [], activity: { pendingAgents: 0, pendingWorkflows: 1 } }
  const owner = { state, busy: false, refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: vi.fn(async () => {}), answerNotice: vi.fn(async () => {}), getWorkflowDialogs: async () => [], getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs: async () => [], getBashDialogs: async () => [], getQuestionDialogs: async () => [], getPlanDialogs: async () => [], readJournal: async () => ({ entries: [], pending: false, problems: [] }), beforeRelease(listener: () => Promise<void>) { release = listener } } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  try {
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ chatState: 'working' }))
    expect(owner.busy).toBe(false); expect(state.tasks).toEqual([])
    state.activity.pendingWorkflows = 0
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ chatState: 'success' }))
    state.activity.pendingWorkflows = 1; state.status = 'exited'
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ chatState: 'paused' }))
  } finally { await release() }
})

it('persists a consumed journal batch even when native dialog discovery fails during that flush', async () => {
  const uuid='99999999-9999-9999-9999-999999999999'
  let release!:()=>Promise<void>
  const readJournal=vi.fn().mockResolvedValueOnce({entries:[{sessionId,row:{sessionId,uuid,type:'user',origin:{kind:'human'},message:{content:'Managed media submission'}}}],pending:false,problems:[]}).mockResolvedValue({entries:[],pending:false,problems:[]})
  const getWorkflowDialogs=vi.fn().mockRejectedValueOnce(new Error('Transient native dialog discovery failure')).mockResolvedValue([])
  const owner={state:{ownerId:'owner',sessionId,status:'live',tasks:[]},busy:false,readJournal,refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice:vi.fn(async()=>{}),answerNotice:vi.fn(async()=>{}),getWorkflowDialogs,getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs:async()=>[],getBashDialogs:async()=>[],getQuestionDialogs:async()=>[],getPlanDialogs:async()=>[],beforeRelease(listener:()=>Promise<void>){release=listener}} as unknown as ClaudeNativeTerminalOwner
  const {syncClaudeTerminalThread}=await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId,owner,()=>true,readLaunch)
  await vi.waitFor(()=>expect(getWorkflowDialogs).toHaveBeenCalled())
  await release()
  expect(fake.messages).toEqual([expect.objectContaining({sender:'user',text:'Managed media submission',context:expect.objectContaining({cliUuid:uuid})})])
})

it('does not recount a saved tool when its native journal is read again after reopening', async () => {
 const uuid='22222222-2222-2222-2222-222222222222';
 fake.thread.context={claudeCode:{sessionId,toolCallCount:1}};
 fake.messages.push({id:'saved-tool',text:'',context:{cliUuid:uuid,claudeTerminalMessage:{uuid,sessionId}},blocks:[{type:'tool-activity',props:{entries:[{id:'read-saved',tool:'Read',status:'ok'}]}}]});
 const entries=[{sessionId,row:{sessionId,uuid,type:'assistant',message:{content:[{type:'tool_use',id:'read-saved',name:'Read',input:{}}]}}},{sessionId,row:{sessionId,uuid:'33333333-3333-3333-3333-333333333333',type:'user',message:{content:[{type:'tool_result',tool_use_id:'read-saved',content:'Saved result'}]}}}];
 const readJournal=vi.fn().mockResolvedValueOnce({entries,pending:false,problems:[]}).mockResolvedValue({entries:[],pending:false,problems:[]});
 let release!:()=>Promise<void>;
 const owner={state:{ownerId:'owner',sessionId,status:'live',tasks:[]},busy:false,readJournal,refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice:async()=>{},getWorkflowDialogs:async()=>[],getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: vi.fn(async () => []), answerToolPermissionDialog: vi.fn(async () => {}), getFileDialogs:async()=>[],getBashDialogs:async()=>[],getQuestionDialogs:async()=>[],getPlanDialogs:async()=>[],beforeRelease(listener:()=>Promise<void>){release=listener}} as unknown as ClaudeNativeTerminalOwner;
 const {syncClaudeTerminalThread}=await import('#features/threads/be/claude-terminal-sync.ts');
 syncClaudeTerminalThread('thread' as EntityId,owner,()=>true,readLaunch);
 try{await vi.waitFor(()=>expect(fake.thread.context.claudeCode).toMatchObject({toolCallCount:1,chatState:'success'}));expect(fake.messages).toHaveLength(1);expect(fake.messages[0]).toMatchObject({id:'saved-tool',blocks:[{props:{entries:[{nativeResult:{sessionId,uuid:'33333333-3333-3333-3333-333333333333'}}]}}]});}finally{await release();}
});

it.each(['WebFetch', 'Skill'] as const)('refreshes %s native readiness and scope without replacing its pending message', async toolName => {
  let release!: () => Promise<void>
  const presentation = { title: 'Original permission', details: [{ label: 'Target', value: 'Original preview' }], ready: false, token: 'a'.repeat(64), choices: [{ value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: false }] }
  const dialog = { id: 'tool-dialog', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId, requestId: 'tool-use', toolName, input: {}, presentation }
  const owner = { state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: true,
    refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: async () => {}, getGenericToolPermissionDialogs: vi.fn(async () => []), answerGenericToolPermissionDialog: vi.fn(async () => {}), getToolPermissionDialogs: async () => [dialog], getWorkflowDialogs: async () => [], getFileDialogs: async () => [], getBashDialogs: async () => [], getQuestionDialogs: async () => [], getPlanDialogs: async () => [],
    readJournal: async () => ({ entries: [], pending: false, problems: [] }), beforeRelease(listener: () => Promise<void>) { release = listener },
  } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  try {
    await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
    const message = fake.messages[0]
    dialog.presentation = { ...presentation, ready: true, token: 'b'.repeat(64), choices: [...presentation.choices, { value: 'yes-exact', label: 'Original remembered scope', decision: 'allow', feedback: false }] }
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ pendingControlRequest: { nativeTerminal: { tool: dialog.presentation } } }))
    expect(fake.messages).toHaveLength(1)
    expect(fake.messages[0]).toBe(message)
    expect(message).not.toHaveProperty('blockResponse')
  } finally { await release() }
})


it('refreshes original generic previews in place and retires the message when its native dialog closes', async () => {
  let release!: () => Promise<void>
  const presentation = { title: 'Tool use', details: [{ label: 'Parameters', value: 'Original withheld parameter' }], ready: false, token: 'a'.repeat(64), choices: [{ value: 'yes', label: 'Yes', decision: 'allow' as const, feedback: true }], canCancel: true, defaultFocusValue: 'yes', choiceDescriptions: {} }
  const dialog = { id: 'generic-dialog', revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId, requestId: 'tool-use', toolName: 'mcp__research__echo', input: {}, presentation }
  const getGenericToolPermissionDialogs = vi.fn(async () => [dialog])
  const owner = { state: { ownerId: 'owner', sessionId, status: 'live', tasks: [] }, busy: true,
    refreshMcpInput: vi.fn(async () => {}), operateMcpUrl: vi.fn(async () => {}), operateMcpForm: vi.fn(async () => {}), cancelMcpInput: vi.fn(async () => {}), refreshNotice: async () => {}, getGenericToolPermissionDialogs, getToolPermissionDialogs: async () => [], getWorkflowDialogs: async () => [], getFileDialogs: async () => [], getBashDialogs: async () => [], getQuestionDialogs: async () => [], getPlanDialogs: async () => [],
    readJournal: async () => ({ entries: [], pending: false, problems: [] }), beforeRelease(listener: () => Promise<void>) { release = listener },
  } as unknown as ClaudeNativeTerminalOwner
  const { syncClaudeTerminalThread } = await import('#features/threads/be/claude-terminal-sync.ts')
  syncClaudeTerminalThread('thread' as EntityId, owner, () => true, readLaunch)
  try {
    await vi.waitFor(() => expect(fake.messages).toHaveLength(1))
    const message = fake.messages[0]
    dialog.presentation = { ...presentation, ready: true, token: 'b'.repeat(64) }
    await vi.waitFor(() => expect(fake.thread.context.claudeCode).toMatchObject({ pendingControlRequest: { toolName: dialog.toolName, nativeTerminal: { genericTool: dialog.presentation } } }))
    expect(fake.messages).toHaveLength(1); expect(fake.messages[0]).toBe(message)
    getGenericToolPermissionDialogs.mockResolvedValue([])
    await vi.waitFor(() => expect((fake.thread.context.claudeCode as Record<string, unknown>).pendingControlRequest).toBeUndefined())
    expect(message).toMatchObject({ blockResponse: { cancelled: true } })
  } finally { await release() }
})
