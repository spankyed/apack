import { createApp, h, nextTick, type App } from 'vue'
import { claudeNativeMessageParts } from '#features/threads/fe/chat/native-message-parts.ts'
import NativeAssistantMessage from '#features/threads/fe/chat/NativeAssistantMessage.vue'
import type { ClaudeUiAssistantFrame } from '#features/code/be/services/claude-code/ui-presentation.ts'
vi.mock('@apackdev/ui/components/tiptap/TiptapEditor', async () => {
  const { h } = await import('vue')
  return { default: { props: ['modelValue'], setup: (props: { modelValue?: string }) => () => h('div', { 'data-engine-text': true }, props.modelValue) } }
})
const frame = (uuid: string, start: number, text: string): ClaudeUiAssistantFrame => ({ messageId: 'app', sessionId: 'session', uuid, text, start, end: start + text.length, isFirstOfReply: start === 0, displayText: 'Display only <script>literal</script>', body: { status: 'live', tree: { kind: 'box', children: [
  { kind: 'box', children: [{ kind: 'unsupported', component: 'engine' }] },
  { kind: 'button', label: 'Inspect row', actionId: uuid + '-action', hotkey: 'i' },
] } } })
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })
it('forwards the engine slot through nested native boxes and keeps native text literal', async () => {
  const press = vi.fn(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeAssistantMessage, { frame: frame('a', 0, 'Stored original'), onPress: press }) }); app.mount(root)
  expect(root.querySelector('[data-engine-text]')?.textContent).toBe('Display only <script>literal</script>')
  expect(root.querySelector('script')).toBeNull()
  expect(root.textContent).not.toContain('Stored original')
  root.querySelector('button')!.click()
  expect(press).toHaveBeenCalledWith('a-action', undefined)
  root.querySelector('[data-native-assistant]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }))
  expect(press).toHaveBeenCalledTimes(2)
  await nextTick()
})
it('preserves unmatched text and a live stream tail and rejects stale/overlapping frames', () => {
  const first = frame('a', 0, 'First'), second = frame('b', 6, 'Second')
  const parts = claudeNativeMessageParts('app', 'First\nSecond\nStill streaming', [second, first])
  expect(parts.map(part => part.kind === 'host' ? part.text : part.frame.uuid)).toEqual(['a', '\n', 'b', '\nStill streaming'])
  expect(claudeNativeMessageParts('other-app', 'First', [first])).toEqual([{ kind: 'host', text: 'First', start: 0 }])
  expect(claudeNativeMessageParts('app', 'Changed', [first])).toEqual([{ kind: 'host', text: 'Changed', start: 0 }])
  expect(claudeNativeMessageParts('app', 'First', [first, first])).toHaveLength(1)
})
it('draws the original normalized text while a row render is pending or unavailable', () => {
  const value = frame('a', 0, 'Stored original'); value.displayText = 'Native normalized original'; value.body = { status: 'error' }
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeAssistantMessage, { frame: value }) }); app.mount(root)
  expect(root.querySelector('[data-engine-text]')?.textContent).toBe('Native normalized original')
  expect(root.querySelector('[role="status"]')?.textContent).toBe('Claude message controls unavailable')
})
