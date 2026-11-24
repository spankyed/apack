import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import NativeAgentView from '#features/threads/fe/chat/NativeAgentView.vue'
import type { ClaudeTerminalViewSnapshot } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTaskDetails, ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'
const send = vi.fn(), latest = vi.fn(), following = ref(true)
let context: { nativeUiViews: Record<string, { state: { agent: ClaudeNativeTaskDetails; agentInput?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiMountState['agentInput'] } }>; nativeTerminalViews: Record<string, ClaudeTerminalViewSnapshot> }, app: App | undefined
vi.mock('#extensions/terminal/pool.ts', () => ({ mountNativeTerminal: () => ({ fit: () => ({ columns: 80, rows: 24 }), write: () => {},setInputBlocked:vi.fn(), focus: () => {}, detach: () => {} }) }))
vi.mock('@apackdev/sdk/fe', async () => { const { computed } = await import('vue'); return ({ useSettingsStatus: () => computed(() => 'ready'), useState: () => ({ state: computed(() => ({ data: context })), send: send }),  useSurface: () => ({ send, getSnapshot: () => ({ context, status: 'active' }) }) }) })
vi.mock('#features/threads/fe/chat/native-agent-scroll.ts', () => ({ useClaudeAgentScroll: () => ({ following, latest, intentRevision: () => 0 }) }))
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue', () => ({ default: { props: ['disabled', 'focus', 'openSettings'], setup(_props: unknown, { expose }: { expose(value: unknown): void }) { expose({ focus: () => document.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')?.focus() }) }, template: '<div><input aria-label="Agent draft" :disabled="disabled" /><button @click="openSettings">Claude settings</button></div>' } }))
vi.mock('#features/threads/fe/chat/NativeTranscriptMessage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', () => ({ default: { props: ['modelValue'], template: '<div>{{ modelValue }}</div>' } }))
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); send.mockClear(); latest.mockClear(); following.value = true; context = reactive({ nativeUiViews: {}, nativeTerminalViews: {} }) })
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); document.body.replaceChildren() })
async function mount(draft = 'Keep this draft') {
  const root = document.createElement('div'); document.body.append(root)
  const pending = vi.fn(), returned = vi.fn(), draftChange = vi.fn(), approvalPending = ref(false)
  app = createApp({ render: () => h(NativeAgentView, { threadId: 'thread', target: { ownerId: 'owner', sessionId: 'session', taskId: 'agent', revision: 3 }, name: 'Worker', draft, onDraft: draftChange, active: true, approvalPending: approvalPending.value, onPending: pending, onReturned: returned }) }); app.mount(root)
  const requests = send.mock.calls.map(([value]) => value), ui = requests.find(value => value.type === 'CLAUDE_UI_MOUNT').mountId, terminal = requests.find(value => value.type === 'CLAUDE_TERMINAL_MOUNT').mountId
  const owner: ClaudeNativeTerminalState = { ownerId: 'owner', sessionId: 'session', cwd: '/private/tmp', status: 'live', busy: true, view: { kind: 'agent', revision: 3, registryId: 'registry-agent', taskId: 'agent' }, tasks: [{ id: 'agent', name: 'Worker', status: 'running' }] }
  context.nativeTerminalViews[terminal] = { state: owner, opening: false, output: [] }
  context.nativeUiViews[ui] = { state: { agent: { taskId: 'agent', name: 'Worker', status: 'running', canInput: true, canMessage: false, messages: [], truncated: false, metadata: { prompt: 'Original prompt', promptTruncated: false, model: 'native-model', effort: 'high', elapsedMs: 1234, tokenCount: 42, toolUseCount: 2, errorTruncated: false } } } }
  await nextTick()
  const button = (text: string) => [...root.querySelectorAll('button')].find(element => element.textContent === text)!
  return { root, ui, terminal, owner, pending, returned, draftChange, approvalPending, button }
}
it('uses a matching teammate name while retaining the label for ordinary or stale views', async () => {
  const f = await mount(), heading = f.root.querySelector('h2')!
  const details = context.nativeUiViews[f.ui].state.agent
  expect(heading.textContent).toBe('Worker')
  details.teammateName = 'release-reviewer'; await nextTick()
  expect(heading.textContent).toBe('release-reviewer')
  details.taskId = 'other-agent'; await nextTick()
  expect(heading.textContent).toBe('Worker')
  details.taskId = 'agent'
  context.nativeTerminalViews[f.terminal].state!.sessionId = 'replacement'; await nextTick()
  expect(heading.textContent).toBe('Worker')
})

it('addresses ancestor navigation from the current view and preserves the draft if native refuses it', async () => {
  const f = await mount()
  const details = context.nativeUiViews[f.ui].state.agent
  details.ancestors = [{ taskId: 'parent', name: 'Completed parent' }]
  await nextTick()
  const nav = f.root.querySelector('[aria-label="Agent ancestry"]')!
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Worker')
  const enter = f.button('Completed parent')
  enter.click(); await nextTick()
  const request = send.mock.calls.map(([value]) => value).find(value => value.type === 'CLAUDE_TERMINAL_TASK')
  expect(request).toMatchObject({ operation: 'foreground', taskId: 'parent', fromAgent: { taskId: 'agent', revision: 3 }, ownerId: 'owner', sessionId: 'session' })
  expect(enter.disabled).toBe(true)
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'error', problem: 'Native Agent breadcrumb expired' } }
  await nextTick()
  expect(f.root.querySelector('[role="alert"]')?.textContent).toBe('Native Agent breadcrumb expired')
  expect(f.returned).not.toHaveBeenCalled()
  expect(f.draftChange).not.toHaveBeenCalled()
  context.nativeTerminalViews[f.terminal].state!.view = { kind: 'agent', revision: 4, registryId: 'registry-agent', taskId: 'agent' }
  await nextTick()
  expect(f.root.querySelector('[aria-label="Agent ancestry"]')).toBeNull()
})

it('releases a pending breadcrumb when another window retires its source selection', async () => {
  const f = await mount()
  context.nativeUiViews[f.ui].state.agent.ancestors = [{ taskId: 'parent', name: 'Completed parent' }]
  await nextTick()
  f.button('Completed parent').click()
  await nextTick()
  expect(f.pending).toHaveBeenLastCalledWith(true)
  context.nativeTerminalViews[f.terminal].state!.view = { kind: 'main', revision: 4 }
  await nextTick()
  expect(f.pending).toHaveBeenLastCalledWith(false)
  expect(f.root.querySelector('[aria-label="Agent ancestry"]')).toBeNull()
  expect(f.returned).not.toHaveBeenCalled()
  expect(f.draftChange).not.toHaveBeenCalled()
})

it('keeps the Agent editor mounted while a native approval owns input', async () => {
  const f = await mount(), draft = f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!
  draft.value = 'Keep the in-progress draft'
  f.approvalPending.value = true; await nextTick()
  expect(draft.disabled).toBe(true)
  expect(draft.parentElement?.style.display).toBe('none')
  expect(f.button('Back to conversation').disabled).toBe(false)
  f.approvalPending.value = false; await nextTick()
  expect(f.root.querySelector('[aria-label="Agent draft"]')).toBe(draft)
  expect(draft.disabled).toBe(false)
  expect(draft.parentElement?.style.display).toBe('')
  expect(draft.value).toBe('Keep the in-progress draft')
  expect(f.draftChange).not.toHaveBeenCalled()
})

it.each(['idle', 'waiting'])('stops a %s, still-running teammate and retains parent navigation', async status => {
  const f = await mount()
  context.nativeTerminalViews[f.terminal].state!.tasks[0].status = status
  await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(false)
  f.button('Stop Agent').click(); await nextTick()
  const request = send.mock.calls.map(([value]) => value).find(value => value.type === 'CLAUDE_TERMINAL_TASK')
  expect(request).toMatchObject({ ownerId: 'owner', taskId: 'agent', operation: 'stop', revision: 1, mountId: f.terminal })
  expect(f.button('Stopping…').disabled).toBe(true); expect(f.button('Back to conversation').disabled).toBe(true)
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!.disabled).toBe(true)
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'done', taskId: 'foreign' } }; await nextTick()
  expect(f.button('Stopping…')).toBeTruthy(); expect(f.pending).toHaveBeenLastCalledWith(true)
  context.nativeTerminalViews[f.terminal].state!.tasks[0].status = 'killed'
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'done' } }; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true); expect(f.button('Back to conversation').disabled).toBe(false)
  expect(f.pending).toHaveBeenLastCalledWith(false); expect(f.returned).not.toHaveBeenCalled()
  expect(send.mock.calls.some(([value]) => value.type === 'CLAUDE_TERMINAL_CLOSE')).toBe(false)
  expect(f.root.textContent).toContain('native-model'); expect(f.root.textContent).toContain('high')
})
it('does not offer Stop for a completed waiting task or mismatched inspection', async () => {
  const f = await mount()
  context.nativeTerminalViews[f.terminal].state!.tasks[0].status = 'waiting'
  const details = context.nativeUiViews[f.ui].state.agent
  details.status = 'completed'; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true)
  details.status = 'running'; details.taskId = 'foreign'; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true)
})
it('refuses stale selection/session and exposes native stop refusal without leaving the Agent', async () => {
  const f = await mount()
  context.nativeTerminalViews[f.terminal].state!.sessionId = 'replacement'; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true)
  context.nativeTerminalViews[f.terminal].state!.sessionId = 'session'
  context.nativeTerminalViews[f.terminal].state!.view = { kind: 'agent', revision: 4, registryId: 'registry-agent', taskId: 'agent' }; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true)
  context.nativeTerminalViews[f.terminal].state!.view = { kind: 'agent', revision: 3, registryId: 'registry-agent', taskId: 'agent' }; await nextTick()
  f.button('Stop Agent').click(); await nextTick()
  const request = send.mock.calls.map(([value]) => value).find(value => value.type === 'CLAUDE_TERMINAL_TASK')
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'error', problem: 'Native worker stop refused' } }; await nextTick()
  expect(f.root.querySelector('[role="alert"]')!.textContent).toBe('Native worker stop refused')
  expect(f.button('Stop Agent').disabled).toBe(false); expect(f.returned).not.toHaveBeenCalled()
})

it('owns Escape for native confirmation and restores the Agent editor after cancellation', async () => {
  const f = await mount(), commandId = '12345678-1234-1234-1234-123456789abc'
  context.nativeUiViews[f.ui].state.agentInput = { revision: 7, status: 'confirmation', command: { id: commandId, title: 'Original parent confirmation', confirmLabel: 'Run on parent' } }; await nextTick()
  const cancel = f.button('Cancel'); cancel.focus()
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!.disabled).toBe(true)
  expect(f.button('Back to conversation').disabled).toBe(true)
  cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await nextTick()
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_COMMAND_DECISION', revision: 7, commandId, decision: 'cancel' }))
  expect(send.mock.calls.some(([value]) => value.type === 'CLAUDE_TERMINAL_TASK')).toBe(false)
  context.nativeUiViews[f.ui].state.agentInput = { revision: 7, status: 'command_done', decision: 'cancel' }; await nextTick(); await nextTick()
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!.disabled).toBe(false)
  expect(document.activeElement).toBe(f.root.querySelector('[aria-label="Agent draft"]'))
})

it('shows original compaction as a system event and offers the worker summary as a disclosure', async () => {
  const f = await mount()
  context.nativeUiViews[f.ui].state.agent.messages = [
    { uuid: 'compacted', role: 'system', compaction: 'boundary', text: '' },
    { uuid: 'summary', role: 'system', compaction: 'summary', text: 'Earlier worker context' },
  ]
  await nextTick()
  expect(f.root.querySelector('[data-native-agent-message="compacted"]')?.textContent).toBe('Conversation compacted')
  const details = f.root.querySelector<HTMLDetailsElement>('[data-native-agent-message="summary"] details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toBe('Compact summary')
  expect(details.textContent).toContain('Earlier worker context')
  expect(details.textContent).not.toContain('You')
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')?.disabled).toBe(false)
  expect(f.draftChange).not.toHaveBeenCalled()
})

it('shows native teammate attribution and body while preserving literal composer text', async () => {
  const f = await mount()
  const body = 'Read the release checklist.'
  const envelope = '<teammate-message teammate_id="team-lead" summary="Release review">\n' + body + '\n</teammate-message>'
  const native = { uuid: 'assignment', role: 'user' as const, text: envelope, renderText: envelope, origin: { kind: 'unclassified' } }
  context.nativeUiViews[f.ui].state.agent.messages = [
    native,
    { ...native, uuid: 'person', origin: { kind: 'composer' } },
    { ...native, uuid: 'unverified', text: envelope.replace('team-lead', 'worker').replace('">\n', '" verified="false">\n'),
      renderText: envelope.replace('team-lead', 'worker').replace('">\n', '" verified="false">\n') },
  ]
  await nextTick()
  expect(f.root.querySelector('[data-native-agent-message="assignment"]')?.textContent).toBe('Team lead' + body)
  expect(f.root.querySelector('[data-native-agent-message="person"]')?.textContent).toBe('You' + envelope)
  expect(f.root.querySelector('[data-native-agent-message="unverified"]')?.textContent).toBe('worker (unverified)' + body)
})

it('moves focus to the transcript when jumping back to live output', async () => {
  const f = await mount()
  following.value = false
  await nextTick()
  const transcript = f.root.querySelector('[aria-label="Agent transcript"]')!
  const jump = f.root.querySelector<HTMLButtonElement>('[aria-label="Jump to latest Agent message"]')!
  expect(transcript.contains(jump)).toBe(false)
  jump.focus()
  jump.click()
  expect(latest).toHaveBeenCalledOnce()
  expect(document.activeElement).toBe(transcript)
})

it('renders native command output as bounded plain text outside the worker transcript', async () => {
  const f = await mount()
  context.nativeUiViews[f.ui].state.agentInput = { revision: 8, status: 'command_output', output: { messageId: 'native-result', commandName: 'reload-skills', isErrored: false, text: '<script>untrusted output</script>\nOriginal second line' } }; await nextTick()
  const output = f.root.querySelector('[aria-label="Native command output"]')!
  expect(output.textContent).toContain('<script>untrusted output</script>')
  expect(output.querySelector('script')).toBeNull()
  f.button('Back to messages').click(); await nextTick()
  expect(f.root.querySelector('[aria-label="Native command output"]')).toBeNull()
  expect(document.activeElement).toBe(f.root.querySelector('[aria-label="Agent transcript"]'))
  expect(f.root.querySelector('[aria-label="Agent transcript"]')!.textContent).not.toContain('Original second line')
  expect(f.button('Back to conversation').disabled).toBe(false)
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!.disabled).toBe(false)
})

it('gives the original panel ownership and restores the editor after native closure', async () => {
  const f = await mount(), panelId = '12345678-1234-1234-1234-123456789abc'
  context.nativeUiViews[f.ui].state.agentInput = { revision: 9, status: 'panel', panel: { id: panelId, commandName: 'usage' } }; await nextTick(); await nextTick()
  expect(f.root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Claude Code settings')
  expect(f.button('Back to conversation').disabled).toBe(true)
  expect(f.root.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')!.disabled).toBe(true)
  f.button('Close settings').click()
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_COMMAND_PANEL', revision: 9, panelId }))
  context.nativeUiViews[f.ui].state.agentInput = { revision: 9, status: 'panel_done' }; await nextTick(); await nextTick()
  expect(f.root.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(f.root.querySelector('[aria-label="Agent draft"]'))
})

it('keeps the complete attributed report in the transcript outside collapsed metadata', async () => {
  const f = await mount()
  context.nativeUiViews[f.ui].state.agent.handback = { taskId: 'agent', text: 'Release review complete.\nCheck the migration example before publishing.', warning: 'Original classifier warning' }
  await nextTick()
  const reports = f.root.querySelectorAll('[aria-label="Agent report"]')
  expect(reports).toHaveLength(1)
  expect(reports[0].closest('[aria-label="Agent transcript"]')).not.toBeNull()
  expect(reports[0].closest('details')).toBeNull()
  expect(reports[0].textContent).toContain('Check the migration example before publishing.')
  expect(reports[0].querySelector('[role="alert"]')?.textContent).toBe('Original classifier warning')
  expect(f.button('Back to conversation').disabled).toBe(false)
})

it('preserves even a /config draft when Settings opens, with Agent identity in the compact panel header',async()=>{
 const f=await mount('/config');f.button('Claude settings').click();await nextTick()
 const request=send.mock.calls.map(([value])=>value).find(value=>value.type==='CLAUDE_UI_AGENT_INPUT')
 expect(request.text).toBe('/config')
 context.nativeUiViews[f.ui].state.agentInput={revision:request.revision,status:'panel',panel:{id:'12345678-1234-1234-1234-123456789abc',commandName:'config'}}
 await nextTick();await nextTick()
 expect(f.draftChange).not.toHaveBeenCalled()
 expect(f.root.querySelector('[role="dialog"]')?.textContent).toContain('Agent · Worker')
 expect(f.root.querySelector<HTMLElement>('.native-agent-view > header')?.style.display).toBe('none')
 context.nativeUiViews[f.ui].state.agentInput={revision:request.revision,status:'panel_done'}
 await nextTick();await nextTick()
 expect(f.root.querySelector<HTMLElement>('.native-agent-view > header')?.style.display).not.toBe('none')
 expect(f.draftChange).not.toHaveBeenCalled()
})
