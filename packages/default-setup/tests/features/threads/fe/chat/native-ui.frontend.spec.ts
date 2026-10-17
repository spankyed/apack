import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { createApp, h, reactive, nextTick, type App } from 'vue'
import { claudeUiColor, claudeUiBoxPaint } from '#features/threads/fe/chat/native-ui-paint.ts'
import { prepareClaudeSvg } from '#features/threads/fe/chat/native-svg.ts'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#generated/types.ts'

beforeEach(() => { startFeTestRuntime() })
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime() })
function mount(props: { statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState; nativeFocus?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusReply }) {
  const state = reactive(props)
  const cwd = vi.fn(), press = vi.fn(), field = vi.fn(), returnFocus = vi.fn(), submit = vi.fn(), phase = vi.fn(), focusReport = vi.fn()
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('form', { onKeydown: (event: KeyboardEvent) => { if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); phase() } }, onSubmit: (event: Event) => { event.preventDefault(); submit() } }, [
    h(StatusLine, { ...state, onClick: cwd, onPress: press, onField: field, onReturnFocus: returnFocus, onFocusReport: focusReport }), h('textarea', { 'aria-label': 'Message' }),
  ]) }); app.mount(root)
  return { state, root, cwd, press, field, returnFocus, submit, phase, focusReport }
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


it('keeps static SVG in an image and interactive SVG in an opaque scriptless frame', async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" onload="bad()"><script>bad()</script><style>rect:hover{fill:red}</style><rect width="20" height="20"><title>Hover</title><animate attributeName="opacity" values="0;1" dur="1s"/></rect><a href="https://example.com/">external</a></svg>'
  const node = { kind: 'svg' as const, source, alt: 'Native drawing', width: 100, interactive: false }
  const f = mount({ nativeUi: { status: 'live', tree: node } })
  const image = f.root.querySelector('img')!
  expect(image.alt).toBe('Native drawing')
  const decoded = decodeURIComponent(image.src.split(',')[1]!)
  expect(decoded).not.toContain('<script'); expect(decoded).not.toContain('onload'); expect(decoded).not.toContain('https://example.com/')
  expect(f.root.querySelector('svg')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { ...node, interactive: true } }; await nextTick()
  const frame = f.root.querySelector('iframe')!
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.title).toBe('Native drawing')
  expect(frame.srcdoc).toContain("script-src 'none'")
  expect(frame.srcdoc).toContain('<animate'); expect(frame.srcdoc).toContain('rect:hover')
  expect(frame.srcdoc).not.toContain('<script'); expect(frame.srcdoc).not.toContain('onload')
  expect(f.root.querySelector('svg')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { ...node, source: '<not-svg/>' } }; await nextTick()
  expect(f.root.querySelector('img,iframe')).toBeNull(); expect(f.root.textContent).toContain('Native drawing')
})


it('normalizes an SVG without xmlns and preserves its internal references', () => {
  const drawing = prepareClaudeSvg('<svg viewBox="0 0 10 5"><defs><path id="shape" d="M0 0h5v5z"/></defs><use href="#shape"/></svg>')!
  const parsed = new DOMParser().parseFromString(drawing.source, 'image/svg+xml')
  expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(parsed.querySelector('use')?.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(parsed.querySelector('use')?.getAttribute('href')).toBe('#shape')
  expect(drawing.ratio).toBe(2)
})


it('renders inline Button content as one named action and focuses only on site entry', async () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'button', label: 'Save changes', actionId: 'save', variant: 'primary', dimColor: true, autoFocus: true,
    children: [{ kind: 'text', text: 'Save ' }, { kind: 'text', text: 'changes', style: { bold: true } }] } } })
  const editor = f.root.querySelector('textarea')!; editor.focus(); await nextTick()
  expect(document.activeElement).toBe(editor)
  const button = f.root.querySelector('button')!
  expect(button.getAttribute('aria-label')).toBe('Save changes')
  expect(button.querySelector('.font-semibold')?.textContent).toBe('changes')
  expect(button.classList.contains('bg-white/[0.10]')).toBe(true)
  expect(button.classList.contains('opacity-60')).toBe(true)
  f.root.querySelector<HTMLElement>('[tabindex="0"]')!.focus()
  expect(document.activeElement).toBe(button)
  button.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(f.press).toHaveBeenCalledExactlyOnceWith('save', undefined)
  expect(f.submit).not.toHaveBeenCalled()
  f.state.nativeUi = { status: 'live', tree: { kind: 'button', label: 'Dismiss controls', role: 'dismiss', actionId: 'close' } }; await nextTick()
  const dismiss = f.root.querySelector('button')!
  expect(dismiss.getAttribute('aria-label')).toBe('Dismiss controls')
  expect(dismiss.textContent?.trim()).toBe('×')
  dismiss.click(); expect(f.press).toHaveBeenLastCalledWith('close', undefined)
})


it('paints native Box and nested Text without applying border dimming to descendants', () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', paint: { borderStyle: 'round', borderColor: 'warning', borderDimColor: true, backgroundColor: 'navy' }, children: [
    { kind: 'text', text: 'Outer', style: { color: 'success', backgroundColor: 'rgb(1, 2, 3)' }, children: [{ kind: 'text', text: ' inner', style: { color: 'rebeccapurple' } }] },
  ] } } })
  const box = f.root.querySelector<HTMLElement>('.native-box')!
  expect(box.style.backgroundColor).toBe('navy')
  expect(box.style.borderStyle).toBe('solid')
  expect(box.style.borderRadius).toBe('0.375rem')
  expect(box.getAttribute('data-native-border-dim')).toBe('true')
  expect(box.style.opacity).toBe('')
  expect(box.style.getPropertyValue('--native-border-color')).toBe('#facc15')
  const outer = box.querySelector<HTMLElement>('span')!
  expect(outer.style.color).toBe('rgb(74, 222, 128)')
  expect(outer.style.backgroundColor).toBe('rgb(1, 2, 3)')
  expect(outer.querySelector<HTMLElement>('span')!.style.color).toBe('rebeccapurple')
})

it('accepts browser colors while refusing strings that try to introduce CSS rules or resources', () => {
  expect(claudeUiColor('rebeccapurple')).toBe('rebeccapurple')
  expect(claudeUiColor('rgb(12, 34, 56)')).toBe('rgb(12, 34, 56)')
  for (const value of ['red;position:fixed', 'url(https://example.com/a)', '<style>body{display:none}</style>', '__proto__']) expect(claudeUiColor(value)).toBeUndefined()
  expect(claudeUiBoxPaint({ borderStyle: 'doubleSingle' })).toMatchObject({ borderTopStyle: 'double', borderLeftStyle: 'solid' })
  expect(claudeUiBoxPaint({ borderStyle: 'singleDouble' })).toMatchObject({ borderTopStyle: 'solid', borderLeftStyle: 'double' })
  expect(claudeUiBoxPaint({ borderStyle: 'quote' })).toMatchObject({ borderWidth: '0', borderLeftWidth: '2px' })
  expect(claudeUiBoxPaint({ borderStyle: 'url(https://example.com)' }).borderStyle).toBeUndefined()
})


it('applies plugin-scoped groups and keyed Box reveals locally without pressing or stealing focus', async () => {
  const group = JSON.stringify(['fixture', 'shared']), foreign = JSON.stringify(['other', 'shared'])
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', boxKey: 'outer', children: [
    { kind: 'text', text: 'Trigger', hover: { group, text: { color: 'red' } } },
    { kind: 'text', text: 'Peer', hover: { group, text: { color: 'red' } } },
    { kind: 'text', text: 'Foreign', hover: { group: foreign, text: { color: 'red' } } },
    { kind: 'text', text: 'Local', hover: { text: { bold: true } } },
    { kind: 'box', layout: { display: 'none' }, hover: { layout: { display: 'flex' } }, children: [{ kind: 'text', text: 'Revealed' }] },
    { kind: 'box', boxKey: 'inner', children: [{ kind: 'text', text: 'Nested', hover: { text: { italic: true } } }] },
  ] } } })
  const spans = () => [...f.root.querySelectorAll<HTMLElement>('span')]
  const find = (text: string) => spans().find(span => span.textContent === text)!
  const editor = f.root.querySelector('textarea')!; editor.focus()
  expect(find('Revealed').parentElement!.style.display).toBe('none')
  find('Trigger').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  await nextTick()
  expect(find('Trigger').style.color).toBe('red')
  expect(find('Peer').style.color).toBe('red')
  expect(find('Foreign').style.color).toBe('')
  expect(find('Local').style.fontWeight).toBe('600')
  expect(find('Revealed').parentElement!.style.display).toBe('flex')
  expect(find('Nested').classList.contains('italic')).toBe(false)
  expect(document.activeElement).toBe(editor)
  expect(f.press).not.toHaveBeenCalled()
  find('Trigger').dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: find('Nested') }))
  find('Nested').dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
  await nextTick()
  expect(find('Peer').style.color).toBe('')
  expect(find('Nested').classList.contains('italic')).toBe(true)
  f.root.querySelector<HTMLElement>('[tabindex="0"]')!.dispatchEvent(new MouseEvent('pointerleave', { relatedTarget: editor }))
  await nextTick()
  expect(find('Revealed').parentElement!.style.display).toBe('none')
  expect(find('Nested').classList.contains('italic')).toBe(false)
  f.state.nativeUi = { status: 'error', message: 'fixture detached' }; await nextTick()
  expect(f.root.querySelectorAll('.native-box')).toHaveLength(0)
})

it('limits duplicate sibling Box keys to the first scope and restores nested inverse colors', async () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
    { kind: 'box', boxKey: 'same', children: [{ kind: 'text', text: 'First', hover: { text: { color: 'red' } } }] },
    { kind: 'box', boxKey: 'same', children: [{ kind: 'text', text: 'Duplicate', hover: { text: { color: 'red' } } }] },
    { kind: 'text', text: 'Inverse', style: { color: 'blue', backgroundColor: 'yellow', inverse: true }, children: [{ kind: 'text', text: 'Normal', style: { inverse: false } }] },
  ] } } })
  const first = [...f.root.querySelectorAll<HTMLElement>('span')].find(span => span.textContent === 'First')!
  const duplicate = [...f.root.querySelectorAll<HTMLElement>('span')].find(span => span.textContent === 'Duplicate')!
  first.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); await nextTick()
  expect(first.style.color).toBe('red')
  duplicate.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); await nextTick()
  expect(duplicate.style.color).toBe('')
  const normal = [...f.root.querySelectorAll<HTMLElement>('span')].find(span => span.textContent === 'Normal')!
  expect(normal.parentElement!.style.color).toBe('yellow')
  expect(normal.parentElement!.style.backgroundColor).toBe('blue')
  expect(normal.style.color).toBe('blue')
  expect(normal.style.backgroundColor).toBe('yellow')
})


it('dispatches native hotkeys to the last visible Button while preserving fields and modified keys', () => {
  const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
    { kind: 'button', label: 'First', hotkey: 'w', actionId: 'first' },
    { kind: 'button', label: 'Last', hotkey: 'w', actionId: 'last' },
    { kind: 'box', layout: { display: 'none' }, children: [{ kind: 'button', label: 'Hidden', hotkey: 'w', actionId: 'hidden' }] },
    { kind: 'button', label: 'Disabled', hotkey: 'w' },
    { kind: 'input', actionId: 'field', revision: 0, label: 'Native edit', value: '', rows: 1, submitLabel: 'send', autoFocus: false },
    { kind: 'select', actionId: 'choice', revision: 0, label: 'Native choice', value: 'a', options: [{ value: 'a', label: 'A' }], autoFocus: false },
  ] } } })
  const site = f.root.querySelector<HTMLElement>('[tabindex="0"]')!; site.focus()
  const key = new KeyboardEvent('keydown', { key: 'W', shiftKey: true, bubbles: true, cancelable: true }); site.dispatchEvent(key)
  expect(key.defaultPrevented).toBe(true)
  expect(f.press).toHaveBeenCalledExactlyOnceWith('last', undefined)
  expect(f.root.querySelector('button')!.getAttribute('aria-keyshortcuts')).toBe('w')
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    const event = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true, ...init }); site.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  }
  for (const field of [f.root.querySelector('textarea[aria-label="Native edit"]')!, f.root.querySelector('select')!]) {
    const event = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true }); field.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  }
  const editable = document.createElement('div'); editable.setAttribute('contenteditable', 'true'); site.append(editable)
  const typing = new KeyboardEvent('keydown', { key: 'w', bubbles: true, cancelable: true }); editable.dispatchEvent(typing)
  expect(typing.defaultPrevented).toBe(false)
  expect(f.press).toHaveBeenCalledTimes(1); expect(f.submit).not.toHaveBeenCalled()
})

it('preserves native Shift+Tab focus order and lets IME consume Escape before returning to the composer', () => {
  const f = mount({ statusLine: '/fixture', cwd: '/fixture', nativeUi: live })
  const site = f.root.querySelector<HTMLElement>('[tabindex="0"]')!
  const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); site.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false); expect(f.phase).not.toHaveBeenCalled()
  const contextTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); f.root.querySelector('button')!.dispatchEvent(contextTab)
  expect(contextTab.defaultPrevented).toBe(false); expect(f.phase).not.toHaveBeenCalled()
  const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }); site.dispatchEvent(composing)
  expect(composing.defaultPrevented).toBe(false); expect(f.returnFocus).not.toHaveBeenCalled()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); site.dispatchEvent(escape)
  expect(escape.defaultPrevented).toBe(true); expect(f.returnFocus).toHaveBeenCalledOnce()
})


it('reports native focus ownership and applies current redirects without echo or stealing composer focus', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
      { kind: 'button', label: 'Start', actionId: 'press', focusId: 'first' },
      { kind: 'input', label: 'Destination', actionId: 'input', focusId: 'second', revision: 0, value: '', rows: 1, autoFocus: false, submitLabel: 'send' },
    ] } } })
    const button = f.root.querySelector<HTMLButtonElement>('[data-native-focus-id="first"]')!, field = f.root.querySelector<HTMLTextAreaElement>('[data-native-focus-id="second"]')!
    button.focus()
    expect(f.focusReport).toHaveBeenLastCalledWith({ revision: 1, isHeld: true, focusId: 'first', by: 'person' })
    f.state.nativeFocus = { revision: 1, moved: true, focusId: 'second' }; await nextTick()
    expect(document.activeElement).toBe(field); expect(f.focusReport).toHaveBeenCalledTimes(1)
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    f.state.nativeFocus = { revision: 1, moved: true, focusId: 'first' }; await nextTick(); expect(document.activeElement).toBe(field)
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    button.focus(); expect(f.focusReport).toHaveBeenLastCalledWith({ revision: 2, isHeld: true, focusId: 'first', by: 'person' })
    f.state.nativeFocus = { revision: 1, moved: true, focusId: 'second' }; await nextTick(); expect(document.activeElement).toBe(button)
    f.state.nativeFocus = { revision: 2, moved: true, focusId: 'foreign' }; await nextTick(); expect(document.activeElement).toBe(button)
    const composer = f.root.querySelector<HTMLTextAreaElement>('[aria-label="Message"]')!; composer.focus()
    expect(f.focusReport).toHaveBeenLastCalledWith({ revision: 3, isHeld: false, by: 'person' })
    f.state.nativeFocus = { revision: 3, moved: true, focusId: 'second' }; await nextTick(); expect(document.activeElement).toBe(composer)
  } finally { windowFocus.mockRestore() }
})

it('attributes site-entry autofocus to the plugin and never re-runs it for a native container redirect', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = mount({ nativeUi: { status: 'live', tree: { kind: 'button', label: 'Auto', actionId: 'press', focusId: 'auto', autoFocus: true } } })
    const site = f.root.querySelector<HTMLElement>('[tabindex="0"]')!; site.focus()
    expect(f.focusReport).toHaveBeenCalledExactlyOnceWith({ revision: 1, isHeld: true, focusId: 'auto', by: 'auto' })
    f.state.nativeFocus = { revision: 1, moved: true, focusId: null }; await nextTick()
    expect(document.activeElement).toBe(site); expect(f.focusReport).toHaveBeenCalledTimes(1)
  } finally { windowFocus.mockRestore() }
})


it('reveals a native focus redirect inside its own scroll site without scrolling the conversation', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
      { kind: 'button', label: 'Start', actionId: 'press', focusId: 'first' },
      { kind: 'input', label: 'Below viewport', actionId: 'input', focusId: 'second', revision: 0, value: '', rows: 1, autoFocus: false, submitLabel: 'send' },
    ] } } })
    const site = f.root.querySelector<HTMLElement>('.native-extension-surface')!, field = f.root.querySelector<HTMLTextAreaElement>('[data-native-focus-id="second"]')!
    vi.spyOn(site, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 50))
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 180, 100, 30))
    const outsideScroll = document.documentElement.scrollTop
    f.root.querySelector<HTMLButtonElement>('[data-native-focus-id="first"]')!.focus()
    f.state.nativeFocus = { revision: 1, moved: true, focusId: 'second' }; await nextTick()
    expect(document.activeElement).toBe(field); expect(site.scrollTop).toBe(60)
    expect(document.documentElement.scrollTop).toBe(outsideScroll)
  } finally { windowFocus.mockRestore() }
})
