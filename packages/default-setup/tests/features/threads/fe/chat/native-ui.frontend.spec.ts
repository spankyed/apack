import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { createApp, h, reactive, nextTick, type App } from 'vue'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#generated/types.ts'

beforeEach(() => { startFeTestRuntime() })
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime() })
function mount(props: { statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState }) {
  const state = reactive(props)
  const cwd = vi.fn(), press = vi.fn(), field = vi.fn(), returnFocus = vi.fn(), submit = vi.fn()
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('form', { onSubmit: (event: Event) => { event.preventDefault(); submit() } }, [
    h(StatusLine, { ...state, onClick: cwd, onPress: press, onField: field, onReturnFocus: returnFocus }), h('textarea', { 'aria-label': 'Message' }),
  ]) }); app.mount(root)
  return { state, root, cwd, press, field, returnFocus, submit }
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
  expect(f.press).toHaveBeenCalledWith('opaque-action', undefined)
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


it('keeps field typing across native echoes and submits the field without submitting chat', async () => {
  const input = { kind: 'input' as const, revision: 0, submitLabel: 'send', actionId: 'field-authority', label: 'Native draft', value: '', rows: 3, autoFocus: false }
  const f = mount({ nativeUi: { status: 'live', tree: input } })
  const field = f.root.querySelector('textarea[aria-label="Native draft"]')!
  ;(field as HTMLTextAreaElement).value = 'first\nsecond'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  expect(f.field).toHaveBeenLastCalledWith({ actionId: 'field-authority', revision: 1, kind: 'change', value: 'first\nsecond' })
  f.state.nativeUi = { status: 'live', tree: { ...input, value: 'stale echo' } }; await nextTick()
  expect((field as HTMLTextAreaElement).value).toBe('first\nsecond')
  const newline = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
  field.dispatchEvent(newline); expect(newline.defaultPrevented).toBe(false)
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(f.field).toHaveBeenLastCalledWith({ actionId: 'field-authority', revision: 2, kind: 'submit', value: 'first\nsecond' })
  expect(f.submit).not.toHaveBeenCalled()
})

it('uses native select values and leaves the message composer untouched', () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'select', revision: 0, actionId: 'select-authority', label: 'Mode', value: 'a',
    autoFocus: false, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] } } })
  const select = f.root.querySelector('select')!
  select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true }))
  expect(f.field).toHaveBeenCalledWith({ actionId: 'select-authority', revision: 1, kind: 'select', value: 'b' })
  expect(f.submit).not.toHaveBeenCalled()
})


it('renders native Markdown through the existing viewer and sends owned link clicks to Claude', async () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'markdown', text: '**Native heading**\n\n[Open](https://example.com/)\n\n<script>bad()</script>', dim: false, actionId: 'markdown-action' } } })
  await vi.waitFor(() => expect(f.root.querySelector('strong')).not.toBeNull())
  expect(f.root.querySelector('strong')?.textContent).toBe('Native heading')
  expect(f.root.querySelector('script')).toBeNull()
  const link = f.root.querySelector('a[href="https://example.com/"]')!
  expect(link).not.toBeNull()
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  expect(f.press).toHaveBeenCalledWith('markdown-action', 'https://example.com/')
  f.press.mockClear()
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))
  expect(f.press).not.toHaveBeenCalled()
  expect(f.submit).not.toHaveBeenCalled()
})

it('keeps embedded fences and markup literal inside native code with its gutter', async () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'code', source: '```\n<script>bad()</script>', language: 'html', path: 'fixture.html', startLine: 9, format: 'source', wrap: 'wrap' } } })
  await vi.waitFor(() => expect(f.root.querySelector('code')).not.toBeNull())
  const code = f.root.querySelector('code')!
  expect(code).not.toBeNull()
  expect(code.textContent).toContain('```\n<script>bad()</script>')
  expect(f.root.querySelector('script')).toBeNull()
  expect(f.root.textContent).toContain('fixture.html')
  expect(f.root.querySelector('pre[aria-hidden="true"]')?.textContent).toBe('9\n10')
})


it('does not let native autofocus steal typing when an idle drawing appears', async () => {
  const f = mount({})
  const message = f.root.querySelector('textarea[aria-label="Message"]')! as HTMLTextAreaElement
  message.value = 'Unsent draft'; message.focus()
  f.state.nativeUi = { status: 'live', tree: { kind: 'input', revision: 0, submitLabel: 'submit', actionId: 'field', label: 'Native focus', value: '', rows: 1, autoFocus: true } }
  await nextTick()
  expect(document.activeElement).toBe(message)
  const site = f.root.querySelector('[tabindex="0"]')! as HTMLElement
  site.focus()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Native focus')
  expect(message.value).toBe('Unsent draft')
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(f.returnFocus).toHaveBeenCalledOnce()
  expect(f.submit).not.toHaveBeenCalled()
})


it('applies native field replacements only after the latest local callback and shows its submit label', async () => {
  const input = { kind: 'input' as const, actionId: 'field', revision: 0, submitLabel: 'send', label: 'Rewritable', value: '', rows: 2, autoFocus: false }
  const f = mount({ nativeUi: { status: 'live', tree: input } })
  const field = f.root.querySelector('textarea[aria-label="Rewritable"]')! as HTMLTextAreaElement
  field.focus(); await nextTick(); expect(f.root.textContent).toContain('Enter: send')
  field.value = 'first'; field.dispatchEvent(new Event('input', { bubbles: true }))
  field.value = 'second'; field.dispatchEvent(new Event('input', { bubbles: true }))
  f.state.nativeUi = { status: 'live', tree: { ...input, value: 'native first', revision: 1 } }; await nextTick()
  expect(field.value).toBe('second')
  f.state.nativeUi = { status: 'live', tree: { ...input, value: 'native second', revision: 2 } }; await nextTick()
  expect(field.value).toBe('native second')
  expect(f.field).toHaveBeenLastCalledWith({ actionId: 'field', revision: 2, kind: 'change', value: 'second' })
})


it('renders nested text and links inline without hiding a text-only nested surface', () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'text', text: '', style: { dir: 'rtl', weight: 'regular', bold: true }, children: [
    { kind: 'text', text: 'Hello ', style: { italic: true, mono: true } },
    { kind: 'link', href: 'https://example.com/', children: [{ kind: 'text', text: 'world', style: { underline: true } }] },
    { kind: 'link', children: [{ kind: 'text', text: '<script>bad()</script>' }] },
  ] } } })
  const strip = f.root.querySelector('[data-testid="composer-session-strip"]')!
  expect(strip).not.toBeNull()
  expect(strip.textContent).toContain('Hello world<script>bad()</script>')
  expect(strip.querySelector('script')).toBeNull()
  expect(strip.querySelectorAll('a')).toHaveLength(1)
  expect(strip.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
  expect(strip.querySelector('[dir="rtl"]')?.classList.contains('font-normal')).toBe(true)
  expect(strip.querySelector('[dir="rtl"]')?.classList.contains('font-semibold')).toBe(false)
  expect(strip.querySelector('.italic.font-mono')?.textContent).toBe('Hello ')
  expect(f.press).not.toHaveBeenCalled()
  expect(f.submit).not.toHaveBeenCalled()
})


it('applies native Box direction, spacing, dimensions and hidden state without submitting chat', async () => {
  const box = { kind: 'box' as const, layout: { flexDirection: 'row' as const, gap: 'sm' as const, paddingX: 2, width: '100%', alignItems: 'center' as const }, children: [{ kind: 'button' as const, label: 'First' }, { kind: 'text' as const, text: 'Second' }] }
  const f = mount({ nativeUi: { status: 'live', tree: box } })
  const element = f.root.querySelector('.native-box')! as HTMLElement
  expect(element.style.flexDirection).toBe('row')
  expect(element.style.gap).toBe('0.5rem')
  expect(element.style.paddingLeft).toBe('2ch')
  expect(element.style.paddingRight).toBe('2ch')
  expect(element.style.width).toBe('100%')
  expect(element.style.alignItems).toBe('center')
  f.state.nativeUi = { status: 'live', tree: { ...box, layout: { display: 'none' } } }; await nextTick()
  expect(element.style.display).toBe('none')
  expect(f.submit).not.toHaveBeenCalled()
})
