import type { ClaudeUiRender, ClaudeUiRenderResult, ClaudeUiPress } from '#features/code/be/services/claude-code/ui-controls.ts'
import { createClaudeTranscriptMessageHost } from '#features/code/be/services/claude-code/ui-transcript-messages.ts'
import type { ClaudeUiTranscriptRow } from '#features/code/be/services/claude-code/ui-presentation.ts'
function fixture(clientId = 'view') {
  let current = true, handle = 0
  let rows: ClaudeUiTranscriptRow[] = ['a', 'b'].map((uuid, index) => ({ component: 'AssistantMessage' as const, uuid, messageId: 'app', sessionId: 'session', text: 'Native text', start: index * 12, end: index * 12 + 11, isFirstOfReply: index === 0 }))
  const ui = {
    render: vi.fn(async (_request: ClaudeUiRender): Promise<ClaudeUiRenderResult> => ({ tree: { type: 'Box', children: [
      { type: 'Button', props: { key: 'run', label: 'Run' }, press: { plugin: 'fixture', handle: ++handle } },
      { type: 'Input', props: { key: 'draft', value: '', label: 'Draft' }, press: { plugin: 'fixture', handle: ++handle } },
      { type: 'engine', ref: 1 },
    ] }, props: { text: 'Display rewrite' }, hooked: true, rewritten: true })),
    press: vi.fn(async (_request: ClaudeUiPress) => ({ handled: true })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })),
  }
  const publish = vi.fn()
  const host = createClaudeTranscriptMessageHost({ ui, client: { client_id: clientId, surface: 'desktop' }, rows: () => rows, current: () => current, publish })
  const nodes = (index = 0) => { const body = host.state[index].body; if (body.status !== 'live' || body.tree.kind !== 'box') throw Error('expected message'); return body.tree.children }
  return { host, ui, publish, nodes, rows, replace: () => { current = false }, setRows: (next: ClaudeUiTranscriptRow[]) => { rows = next } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('renders distinct native instances, retaining display-only rewrites and independent actions', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render.mock.calls.map(args => args[0])).toEqual(['a', 'b'].map((id, index) => ({ client_id: 'view', surface: 'desktop', component: 'AssistantMessage', instance_id: id, props: { text: 'Native text', isFirstOfReply: index === 0 } })))
  expect(f.host.state.map(frame => [frame.uuid, frame.text, frame.displayText])).toEqual([['a', 'Native text', 'Display rewrite'], ['b', 'Native text', 'Display rewrite']])
  const a = f.nodes(0)[0], b = f.nodes(1)[0]; if (a.kind !== 'button' || b.kind !== 'button') throw Error('buttons')
  expect(a.actionId).not.toBe(b.actionId)
  await f.host.press(a.actionId!); await f.host.press(b.actionId!)
  expect(f.ui.press.mock.calls.map(args => args[0].handle)).toEqual([1, 3])
  await expect(f.host.press(a.actionId!)).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('validates current persisted membership before executing even when refresh has not run', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const node = f.nodes()[0]; if (node.kind !== 'button') throw Error('button')
  f.setRows(f.rows.slice(1))
  await expect(f.host.press(node.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.refresh(); expect(f.host.state.map(frame => frame.uuid)).toEqual(['b'])
  f.host.dispose()
})
it('coalesces invalidation and refuses old callbacks while retaining keyed field edits', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  for (let i = 0; i < 100; i++) f.host.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Typed' })
  expect(f.ui.input).toHaveBeenCalledWith(expect.objectContaining({ component: 'AssistantMessage', instance_id: 'a', value: 'Typed' }))
  await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenCalledTimes(4)
  expect(f.nodes()[1]).toMatchObject({ actionId: input.actionId, revision: 1 })
  await expect(f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Duplicate' })).resolves.toEqual({ handled: false })
  f.host.dispose()
})
it('rejects another view and retires all row callbacks on owner replacement or disposal', async () => {
  const f = fixture(), other = fixture('other'); f.host.start(); other.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  await expect(other.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  f.replace(); await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.dispose(); other.host.dispose(); expect(f.host.state).toEqual([])
})
it('discards an in-flight render whose persisted row was removed', async () => {
  const f = fixture(); let finish!: (value: Awaited<ReturnType<typeof f.ui.render>>) => void
  f.ui.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  f.setRows([]); f.host.refresh()
  finish({ tree: { type: 'engine', ref: 1 }, props: { text: 'Late' }, hooked: true, rewritten: true })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state).toEqual([])
  f.host.dispose()
})

it('keeps a failed message callback local and never retries its possible native side effect', async () => {
  const f = fixture(); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.ui.press.mockRejectedValueOnce(new Error('Lost native reply'))
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.host.state[0].body.status).toBe('error'); expect(f.host.state[0].displayText).toBe('Native text')
  expect(f.host.state[1].body.status).toBe('live')
  await vi.advanceTimersByTimeAsync(500)
  expect(f.ui.press).toHaveBeenCalledTimes(1)
  f.host.dispose()
})


it('routes user fields by component and retains keyed drafts across readonly expansion changes', async () => {
  const f = fixture()
  const user: ClaudeUiTranscriptRow = { component: 'UserMessage', messageId: 'app-user', uuid: 'native-user', sessionId: 'session', text: 'Typed prompt', start: 0, end: 12, origin: { kind: 'unclassified' }, isExpanded: false }
  f.setRows([user]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'UserMessage', instance_id: 'native-user', props: { text: 'Typed prompt', origin: { kind: 'unclassified' }, isExpanded: false } }))
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  await f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'User note' })
  expect(f.ui.input).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'UserMessage', instance_id: 'native-user', value: 'User note' }))
  f.setRows([{ ...user, isExpanded: true }]); f.host.refresh()
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await vi.advanceTimersByTimeAsync(50)
  expect(f.nodes()[1]).toMatchObject({ actionId: input.actionId, revision: 1 })
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ props: { text: 'Typed prompt', origin: { kind: 'unclassified' }, isExpanded: true } }))
  f.host.dispose()
})
it('caps user body rewrites at the native printable limit without changing stored text', async () => {
  const f = fixture(), original = 'Original prompt', rewrite = 'x'.repeat(100001)
  f.setRows([{ component: 'UserMessage', messageId: 'app-user', uuid: 'user', sessionId: 'session', text: original, start: 0, end: original.length, origin: { kind: 'unclassified' }, isExpanded: true }])
  f.ui.render.mockResolvedValueOnce({ tree: { type: 'engine', ref: 1 }, props: { text: rewrite }, rewritten: true, hooked: true })
  f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.host.state[0].displayText).toHaveLength(100000); expect(f.host.state[0].text).toBe(original)
  f.host.dispose()
})

it('retires collapsed summary controls before reopening a fresh drawing', async () => {
  const f = fixture()
  const summary: ClaudeUiTranscriptRow = { ...f.rows[0], component: 'AssistantMessage', isFirstOfReply: true, isSummary: true, blockIndex: 2, text: '  <context>Hidden</context>\nSummary  ', start: 0, end: 37 }
  f.setRows([summary]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ props: { text: 'Summary', isSummary: true, isFirstOfReply: true } }))
  const button = f.nodes()[0], input = f.nodes()[1]; if (button.kind !== 'button' || input.kind !== 'input') throw Error('controls')
  f.setRows([])
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.field({ actionId: input.actionId, revision: 1, kind: 'change', value: 'Stale' })).resolves.toEqual({ handled: false })
  f.host.refresh(); expect(f.host.state).toEqual([])
  f.setRows([summary]); f.host.refresh(); await vi.advanceTimersByTimeAsync(50)
  const reopened = f.nodes()[0]; if (reopened.kind !== 'button') throw Error('button')
  expect(reopened.actionId).not.toBe(button.actionId)
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  await expect(f.host.press(reopened.actionId!)).resolves.toEqual({ handled: true })
  f.host.dispose()
})

it('renders command output by original UUID and retires callbacks when its error state changes', async () => {
  const f = fixture()
  const command: ClaudeUiTranscriptRow = { component: 'CommandOutput', messageId: 'app-command', uuid: 'native-command', sessionId: 'session', text: 'Result', start: 0, end: 6, isErrored: false }
  f.setRows([command]); f.host.start(); await vi.advanceTimersByTimeAsync(50)
  expect(f.ui.render).toHaveBeenLastCalledWith(expect.objectContaining({ component: 'CommandOutput', instance_id: 'native-command', props: { text: 'Result', isErrored: false } }))
  expect(f.host.state[0]).toMatchObject({ text: 'Result', displayText: 'Display rewrite' })
  const button = f.nodes()[0]; if (button.kind !== 'button') throw Error('button')
  f.setRows([{ ...command, isErrored: true }])
  await expect(f.host.press(button.actionId!)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
  f.host.dispose()
})
