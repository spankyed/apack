import { randomUUID } from 'node:crypto'
import { claudeTerminalAgentInputRuntime } from '#features/code/be/services/claude-code/terminal-agent-input-runtime.ts'

function fixture(main = false) {
  let draft = '', sequence = 1, panelShown = false, finish!: () => void
  const messageId = randomUUID(), rows: unknown[] = [], parentRows: unknown[] = [], notices: { current?: unknown } = {}
  const cancel = vi.fn(() => finish()), confirm = vi.fn(() => finish())
  const localJsx = { show: vi.fn((_element: unknown, _options: unknown) => { panelShown = true; return { nodeId: 'native-node', closed: new Promise<void>(resolve => { finish = () => { panelShown = false; resolve() } }) } }) }
  const dismissPanel = vi.fn((_id: string) => finish()), stdin = { unshift: vi.fn(), emit: vi.fn() }
  const task = { id: 'registry', type: 'local_agent', status: 'completed' }
  const context = { dialogStore: { dismiss: dismissPanel, getState: () => ({ open: panelShown ? [{ id: 'native-dialog', kind: 'local_jsx', payload: { nodeId: 'native-node' } }] : [] }) }, localJsx, getAppState: () => ({ notifications: notices }), taskRegistry: { all: () => ({ registry: task }), getTranscript: () => ({ messages: rows }) } }
  const composer = { read: vi.fn(async () => ({ text: draft })), write: vi.fn(async (text: string) => { draft = text }) }
  const binding = { messages: () => parentRows, commands: () => [], composer, toolContext: () => context, savedAgentMessages: async () => [] }
  const native = { commandInput: { IS: (text: string) => text.startsWith('/') ? { commandName: text.slice(1), args: '' } : null }, engine: { Rs: (name: string) => ({ type: name === 'context' ? 'local-jsx' : 'local', name }), Cie: (command: { name: string }) => ({ command: command.name, args: '' }) }, commandOutput: { s4t: (text: string) => ({ message: { content: [{ type: 'text', text }] } }) }, gate: { _Jo: async () => {} }, runtime: { flt: () => ({ id: 'agent' }), GYt: (text: string) => ({ input: text, removed: { removedTotal: 0 } }) } }
  const enter = vi.fn(async () => {
    if (draft === '/compact') localJsx.show({ props: { title: 'Original parent confirmation', confirmLabel: 'Original confirm', onConfirm: confirm, onCancel: cancel } }, { commandName: 'compact' })
    else if (draft === '/usage') localJsx.show({ type: () => {}, props: {} }, { commandName: 'usage' })
    else if (draft === '/model haiku') notices.current = { key: 'agent-view-command-notice', segments: [{ text: 'Original block notice' }] }
    else if (draft === '/context') { parentRows.push({ uuid: messageId, type: 'system', subtype: 'local_command', content: 'Native Context usage', commandRun: { command: 'context', args: '' } }); draft = '' }
    else if (draft === '/cost') { parentRows.push({ uuid: messageId, type: 'system', subtype: 'local_command', content: 'Original cost output', commandRun: { command: 'cost', args: '' } }); draft = '' }
    else { rows.push({ uuid: messageId, type: 'user', origin: { kind: 'human' }, message: { content: draft } }); draft = '' }
    return { entered: true }
  })
  const make = new Function('randomUUID', 'clients', 'clientViewCurrent', 'nativeViewFacts', 'originalContext', 'ownerPost', 'process', claudeTerminalAgentInputRuntime + '\nreturn { dispatch:dispatchNativeAgentInput, answer:answerNativeAgentCommand, retire:retireNativeAgentCommands, panel:nativeAgentPanel, parent:dispatchNativeParentCommand };')
  const controller = make(randomUUID, new Set(['client']), () => true, () => ({ sessionId: 'session', sequence, view: main ? { kind: 'main' } : { kind: 'agent', taskId: 'agent' } }), binding, enter, { stdin }) as {
    dispatch(n: unknown, request: { client_id: string; text: string }, abort: AbortController): Promise<{ kind: string; id: string; messageId: string; message: string }>
    parent(n: unknown, request: { client_id: string; text: string }, abort: AbortController): Promise<unknown>
    answer(n: unknown, request: { client_id: string; command_id: string; decision: string }): Promise<unknown>
    panel(n: unknown, request: { client_id: string; panel_id: string; operation: string; text?: string }): Promise<{ open: boolean }>
    retire(client: string): Promise<void>
  }
  return { controller, native, composer, enter, cancel, confirm, dismissPanel, localJsx, notices, stdin, messageId, rows, parentRows, draft: () => draft, setDraft: (value: string) => { draft = value }, move: () => { sequence++ } }
}
it('correlates the original human UUID and leaves native blocking policy in the dispatcher', async () => {
  const f = fixture()
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: 'Human input' }, new AbortController())).toMatchObject({ kind: 'input', messageId: f.messageId })
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: '/model haiku' }, new AbortController())).toMatchObject({ kind: 'blocked', message: 'Original block notice' })
  expect(f.draft()).toBe('')
})
it('keeps confirmation alive after the initial HTTP request completes and refuses replay/foreign clients', async () => {
  const f = fixture(), abort = new AbortController()
  const result = await f.controller.dispatch(f.native, { client_id: 'client', text: '/compact' }, abort)
  expect(result.kind).toBe('confirmation'); abort.abort()
  await expect(f.controller.answer(f.native, { client_id: 'foreign', command_id: result.id, decision: 'cancel' })).rejects.toThrow('expired')
  expect(await f.controller.answer(f.native, { client_id: 'client', command_id: result.id, decision: 'cancel' })).toEqual({ answered: true })
  expect(f.cancel).toHaveBeenCalledOnce(); expect(f.confirm).not.toHaveBeenCalled(); expect(f.draft()).toBe('')
  await expect(f.controller.answer(f.native, { client_id: 'client', command_id: result.id, decision: 'cancel' })).rejects.toThrow('expired')
})
it('preserves an unrelated native draft and refuses an old view confirmation', async () => {
  const f = fixture(); f.setDraft('Native person draft')
  await expect(f.controller.dispatch(f.native, { client_id: 'client', text: 'App draft' }, new AbortController())).rejects.toThrow('unsent draft')
  expect(f.enter).not.toHaveBeenCalled(); expect(f.draft()).toBe('Native person draft')
  f.setDraft('')
  const result = await f.controller.dispatch(f.native, { client_id: 'client', text: '/compact' }, new AbortController())
  f.move(); f.setDraft('New view draft')
  await expect(f.controller.answer(f.native, { client_id: 'client', command_id: result.id, decision: 'confirm' })).rejects.toThrow('selection changed')
  expect(f.confirm).not.toHaveBeenCalled()
  await f.controller.retire('client'); expect(f.cancel).toHaveBeenCalledOnce(); expect(f.draft()).toBe('New view draft')
})

it('returns a new matching parent command result without treating it as worker input', async () => {
  const f = fixture()
  f.parentRows.push({ uuid: randomUUID(), type: 'system', subtype: 'local_command', content: 'Old output', commandRun: { command: 'cost', args: '' } })
  f.parentRows.push({ uuid: randomUUID(), type: 'system', subtype: 'local_command', content: 'Other output', commandRun: { command: 'help', args: '' } })
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: '/cost' }, new AbortController())).toEqual({ kind: 'command_output', messageId: f.messageId, commandName: 'cost', text: 'Original cost output' })
  expect(f.rows).toHaveLength(0)
  expect(f.draft()).toBe('')
})

it('scopes live panel input and original store dismissal by client, selection and lifecycle', async () => {
  const f = fixture(), result = await f.controller.dispatch(f.native, { client_id: 'client', text: '/usage' }, new AbortController())
  expect(result.kind).toBe('panel')
  const request = { client_id: 'client', panel_id: result.id }
  await expect(f.controller.panel(f.native, { ...request, client_id: 'foreign', operation: 'input', text: 'x' })).rejects.toThrow('expired')
  expect(f.stdin.unshift).not.toHaveBeenCalled()
  await f.controller.panel(f.native, { ...request, operation: 'input', text: 'x' })
  expect(f.stdin.unshift).toHaveBeenCalledWith('x'); expect(f.stdin.emit).toHaveBeenCalledWith('readable')
  expect(await f.controller.panel(f.native, { ...request, operation: 'close' })).toEqual({ open: false })
  expect(f.dismissPanel).toHaveBeenCalledWith('native-dialog'); expect(f.rows).toHaveLength(0)
  await expect(f.controller.panel(f.native, { ...request, operation: 'input', text: 'late' })).rejects.toThrow('expired')
  await expect(f.controller.panel(f.native, { ...request, operation: 'close' })).rejects.toThrow('expired')
  const next = await f.controller.dispatch(f.native, { client_id: 'client', text: '/usage' }, new AbortController()); f.move()
  await expect(f.controller.panel(f.native, { ...request, panel_id: next.id, operation: 'input', text: 'stale' })).rejects.toThrow('selection changed')
  await f.controller.retire('client'); expect(f.dismissPanel).toHaveBeenCalledTimes(2)
})

it('observes JSX command text completion without requiring a panel or worker receipt', async () => {
  const f = fixture()
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: '/context' }, new AbortController())).toEqual({ kind: 'command_output', messageId: f.messageId, commandName: 'context', text: 'Native Context usage' })
  expect(f.rows).toHaveLength(0)
})

it('does not acknowledge an unrelated original panel as the submitted command', async () => {
  const f = fixture()
  f.enter.mockImplementationOnce(async () => {
    f.localJsx.show({ props: {} }, { commandName: 'foreign-command' })
    f.notices.current = { key: 'agent-view-command-notice', text: 'Original command block' }
    return { entered: true }
  })
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: '/usage' }, new AbortController())).toMatchObject({ kind: 'blocked', message: 'Original command block' })
  f.dismissPanel('native-dialog')
  expect(await f.controller.dispatch(f.native, { client_id: 'client', text: 'Human reply' }, new AbortController())).toMatchObject({ kind: 'input' })
})

it('dispatches parent local commands while leaving ordinary prompts on their original bridge', async () => {
  const f = fixture(true)
  expect(await f.controller.parent(f.native, { client_id: 'client', text: 'Ordinary parent prompt' }, new AbortController())).toEqual({ kind: 'not_command' })
  expect(f.enter).not.toHaveBeenCalled(); expect(f.composer.write).not.toHaveBeenCalled()
  expect(await f.controller.parent(f.native, { client_id: 'client', text: '/context' }, new AbortController())).toEqual({ kind: 'command_output', messageId: f.messageId, commandName: 'context', text: 'Native Context usage' })
  expect(f.rows).toHaveLength(0)
  await expect(f.controller.dispatch(f.native, { client_id: 'client', text: 'Worker input' }, new AbortController())).rejects.toThrow('No native Agent')
  const selected = fixture()
  await expect(selected.controller.parent(selected.native, { client_id: 'client', text: '/help' }, new AbortController())).rejects.toThrow('main view')
  expect(selected.enter).not.toHaveBeenCalled()
})
