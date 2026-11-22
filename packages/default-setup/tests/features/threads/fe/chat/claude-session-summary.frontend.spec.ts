import { computed, createApp, h, nextTick, ref } from 'vue'
import ClaudeSessionArtifact from '#extensions/artifacts/viewers/claude-session-artifact.vue'
import type { ClaudeTerminalViewSnapshot } from '#features/threads/be/claude-terminal-views.ts'
import type { ClaudeNativeTerminalState } from '#features/code/common/native-terminal.ts'

const currentThread = ref<{ id: string; context: { claudeCode: { sessionId: string; chatState: string; nativeContinuation?: { sessionId: string } } } }>()
const terminalViews = ref<Record<string, ClaudeTerminalViewSnapshot & { threadId: string; queueComposer?: boolean }>>({})
vi.mock('#generated/fe.ts', () => ({
  useSurfaceState: (_surface: string, select: (state: Record<string, unknown>) => unknown) => computed(() => select({
    currentThread: currentThread.value,
    nativeTerminalViews: terminalViews.value,
    settings: { chatStates: [{ id: 'success', label: 'Success', color: '#22c55e' }] },
  })),
  openSurface: vi.fn(),
}))
vi.mock('#generated/events.ts', () => ({ sendToSurface: vi.fn(), tell: vi.fn() }))

it('shows a current authenticated terminal disconnect and clears it for a replacement', async () => {
  currentThread.value = { id: 'thread', context: { claudeCode: { sessionId: 'session', chatState: 'success' } } }
  const native: ClaudeNativeTerminalState = {
    sessionId: 'session', ownerId: 'old', status: 'live', nativePid: 42, cwd: '/test', busy: false, tasks: [],
  }
  const view = { threadId: 'thread', opening: false, output: [] }
  terminalViews.value = { main: { ...view, state: native } }
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(ClaudeSessionArtifact, { artifact: {} as never }) })
  const label = () => root.querySelector('[aria-label="Claude session summary status"]')?.textContent?.trim()
  app.mount(root)
  try {
    expect(label()).toBe('Success')
    terminalViews.value = { main: { ...view, state: { ...native, status: 'error' } }, composer: { ...view, queueComposer: true } }
    await nextTick()
    expect(label()).toBe('Disconnected')

    terminalViews.value = {
      ...terminalViews.value,
      fresh: { ...view, state: { ...native, ownerId: 'new', status: 'starting' } },
    }
    await nextTick()
    expect(label()).toBe('Success')

    const oldError = terminalViews.value.main
    terminalViews.value = { main: { ...oldError, state: { ...native, sessionId: 'retired-session', status: 'error' } } }
    await nextTick()
    expect(label()).toBe('Success')

    terminalViews.value = { main: { ...view, state: { ...native, status: 'error', nativePid: undefined } } }
    await nextTick()
    expect(label()).toBe('Success')

    terminalViews.value = { main: { ...view, state: { ...native, status: 'exited' } } }
    await nextTick()
    expect(label()).toBe('Success')

    terminalViews.value = { main: oldError }
    currentThread.value.context.claudeCode.nativeContinuation = { sessionId: 'session' }
    await nextTick()
    expect(label()).toBe('Success')
  } finally {
    app.unmount()
    root.remove()
  }
})
