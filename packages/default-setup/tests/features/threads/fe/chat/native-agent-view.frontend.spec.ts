import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import NativeAgentView from '#features/threads/fe/chat/NativeAgentView.vue'
import type { ClaudeTerminalViewSnapshot } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTaskDetails, ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'
const send = vi.fn()
let context: { nativeUiViews: Record<string, { state: { agent: ClaudeNativeTaskDetails; agentInput?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiMountState['agentInput'] } }>; nativeTerminalViews: Record<string, ClaudeTerminalViewSnapshot> }, app: App | undefined
vi.mock('@apackdev/sdk/fe', () => ({ usePlugin: () => ({ send }) }))
vi.mock('@xstate/vue', async () => { const { computed } = await import('vue'); return { useSelector: (_actor: unknown, select: (value: unknown) => unknown) => computed(() => select({ context })) } })
vi.mock('#features/threads/fe/chat/native-agent-scroll.ts', () => ({ useClaudeAgentScroll: () => ({ following: ref(true), latest: () => {}, intentRevision: () => 0 }) }))
vi.mock('#features/threads/fe/chat/NativeAgentComposer.vue', () => ({ default: { props: ['disabled', 'focus'], setup(_props: unknown, { expose }: { expose(value: unknown): void }) { expose({ focus: () => document.querySelector<HTMLInputElement>('[aria-label="Agent draft"]')?.focus() }) }, template: '<input aria-label="Agent draft" :disabled="disabled" />' } }))
vi.mock('#features/threads/fe/chat/NativeTranscriptMessage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', () => ({ default: { template: '<div />' } }))
beforeEach(() => { send.mockClear(); context = reactive({ nativeUiViews: {}, nativeTerminalViews: {} }) })
afterEach(() => { app?.unmount(); document.body.replaceChildren() })
async function mount() {
  const root = document.createElement('div'); document.body.append(root)
  const pending = vi.fn(), returned = vi.fn()
  app = createApp({ render: () => h(NativeAgentView, { threadId: 'thread', target: { ownerId: 'owner', sessionId: 'session', taskId: 'agent', revision: 3 }, name: 'Worker', draft: 'Keep this draft', active: true, onPending: pending, onReturned: returned }) }); app.mount(root)
  const requests = send.mock.calls.map(([value]) => value), ui = requests.find(value => value.type === 'CLAUDE_UI_MOUNT').mountId, terminal = requests.find(value => value.type === 'CLAUDE_TERMINAL_MOUNT').mountId
  const owner: ClaudeNativeTerminalState = { ownerId: 'owner', sessionId: 'session', cwd: '/private/tmp', status: 'live', busy: true, view: { kind: 'agent', revision: 3, registryId: 'registry-agent', taskId: 'agent' }, tasks: [{ id: 'agent', name: 'Worker', status: 'running' }] }
  context.nativeTerminalViews[terminal] = { state: owner, opening: false, output: [] }
  context.nativeUiViews[ui] = { state: { agent: { taskId: 'agent', name: 'Worker', status: 'running', canInput: true, canMessage: false, messages: [], truncated: false, metadata: { prompt: 'Original prompt', promptTruncated: false, model: 'native-model', effort: 'high', elapsedMs: 1234, tokenCount: 42, toolUseCount: 2, errorTruncated: false } } } }
  await nextTick()
  const button = (text: string) => [...root.querySelectorAll('button')].find(element => element.textContent === text)!
  return { root, ui, terminal, owner, pending, returned, button }
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
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'CLAUDE_UI_AGENT_COMMAND', revision: 7, commandId, decision: 'cancel' }))
  expect(send.mock.calls.some(([value]) => value.type === 'CLAUDE_TERMINAL_TASK')).toBe(false)
  context.nativeUiViews[f.ui].state.agentInput = { revision: 7, status: 'command_done', decision: 'cancel' }; await nextTick(); await nextTick()
  expect(f.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(false)
  expect(document.activeElement).toBe(f.root.querySelector('input'))
})
