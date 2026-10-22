import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import NativeAgentView from '#features/threads/fe/chat/NativeAgentView.vue'
import type { ClaudeTerminalViewSnapshot } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTaskDetails, ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'
const send = vi.fn()
let context: { nativeUiViews: Record<string, { state: { agent: ClaudeNativeTaskDetails; agentInput?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiMountState['agentInput'] } }>; nativeTerminalViews: Record<string, ClaudeTerminalViewSnapshot> }, app: App | undefined
vi.mock('#features/threads/fe/chat/native-terminal-pool.ts', () => ({ mountNativeTerminal: () => ({ fit: () => ({ columns: 80, rows: 24 }), write: () => {}, focus: () => {}, detach: () => {} }) }))
vi.mock('@apackdev/sdk/fe', () => ({ usePlugin: () => ({ send, getSnapshot: () => ({ context, status: 'active' }) }) }))
vi.mock('@xstate/vue', async () => { const { computed } = await import('vue'); return { useSelector: (_actor: unknown, select: (value: unknown) => unknown) => computed(() => select({ context })) } })
vi.mock('#features/threads/fe/chat/native-agent-scroll.ts', () => ({ useClaudeAgentScroll: () => ({ following: ref(true), latest: () => {}, intentRevision: () => 0 }) }))
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue', () => ({ default: { props: ['disabled', 'focus', 'openSettings'], setup(_props: unknown, { expose }: { expose(value: unknown): void }) { expose({ focus: () => document.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')?.focus() }) }, template: '<div><input aria-label="Agent draft" :disabled="disabled" /><button @click="openSettings">Claude settings</button></div>' } }))
vi.mock('#features/threads/fe/chat/NativeTranscriptMessage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', () => ({ default: { template: '<div />' } }))
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); send.mockClear(); context = reactive({ nativeUiViews: {}, nativeTerminalViews: {} }) })
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); document.body.replaceChildren() })
async function mount(draft = 'Keep this draft') {
  const root = document.createElement('div'); document.body.append(root)
  const pending = vi.fn(), returned = vi.fn(), draftChange = vi.fn()
  app = createApp({ render: () => h(NativeAgentView, { threadId: 'thread', target: { ownerId: 'owner', sessionId: 'session', taskId: 'agent', revision: 3 }, name: 'Worker', draft, onDraft: draftChange, active: true, onPending: pending, onReturned: returned }) }); app.mount(root)
  const requests = send.mock.calls.map(([value]) => value), ui = requests.find(value => value.type === 'CLAUDE_UI_MOUNT').mountId, terminal = requests.find(value => value.type === 'CLAUDE_TERMINAL_MOUNT').mountId
  const owner: ClaudeNativeTerminalState = { ownerId: 'owner', sessionId: 'session', cwd: '/private/tmp', status: 'live', busy: true, view: { kind: 'agent', revision: 3, registryId: 'registry-agent', taskId: 'agent' }, tasks: [{ id: 'agent', name: 'Worker', status: 'running' }] }
  context.nativeTerminalViews[terminal] = { state: owner, opening: false, output: [] }
  context.nativeUiViews[ui] = { state: { agent: { taskId: 'agent', name: 'Worker', status: 'running', canInput: true, canMessage: false, messages: [], truncated: false, metadata: { prompt: 'Original prompt', promptTruncated: false, model: 'native-model', effort: 'high', elapsedMs: 1234, tokenCount: 42, toolUseCount: 2, errorTruncated: false } } } }
  await nextTick()
  const button = (text: string) => [...root.querySelectorAll('button')].find(element => element.textContent === text)!
  return { root, ui, terminal, owner, pending, returned, draftChange, button }
}
it('stops only the selected worker, rejects unrelated acknowledgments and retains parent navigation', async () => {
  const f = await mount(); f.button('Stop Agent').click(); await nextTick()
  const request = send.mock.calls.map(([value]) => value).find(value => value.type === 'CLAUDE_TERMINAL_TASK')
  expect(request).toMatchObject({ ownerId: 'owner', taskId: 'agent', operation: 'stop', revision: 1, mountId: f.terminal })
  expect(f.button('Stopping…').disabled).toBe(true); expect(f.button('Back to conversation').disabled).toBe(true)
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'done', taskId: 'foreign' } }; await nextTick()
  expect(f.button('Stopping…')).toBeTruthy(); expect(f.pending).toHaveBeenLastCalledWith(true)
  context.nativeTerminalViews[f.terminal].state!.tasks[0].status = 'killed'
  context.nativeTerminalViews[f.terminal] = { ...context.nativeTerminalViews[f.terminal], task: { ...request, status: 'done' } }; await nextTick()
  expect(f.button('Stop Agent').disabled).toBe(true); expect(f.button('Back to conversation').disabled).toBe(false)
  expect(f.pending).toHaveBeenLastCalledWith(false); expect(f.returned).not.toHaveBeenCalled()
  expect(send.mock.calls.some(([value]) => value.type === 'CLAUDE_TERMINAL_CLOSE')).toBe(false)
  expect(f.root.textContent).toContain('native-model'); expect(f.root.textContent).toContain('high')
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
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
  expect(f.button('Back to conversation').disabled).toBe(true)
  cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await nextTick()
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_COMMAND_DECISION', revision: 7, commandId, decision: 'cancel' }))
  expect(send.mock.calls.some(([value]) => value.type === 'CLAUDE_TERMINAL_TASK')).toBe(false)
  context.nativeUiViews[f.ui].state.agentInput = { revision: 7, status: 'command_done', decision: 'cancel' }; await nextTick(); await nextTick()
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(false)
  expect(document.activeElement).toBe(f.root.querySelector('input'))
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
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(false)
})

it('gives the original panel ownership and restores the editor after native closure', async () => {
  const f = await mount(), panelId = '12345678-1234-1234-1234-123456789abc'
  context.nativeUiViews[f.ui].state.agentInput = { revision: 9, status: 'panel', panel: { id: panelId, commandName: 'usage' } }; await nextTick(); await nextTick()
  expect(f.root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Native /usage panel')
  expect(f.button('Back to conversation').disabled).toBe(true)
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true)
  f.button('Close panel').click()
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_COMMAND_PANEL', revision: 9, panelId }))
  context.nativeUiViews[f.ui].state.agentInput = { revision: 9, status: 'panel_done' }; await nextTick(); await nextTick()
  expect(f.root.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(f.root.querySelector('input'))
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
