import { onTestFinished } from 'vitest'
import { startFeTestRuntime, stopFeTestRuntime } from '@apackdev/sdk/testing'
import { createApp, h, reactive, nextTick, type App } from 'vue'
import { claudeUiColor, claudeUiBoxPaint } from '#features/threads/fe/chat/native-ui-paint.ts'
import { prepareClaudeSvg } from '#features/threads/fe/chat/native-svg.ts'
import StatusLine from '#features/threads/fe/chat/StatusLine.vue'
import type { ClaudeUiMountState } from '#generated/types.ts'

let resizeObservers: (() => void)[]
let observedElements: Element[]
beforeEach(() => {
  resizeObservers = []
  observedElements = []
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resizeObservers.push(callback) } observe(element: Element) { observedElements.push(element) } disconnect() {} })
  startFeTestRuntime()
})
let app: App | undefined
afterEach(() => { app?.unmount(); document.body.replaceChildren(); stopFeTestRuntime(); vi.unstubAllGlobals() })
async function mount(props: { statusLine?: string; cwd?: string; nativeUi?: ClaudeUiMountState; nativeFocus?: import('#features/code/be/services/claude-code/ui-presentation.ts').ClaudeUiFocusReply }, expand = true) {
  const state = reactive(props)
  const cwd = vi.fn(), press = vi.fn(), field = vi.fn(), returnFocus = vi.fn(), submit = vi.fn(), phase = vi.fn(), focusReport = vi.fn(), toolsExpanded = vi.fn()
  const root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h('form', { 'data-onboarding-id': 'agent-chat-input', onKeydown: (event: KeyboardEvent) => { if (event.key === 'Tab' && event.shiftKey) { event.preventDefault(); phase() } }, onSubmit: (event: Event) => { event.preventDefault(); submit() } }, [
    h(StatusLine, { ...state, onClick: cwd, onPress: press, onField: field, onReturnFocus: returnFocus, onFocusReport: focusReport, onToolsExpanded: toolsExpanded }), h('textarea', { 'aria-label': 'Message' }),
  ]) }); app.mount(root)
  if (expand) { root.querySelector<HTMLButtonElement>('button[aria-label="Session tools"]')?.click(); await nextTick() }
  return { state, root, cwd, press, field, returnFocus, submit, phase, focusReport, toolsExpanded }
}
const live: ClaudeUiMountState = { status: 'live', tree: { kind: 'box', plugin: 'fixture', children: [
  { kind: 'text', text: 'First line\nSecond line <script>bad()</script>' },
  { kind: 'button', label: 'Run fixture', actionId: 'opaque-action' },
  { kind: 'unsupported', component: 'engine' },
] } }

it('renders the strip inside the form, preserves CWD navigation and emits presses without submitting', async () => {
  const f = await mount({ statusLine: '…/fixture', cwd: '/private/fixture', nativeUi: live })
  const strip = f.root.querySelector('[data-testid="composer-session-strip"]')!
  expect(strip.parentElement?.tagName).toBe('FORM')
  const buttons = strip.querySelectorAll<HTMLButtonElement>('button:not([aria-label="Session tools"])')
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
  const f = await mount({})
  expect(f.root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { kind: 'box', children: [{ kind: 'unsupported', component: 'engine' }, { kind: 'text', text: '' }] } }
  await nextTick()
  expect(f.root.querySelector('[data-testid="composer-session-strip"]')).toBeNull()
  f.state.statusLine = '/fixture'; await nextTick()
  expect(f.root.querySelectorAll<HTMLButtonElement>('button:not([aria-label="Session tools"])')).toHaveLength(1)
  expect(f.root.querySelector('button')?.textContent).toBe('/fixture')
})

it('retires visible buttons on redraw, disconnect and error while preserving typed input', async () => {
  const f = await mount({ statusLine: '/fixture', nativeUi: live })
  const editor = f.root.querySelector('textarea')!; editor.value = 'Unsent input'; editor.focus()
  for (const state of [{ status: 'rendering' }, { status: 'disconnected' }, { status: 'error', message: 'fixture failure' }] as ClaudeUiMountState[]) {
    f.state.nativeUi = state; await nextTick()
    expect(f.root.querySelectorAll<HTMLButtonElement>('button:not([aria-label="Session tools"])')).toHaveLength(1)
    expect(editor.value).toBe('Unsent input')
    expect(document.activeElement).toBe(editor)
  }
  expect(f.root.textContent).toContain('Claude controls unavailable')
  expect(f.press).not.toHaveBeenCalled()
})

it('renders unknown components inert and disables buttons without authority', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
    { kind: 'unsupported', component: 'Client' }, { kind: 'button', label: 'Unavailable' },
  ] } } })
  expect(f.root.textContent).toContain('Unsupported Claude component: Client')
  const button = f.root.querySelector<HTMLButtonElement>('button:not([aria-label="Session tools"])')!
  expect(button.disabled).toBe(true)
  button.click(); expect(f.press).not.toHaveBeenCalled()
})


it('keeps field typing across native echoes and submits the field without submitting chat', async () => {
  const input = { kind: 'input' as const, revision: 0, submitLabel: 'send', actionId: 'field-authority', label: 'Native draft', value: '', rows: 3, autoFocus: false }
  const f = await mount({ nativeUi: { status: 'live', tree: input } })
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

it('uses native select values and leaves the message composer untouched', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'select', revision: 0, actionId: 'select-authority', label: 'Mode', value: 'a',
    autoFocus: false, options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] } } })
  const select = f.root.querySelector('select')!
  select.value = 'b'; select.dispatchEvent(new Event('change', { bubbles: true }))
  expect(f.field).toHaveBeenCalledWith({ actionId: 'select-authority', revision: 1, kind: 'select', value: 'b' })
  expect(f.submit).not.toHaveBeenCalled()
})


it('renders native Markdown through the existing viewer and sends owned link clicks to Claude', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'markdown', text: '**Native heading**\n\n[Open](https://example.com/)\n\n<script>bad()</script>', dim: false, actionId: 'markdown-action' } } })
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
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'code', source: '```\n<script>bad()</script>', language: 'html', path: 'fixture.html', startLine: 9, format: 'source', wrap: 'wrap' } } })
  await vi.waitFor(() => expect(f.root.querySelector('code')).not.toBeNull())
  const code = f.root.querySelector('code')!
  expect(code).not.toBeNull()
  expect([...f.root.querySelectorAll('code')].map(line => line.textContent).join('\n')).toBe('```\n<script>bad()</script>')
  expect(f.root.querySelector('script')).toBeNull()
  expect(f.root.textContent).not.toContain('fixture.html')
  expect([...f.root.querySelectorAll('.native-source-row [aria-hidden="true"]')].map(line => line.textContent)).toEqual(['9', '10'])
})


it('does not let native autofocus steal typing when an idle drawing appears', async () => {
  const f = await mount({})
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
  const f = await mount({ nativeUi: { status: 'live', tree: input } })
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


it('renders nested text and links inline without hiding a text-only nested surface', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'text', text: '', style: { dir: 'rtl', weight: 'regular', bold: true }, children: [
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
  const f = await mount({ nativeUi: { status: 'live', tree: box } })
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
  const f = await mount({ nativeUi: { status: 'live', tree: node } })
  const image = f.root.querySelector('img')!
  expect(image.alt).toBe('Native drawing')
  const decoded = decodeURIComponent(image.src.split(',')[1]!)
  expect(decoded).not.toContain('<script'); expect(decoded).not.toContain('onload'); expect(decoded).not.toContain('https://example.com/')
  expect(f.root.querySelector('.native-extension-surface svg')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { ...node, interactive: true } }; await nextTick()
  const frame = f.root.querySelector('iframe')!
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.title).toBe('Native drawing')
  const sizingImage = frame.parentElement!.querySelector('img')!
  expect(sizingImage.getAttribute('aria-hidden')).toBe('true')
  expect(sizingImage.alt).toBe('')
  expect(sizingImage.style.width).toBe('100px')
  expect(sizingImage.style.aspectRatio).toBe('2')
  expect(frame.style.width).toBe('')
  expect(frame.srcdoc).toContain('width: 100% !important')
  expect(frame.srcdoc).toContain('height: 100% !important')
  expect(frame.srcdoc).toContain("script-src 'none'")
  expect(frame.srcdoc).toContain('<animate'); expect(frame.srcdoc).toContain('rect:hover')
  expect(frame.srcdoc).not.toContain('<script'); expect(frame.srcdoc).not.toContain('onload')
  expect(f.root.querySelector('.native-extension-surface svg')).toBeNull()
  f.state.nativeUi = { status: 'live', tree: { ...node, source: '<not-svg/>' } }; await nextTick()
  expect(f.root.querySelector('img,iframe')).toBeNull(); expect(f.root.textContent).toContain('Native drawing')
})


it('normalizes an SVG without xmlns and preserves its internal references', async () => {
  const drawing = prepareClaudeSvg('<svg viewBox="0 0 10 5"><defs><path id="shape" d="M0 0h5v5z"/></defs><use href="#shape"/></svg>')!
  const parsed = new DOMParser().parseFromString(drawing.source, 'image/svg+xml')
  expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(parsed.querySelector('use')?.namespaceURI).toBe('http://www.w3.org/2000/svg')
  expect(parsed.querySelector('use')?.getAttribute('href')).toBe('#shape')
  expect(drawing.ratio).toBe(2)
})


it('preserves intrinsic SVG dimensions while fitting only the scriptless frame copy', () => {
  const drawing = prepareClaudeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="48" viewBox="0 0 180 48" style="width:180px!important;height:48px!important"><rect width="180" height="48"/></svg>')!
  const intrinsic = new DOMParser().parseFromString(drawing.source, 'image/svg+xml').querySelector('svg')!
  const framed = new DOMParser().parseFromString(drawing.frameSource, 'image/svg+xml').querySelector('svg')!
  expect(intrinsic.getAttribute('width')).toBe('180')
  expect(intrinsic.getAttribute('height')).toBe('48')
  expect(intrinsic.style.width).toBe('180px')
  expect(framed.style.width).toBe('100%')
  expect(framed.style.height).toBe('100%')
  expect(framed.style.getPropertyPriority('width')).toBe('important')
  expect(drawing.ratio).toBe(3.75)
})


it('renders inline Button content as one named action and focuses only on site entry', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'button', label: 'Save changes', actionId: 'save', variant: 'primary', dimColor: true, autoFocus: true,
    children: [{ kind: 'text', text: 'Save ' }, { kind: 'text', text: 'changes', style: { bold: true } }] } } })
  const editor = f.root.querySelector('textarea')!; editor.focus(); await nextTick()
  expect(document.activeElement).toBe(editor)
  const button = f.root.querySelector<HTMLButtonElement>('button:not([aria-label="Session tools"])')!
  expect(button.getAttribute('aria-label')).toBe('Save changes')
  expect(button.querySelector('.font-semibold')?.textContent).toBe('changes')
  expect(button.classList.contains('bg-blue-400/[0.12]')).toBe(true)
  expect(button.classList.contains('opacity-60')).toBe(true)
  f.root.querySelector<HTMLElement>('[tabindex="0"]')!.focus()
  expect(document.activeElement).toBe(button)
  button.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(f.press).toHaveBeenCalledExactlyOnceWith('save', undefined)
  expect(f.submit).not.toHaveBeenCalled()
  f.state.nativeUi = { status: 'live', tree: { kind: 'button', label: 'Dismiss controls', role: 'dismiss', actionId: 'close' } }; await nextTick()
  const dismiss = f.root.querySelector<HTMLButtonElement>('button:not([aria-label="Session tools"])')!
  expect(dismiss.getAttribute('aria-label')).toBe('Dismiss controls')
  expect(dismiss.textContent?.trim()).toBe('×')
  dismiss.click(); expect(f.press).toHaveBeenLastCalledWith('close', undefined)
})


it('paints native Box and nested Text without applying border dimming to descendants', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', paint: { borderStyle: 'round', borderColor: 'warning', borderDimColor: true, backgroundColor: 'navy' }, children: [
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

it('accepts browser colors while refusing strings that try to introduce CSS rules or resources', async () => {
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
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', boxKey: 'outer', children: [
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
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
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


it('dispatches native hotkeys to the last visible Button while preserving fields and modified keys', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
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
  expect(f.root.querySelector<HTMLButtonElement>('button:not([aria-label="Session tools"])')!.getAttribute('aria-keyshortcuts')).toBe('w')
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

it('preserves native Shift+Tab focus order and lets IME consume Escape before returning to the composer', async () => {
  const f = await mount({ statusLine: '/fixture', cwd: '/fixture', nativeUi: live })
  const site = f.root.querySelector<HTMLElement>('[tabindex="0"]')!
  const tab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); site.dispatchEvent(tab)
  expect(tab.defaultPrevented).toBe(false); expect(f.phase).not.toHaveBeenCalled()
  const contextTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }); f.root.querySelector<HTMLButtonElement>('button:not([aria-label="Session tools"])')!.dispatchEvent(contextTab)
  expect(contextTab.defaultPrevented).toBe(false); expect(f.phase).not.toHaveBeenCalled()
  const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }); site.dispatchEvent(composing)
  expect(composing.defaultPrevented).toBe(false); expect(f.returnFocus).not.toHaveBeenCalled()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); site.dispatchEvent(escape)
  expect(escape.defaultPrevented).toBe(true); expect(f.returnFocus).toHaveBeenCalledOnce()
})


it('reports native focus ownership and applies current redirects without echo or stealing composer focus', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
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
    const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'button', label: 'Auto', actionId: 'press', focusId: 'auto', autoFocus: true } } })
    const site = f.root.querySelector<HTMLElement>('[tabindex="0"]')!; site.focus()
    expect(f.focusReport).toHaveBeenCalledExactlyOnceWith({ revision: 1, isHeld: true, focusId: 'auto', by: 'auto' })
    f.state.nativeFocus = { revision: 1, moved: true, focusId: null }; await nextTick()
    expect(document.activeElement).toBe(site); expect(f.focusReport).toHaveBeenCalledTimes(1)
  } finally { windowFocus.mockRestore() }
})


it('reveals the native field label with focus without scrolling the conversation', async () => {
  const windowFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  try {
    const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'box', children: [
      { kind: 'button', label: 'Start', actionId: 'press', focusId: 'first' },
      { kind: 'input', label: 'Below viewport', actionId: 'input', focusId: 'second', revision: 0, value: '', rows: 1, autoFocus: false, submitLabel: 'send' },
    ] } } })
    const site = f.root.querySelector<HTMLElement>('.native-extension-surface')!, field = f.root.querySelector<HTMLTextAreaElement>('[data-native-focus-id="second"]')!
    vi.spyOn(site, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 300, 50))
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 180, 100, 30))
    vi.spyOn(field.closest('label')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 150, 100, 70))
    f.root.querySelector<HTMLButtonElement>('[data-native-focus-id="first"]')!.focus()
    const outsideScroll = document.documentElement.scrollTop
    f.state.nativeFocus = { revision: 1, moved: true, focusId: 'second' }; await nextTick()
    expect(document.activeElement).toBe(field); expect(site.scrollTop).toBe(50)
    expect(document.documentElement.scrollTop).toBe(outsideScroll)
  } finally { windowFocus.mockRestore() }
})


it('renders native diff hunks with their own line numbers, markers and literal source', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'code', source: '--- a/secret.ts\n+++ b/secret.ts\n@@ -4,2 +8,2 @@\n keep\n-<script>old()</script>\n+<img onerror="bad()">\n', path: 'secret.ts', startLine: 900, format: 'diff', wrap: 'truncate-end' } } })
  const rows = f.root.querySelectorAll('[data-diff-kind]')
  expect(rows).toHaveLength(4)
  expect(rows[1].textContent).toContain('4')
  expect(rows[1].textContent).toContain('8')
  expect(rows[2].getAttribute('data-diff-kind')).toBe('remove')
  expect(rows[3].getAttribute('data-diff-kind')).toBe('add')
  expect(rows[3].querySelector('code')?.textContent).toBe('<img onerror="bad()">')
  expect(f.root.querySelector('img, script')).toBeNull()
  expect(f.root.textContent).not.toContain('secret.ts')
  expect(f.root.textContent).not.toContain('900')
})

it('falls back to literal unnumbered source for a truncated native diff', async () => {
  const source = '@@ -1,2 +1,2 @@\n-only one'
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'code', source, startLine: 900, format: 'diff', wrap: 'wrap' } } })
  await vi.waitFor(() => expect(f.root.querySelector('code')).not.toBeNull())
  expect([...f.root.querySelectorAll('code')].map(line => line.textContent).join('\n')).toBe(source)
  expect(f.root.querySelector('[data-diff-kind]')).toBeNull()
  expect(f.root.querySelector('pre[aria-hidden="true"]')).toBeNull()
})


it('keeps the native input submit hint mounted across blur so following actions do not move', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'input', actionId: 'field', revision: 0, value: '', rows: 1, autoFocus: false, submitLabel: 'Send', label: 'Draft' } } })
  const input = f.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Draft"]')!, hint = [...f.root.querySelectorAll('span')].find(item => item.textContent === 'Enter: Send')!
  expect(hint.getAttribute('aria-hidden')).toBe('true')
  input.focus(); await nextTick()
  expect(getComputedStyle(hint).visibility).toBe('visible')
  input.blur(); await nextTick()
  expect(hint.isConnected).toBe(true); expect(getComputedStyle(hint).visibility).toBe('hidden')
  expect(hint.getAttribute('aria-hidden')).toBe('true')
})


it('starts session tools collapsed and expands them without submitting or replacing the composer', async () => {
  const f = await mount({ statusLine: '/fixture', nativeUi: live }, false)
  const toggle = f.root.querySelector<HTMLButtonElement>('button[aria-label="Session tools"]')!
  const site = f.root.querySelector<HTMLElement>('.native-extension-surface')!
  const editor = f.root.querySelector('textarea')!; editor.value = 'Unsent draft'
  expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(site.style.display).toBe('none')
  toggle.click(); await nextTick()
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(site.style.display).not.toBe('none')
  toggle.click(); await nextTick()
  expect(site.style.display).toBe('none'); expect(editor.value).toBe('Unsent draft'); expect(f.submit).not.toHaveBeenCalled()
})

it('maps native ANSI theme color forms through the same bounded status palette',()=>{
 expect(claudeUiColor('ansi:blue')).toBe('#60a5fa')
 expect(claudeUiColor('ansi:whiteBright')).toBe('#fafafa')
 expect(claudeUiColor('ansi256(196)')).toBe('rgb(255, 0, 0)')
 expect(claudeUiColor('ansi256(999)')).toBeUndefined()
 expect(claudeUiColor('ansi:not-a-color')).toBeUndefined()
})

it('reports Client focus as a held site without selecting its surrounding native container',async()=>{
 const id='9b08a63e-78f6-46c5-9134-c6c64de30937',tree={kind:'client' as const,id,keys:true,pointer:true,children:[{kind:'text' as const,text:'Native Client'}]}
 const f=await mount({nativeUi:{status:'live',tree}})
 const region=f.root.querySelector<HTMLElement>('[data-native-client]')!
 region.focus()
 const keyboard=f.root.querySelector<HTMLTextAreaElement>('[data-native-client-text-input]')!
 expect(document.activeElement).toBe(keyboard)
 expect(f.focusReport).toHaveBeenLastCalledWith(expect.objectContaining({isHeld:true,focusId:undefined}))
 f.state.nativeUi={status:'live',tree:{...tree,children:[{kind:'text',text:'Native Client redrawn'}]}};await nextTick()
 expect(f.root.querySelector('[data-native-client]')).toBe(region);expect(document.activeElement).toBe(keyboard)
})

it('commits Client field IME text once and defers native replacements until composition ends',async()=>{
 const input={kind:'input' as const,actionId:'client-ime',value:'initial',revision:0,rows:2,submitLabel:'send',autoFocus:false,label:'Client draft'}
 const client=(value:string,revision:number)=>({kind:'client' as const,id:'9b08a63e-78f6-46c5-9134-c6c64de30937',pointer:false,keys:true,children:[{...input,value,revision}]})
 const f=await mount({nativeUi:{status:'live',tree:client('initial',0)}})
 const field=f.root.querySelector<HTMLTextAreaElement>('[aria-label="Client draft"]')!;field.focus()
 field.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))
 field.value='preedit';field.dispatchEvent(Object.assign(new Event('input',{bubbles:true}),{isComposing:true}))
 field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
 expect(f.field).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled()
 f.state.nativeUi={status:'live',tree:client('server replacement',0)};await nextTick();expect(field.value).toBe('preedit')
 field.value='完成';field.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'完成'}))
 field.dispatchEvent(Object.assign(new Event('input',{bubbles:true}),{isComposing:false}))
 expect(f.field).toHaveBeenCalledExactlyOnceWith({actionId:'client-ime',revision:1,kind:'change',value:'完成'})
 f.state.nativeUi={status:'live',tree:client('完成!',1)};await nextTick();expect(field.value).toBe('完成!');expect(document.activeElement).toBe(field)
 field.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
 expect(f.field).toHaveBeenLastCalledWith({actionId:'client-ime',revision:2,kind:'submit',value:'完成!'});expect(f.submit).not.toHaveBeenCalled()
})

it('updates resolved field paint without replacing focused drafts or emitting input', async () => {
  const input = { kind: 'input' as const, actionId: 'themed-field', revision: 0, value: '', rows: 2, autoFocus: false, submitLabel: 'Send', label: 'Themed draft', theme: { text: '#112233', inverseText: '#ddeeff' } }
  const f = await mount({ nativeUi: { status: 'live', tree: input } })
  const field = f.root.querySelector<HTMLTextAreaElement>('[aria-label="Themed draft"]')!
  field.focus(); field.value = 'Unsent local draft'; field.dispatchEvent(new Event('input', { bubbles: true }))
  f.field.mockClear()
  const label = field.closest('label')!
  expect(label.style.getPropertyValue('--native-field-text')).toBe('rgb(17, 34, 51)')
  f.state.nativeUi = { status: 'live', tree: { ...input, theme: { text: '#abcdef', inverseText: '#010203' } } }
  await nextTick()
  expect(f.root.querySelector('[aria-label="Themed draft"]')).toBe(field)
  expect(field.value).toBe('Unsent local draft'); expect(document.activeElement).toBe(field)
  expect(label.style.getPropertyValue('--native-field-text')).toBe('rgb(171, 205, 239)')
  expect(label.style.getPropertyValue('--native-field-inverse')).toBe('rgb(1, 2, 3)')
  expect(f.field).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled()
})

it('reports expanded native content only while it needs composer space', async () => {
  const f = await mount({ nativeUi: live }, false)
  expect(f.toolsExpanded).toHaveBeenLastCalledWith(false)
  const toggle = f.root.querySelector<HTMLButtonElement>('button[aria-label="Session tools"]')!
  toggle.click(); await nextTick()
  expect(f.toolsExpanded).toHaveBeenLastCalledWith(true)
  f.state.nativeUi = { status: 'disconnected' }; await nextTick()
  expect(f.toolsExpanded).toHaveBeenLastCalledWith(false)
  f.state.nativeUi = live; await nextTick()
  expect(f.toolsExpanded).toHaveBeenLastCalledWith(true)
  f.root.querySelector<HTMLButtonElement>('button[aria-label="Session tools"]')!.click(); await nextTick()
  expect(f.toolsExpanded).toHaveBeenLastCalledWith(false)
  expect(f.submit).not.toHaveBeenCalled()
})

it('reveals the focused field label on viewport resize without moving focus from the draft', async () => {
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'input', revision: 0, submitLabel: 'send', actionId: 'field', focusId: 'keyed-field', label: 'Native draft', value: 'Retained input', rows: 2, autoFocus: false } } })
  await nextTick()
  const site = f.root.querySelector<HTMLElement>('.native-extension-surface')!, field = site.querySelector<HTMLElement>('[data-native-scroll-id]')!, input = site.querySelector<HTMLTextAreaElement>('textarea')!
  let height = 100, fieldHeight = 80
  expect(observedElements).toContain(site.querySelector('[data-native-scroll-content]'))
  Object.defineProperties(site, { clientHeight: { get: () => height }, scrollHeight: { value: 500 } })
  site.getBoundingClientRect = () => ({ top: 0, bottom: height, height, width: 300 }) as DOMRect
  field.getBoundingClientRect = () => ({ top: 300 - site.scrollTop, bottom: 300 + fieldHeight - site.scrollTop, height: fieldHeight, width: 300 }) as DOMRect
  input.focus()
  expect(site.scrollTop).toBe(280)
  fieldHeight = 96
  resizeObservers.forEach(callback => callback())
  expect(site.scrollTop).toBe(296)
  expect(document.activeElement).toBe(input)
  height = 60
  resizeObservers.forEach(callback => callback())
  expect(site.scrollTop).toBe(300)
  expect(document.activeElement).toBe(input)
  const draft = f.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!
  draft.focus(); site.scrollTop = 140
  height = 100; resizeObservers.forEach(callback => callback())
  expect(site.scrollTop).toBe(140)
  expect(document.activeElement).toBe(draft)
})

it('truncates the original styled inline tree at measured width, redraws on resize and retires its measurement', async () => {
  let width = 6
  const oldRangeRect = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value(this: Range) { return { width: this.toString().length } as DOMRect } })
  onTestFinished(() => { if (oldRangeRect) Object.defineProperty(Range.prototype, 'getBoundingClientRect', oldRangeRect); else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect') })
  const elementRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { width: this.textContent === '…' ? 1 : width } as DOMRect
  })
  onTestFinished(() => elementRect.mockRestore())
  const tree: ClaudeUiMountState = { status: 'live', tree: { kind: 'text', text: 'ab', style: { wrap: 'truncate-middle' }, children: [
    { kind: 'text', text: 'cdef', style: { bold: true } },
    { kind: 'link', href: 'https://example.test/notes', children: [{ kind: 'text', text: 'ghij', style: { italic: true } }] },
  ] } }
  const f = await mount({ nativeUi: tree })
  const text = () => f.root.querySelector<HTMLElement>('[data-native-text-wrap="truncate-middle"]')!
  await vi.waitFor(() => expect(text().textContent).toBe('abc…ij'))
  expect(text().querySelector('a')?.textContent).toBe('ij')
  expect(text().querySelector('a')?.getAttribute('href')).toBe('https://example.test/notes')
  expect(text().querySelector('.font-semibold')?.textContent).toBe('c')
  const input = f.root.querySelector('textarea')!; input.value = 'Keep my draft'
  width = 8; resizeObservers.forEach(callback => callback()); await nextTick()
  expect(text().textContent).toBe('abcd…hij')
  expect(input.value).toBe('Keep my draft')
  expect(JSON.stringify(tree.tree)).toContain('cdef')
  app!.unmount(); app = undefined
  expect(document.body.querySelector('[aria-hidden="true"][data-native-text-wrap]')).toBeNull()
})

it('fits requested multiline rows to its site without losing long text, selection or field-only submission', async () => {
  vi.stubGlobal('innerHeight', 1600)
  const value = 'Long review\n' + 'detail '.repeat(2600) + '  '
  const input = { kind: 'input' as const, actionId: 'long-field', revision: 0, submitLabel: 'save', label: 'Release notes', value, rows: 80, autoFocus: false }
  const f = await mount({ nativeUi: { status: 'live', tree: input } })
  const control = f.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Release notes"]')!
  const label = control.closest('label')!, site = control.closest('[data-native-scroll-content]')!.parentElement!
  let siteHeight = 1300
  site.style.paddingTop = '10px'; site.style.paddingBottom = '10px'
  Object.defineProperty(site, 'clientHeight', { configurable: true, get: () => siteHeight })
  control.style.lineHeight = '20px'; control.style.padding = '0'; control.style.borderWidth = '0'
  vi.spyOn(label, 'getBoundingClientRect').mockReturnValue({ height: 240 } as DOMRect)
  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({ height: 200 } as DOMRect)
  control.focus(); control.setSelectionRange(700, 705)
  for (const notify of resizeObservers) notify()
  await vi.waitFor(() => expect(control.rows).toBe(62))
  expect(control.value).toBe(value); expect(control.maxLength).toBe(16384)
  siteHeight = 220; for (const notify of resizeObservers) notify()
  await vi.waitFor(() => expect(control.rows).toBe(8))
  expect(control.value).toBe(value); expect([control.selectionStart, control.selectionEnd]).toEqual([700, 705])
  expect(document.activeElement).toBe(control); expect(f.field).not.toHaveBeenCalled()
  control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await nextTick()
  expect(f.root.querySelector('[role=alert]')?.textContent).toContain('Shorten this field')
  expect(control.value).toBe(value); expect(f.field).not.toHaveBeenCalled()
  f.state.nativeUi = { status: 'live', tree: { ...input, value: 'outdated native replacement', revision: 0 } }; await nextTick()
  expect(control.value).toBe(value)
  const revised = 'Reviewed notes\n' + 'x'.repeat(15000) + '\nKeep trailing spaces.  '
  control.value = revised; control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(f.field).toHaveBeenLastCalledWith({ actionId: 'long-field', revision: 3, kind: 'submit', value: revised })
  await nextTick(); expect(f.root.querySelector('[role=alert]')).toBeNull()
  expect(f.submit).not.toHaveBeenCalled()
})


it('regrows an intrinsically sized native field after compact fitting without changing its draft or scroll', async () => {
  vi.stubGlobal('innerHeight', 900)
  const value = 'Release notes\n' + 'Preserved detail\n'.repeat(40)
  const f = await mount({ nativeUi: { status: 'live', tree: { kind: 'input', actionId: 'growing-field', revision: 0, submitLabel: 'save', label: 'Growing notes', value, rows: 80, autoFocus: false } } })
  const control = f.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Growing notes"]')!
  const label = control.closest('label')!, site = control.closest('[data-native-scroll-content]')!.parentElement!
  control.style.lineHeight = '20px'; control.style.padding = '0'; control.style.borderWidth = '0'
  let capacity = 60
  // The site's intrinsic height follows its field until the surrounding layout caps it.
  Object.defineProperty(site, 'clientHeight', { configurable: true, get: () => Math.min(capacity, control.rows * 20 + 40) })
  vi.spyOn(control, 'getBoundingClientRect').mockImplementation(() => ({ height: control.rows * 20 }) as DOMRect)
  vi.spyOn(label, 'getBoundingClientRect').mockImplementation(() => ({ height: control.rows * 20 + 40 }) as DOMRect)
  control.focus(); control.setSelectionRange(30, 35); control.scrollTop = 120; site.scrollTop = 45
  resizeObservers.forEach(notify => notify())
  await vi.waitFor(() => expect(control.rows).toBe(1))
  capacity = 300; resizeObservers.forEach(notify => notify())
  await vi.waitFor(() => expect(control.rows).toBe(13))
  expect(control.value).toBe(value)
  expect([control.selectionStart, control.selectionEnd]).toEqual([30, 35])
  expect(control.scrollTop).toBe(120); expect(site.scrollTop).toBe(45)
  expect(document.activeElement).toBe(control); expect(f.field).not.toHaveBeenCalled()
})


it('reserves a complete focused field and feedback row when its compact site is too short', async () => {
  const value = 'detail '.repeat(2600)
  const f = await mount({nativeUi:{status:'live',tree:{kind:'input',actionId:'notes',focusId:'notes-focus',revision:0,label:'Release notes',submitLabel:'save',value,rows:80,autoFocus:false}}})
  const strip = f.root.querySelector<HTMLElement>('[data-testid="composer-session-strip"]')!, site = f.root.querySelector<HTMLElement>('.native-extension-surface')!, field = site.querySelector<HTMLElement>('.native-field')!, control = field.querySelector<HTMLTextAreaElement>('textarea')!
  let fieldHeight = 60
  strip.getBoundingClientRect = () => ({height:128}) as DOMRect
  site.getBoundingClientRect = () => ({top:0,bottom:45,height:45}) as DOMRect
  field.getBoundingClientRect = () => ({top:0,bottom:fieldHeight,height:fieldHeight}) as DOMRect
  control.getBoundingClientRect = () => ({height:38}) as DOMRect
  Object.defineProperties(site,{clientHeight:{value:45},scrollHeight:{value:200}})
  site.style.paddingTop = '12px'; site.style.paddingBottom = '12px'
  control.style.lineHeight = '20px'; control.style.paddingTop = '8px'; control.style.paddingBottom = '8px'; control.style.borderTopWidth = '1px'; control.style.borderBottomWidth = '1px'
  control.focus(); await nextTick()
  expect(strip.style.minHeight).toBe('167px')
  control.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))
  await nextTick(); fieldHeight = 82
  resizeObservers.forEach(callback=>callback()); await nextTick()
  expect(strip.style.minHeight).toBe('189px')
  expect(field.querySelector('[role=alert]')?.textContent).toContain('Shorten this field')
  expect(control.value).toBe(value); expect(document.activeElement).toBe(control)
  expect(f.field).not.toHaveBeenCalled(); expect(f.submit).not.toHaveBeenCalled()
  f.root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.focus(); await nextTick()
  expect(strip.style.minHeight).toBe('')
})
