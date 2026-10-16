import { createApp, h, reactive, nextTick, type App } from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#generated/types.ts'

let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren() })
function mount(props: { statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState }) {
  const state = reactive(props)
  const cwd = vi.fn(), press = vi.fn(), submit = vi.fn()
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('form', { onSubmit: (event: Event) => { event.preventDefault(); submit() } }, [
    h(StatusLine, { ...state, onClick: cwd, onPress: press }), h('textarea', { 'aria-label': 'Message' }),
  ]) }); app.mount(root)
  return { state, root, cwd, press, submit }
}
const live: ClaudeUiMountState = { status: 'live', tree: { kind: 'box', plugin: 'fixture', children: [
  { kind: 'text', text: 'First line\nSecond line <script>bad()</script>' },
  { kind: 'button', label: 'Run fixture', actionId: 'opaque-action' },
  { kind: 'unsupported', component: 'engine' },
] } }

it('renders the strip inside the form, preserves CWD navigation and emits presses without submitting', () => {
  const f = mount({ statusLine: '…/fixture', cwd: '/private/fixture', nativeUi: live })
  const strip = f.root.querySelector('[data-testid="composer-session-strip"]')!
  expect(strip.parentElement?.tagName).toBe('FORM')
  const buttons = strip.querySelectorAll('button')
  expect(buttons).toHaveLength(2)
  expect(buttons[0]!.title).toBe('/private/fixture')
  buttons[0]!.click(); buttons[1]!.click()
  expect(f.cwd).toHaveBeenCalledOnce()
  expect(f.press).toHaveBeenCalledWith('opaque-action')
  expect(f.submit).not.toHaveBeenCalled()
  expect(strip.textContent).toContain('First line\nSecond line <script>bad()</script>')
  expect(strip.querySelector('script')).toBeNull()
  expect(strip.textContent).not.toContain('AbovePrompt')
  expect(strip.textContent).not.toContain('engine')
})

it('hides empty and base-engine-only surfaces, and leaves the CWD-only state compact', async () => {
  const f = mount({})
  expect(f.root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { kind: 'box', children: [{ kind: 'unsupported', component: 'engine' }, { kind: 'text', text: '' }] } }
  await nextTick()
  expect(f.root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
  f.state.statusLine = '/fixture'; await nextTick()
  expect(f.root.querySelectorAll('button')).toHaveLength(1)
  expect(f.root.textContent).toBe('/fixture')
})

it('retires visible buttons on redraw, disconnect and error while preserving typed input', async () => {
  const f = mount({ statusLine: '/fixture', nativeUi: live })
  const editor = f.root.querySelector('textarea')!; editor.value = 'Unsent input'; editor.focus()
  for (const state of [{ status: 'rendering' }, { status: 'disconnected' }, { status: 'error', message: 'fixture failure' }] as ClaudeUiMountState[]) {
    f.state.nativeUi = state; await nextTick()
    expect(f.root.querySelectorAll('button')).toHaveLength(1)
    expect(editor.value).toBe('Unsent input')
    expect(document.activeElement).toBe(editor)
  }
  expect(f.root.textContent).toContain('Claude controls unavailable')
  expect(f.press).not.toHaveBeenCalled()
})

it('renders unknown components inert and disables buttons without authority', () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
    { kind: 'unsupported', component: 'Client' }, { kind: 'button', label: 'Unavailable' },
  ] } } })
  expect(f.root.textContent).toContain('Unsupported Claude component: Client')
  const button = f.root.querySelector('button')!
  expect(button.disabled).toBe(true)
  button.click(); expect(f.press).not.toHaveBeenCalled()
})
