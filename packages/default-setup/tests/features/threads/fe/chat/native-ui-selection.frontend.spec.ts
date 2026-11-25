import { createApp, h, nextTick } from 'vue'
import { provideClaudeUiSelection, replyClaudeUiSelection } from '#features/threads/fe/chat/native-ui-selection.ts'

it.each(['data-native-assistant', 'data-native-selection-row', 'data-native-agent-message'])('retains text and %s attribution through action focus, then clears on blur/unmount', async rowAttribute => {
  const root = document.createElement('div'); document.body.append(root)
  let reader!: ReturnType<typeof provideClaudeUiSelection>
  const app = createApp({ setup() { reader = provideClaudeUiSelection(() => root); return () => h('div', { [rowAttribute]: 'original-row' }, 'Release notes selected 👋') } })
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  root.getClientRects = () => [{ width: 500 }] as unknown as DOMRectList
  app.mount(root); await nextTick()
  try {
    const selected = document.getSelection()!, range = document.createRange(), text = root.firstChild!.firstChild!
    range.setStart(text, 14); range.setEnd(text, 25); selected.removeAllRanges(); selected.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    const expected = { text: selected.toString(), instance_id: 'original-row' }
    expect(reader.read()).toEqual(expected)
    selected.removeAllRanges(); expect(reader.read()).toEqual(expected)
    window.dispatchEvent(new Event('blur')); expect(reader.read()).toBeUndefined()
    selected.addRange(range); reader.read(); app.unmount(); expect(reader.read()).toBeUndefined()
  } finally { focus.mockRestore(); root.remove() }
})

it('rejects non-loopback or non-ticket destinations before reading any selected text', async () => {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true), read = vi.fn(() => ({ text: 'Private selected text' }))
  try {
    for (const url of ['https://example.test/' + 'a'.repeat(64), 'http://127.0.0.1:1234/wrong', 'http://127.0.0.1:1234/' + 'a'.repeat(64) + '?other=1']) {
      expect(await replyClaudeUiSelection(url, { read, clear() {} }, Date.now() + 1000, () => true)).toBe(false)
    }
    expect(read).not.toHaveBeenCalled()
  } finally { focus.mockRestore() }
})


it.each(['input', 'textarea'])('retires stale selection for collapsed, oversized and foreign %s fields', async tag => {
  const root = document.createElement('div'), foreign = document.createElement(tag) as HTMLInputElement | HTMLTextAreaElement
  document.body.append(root, foreign)
  let reader!: ReturnType<typeof provideClaudeUiSelection>
  const app = createApp({ setup() { reader = provideClaudeUiSelection(() => root); return () => h(tag) } })
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  root.getClientRects = () => [{ width: 500 }] as unknown as DOMRectList
  app.mount(root); await nextTick()
  try {
    document.getSelection()?.removeAllRanges()
    const field = root.firstElementChild as HTMLInputElement | HTMLTextAreaElement
    const prime = () => { field.focus(); field.value = 'current'; field.setSelectionRange(0, 7); expect(reader.read()).toEqual({ text: 'current' }) }
    prime(); field.setSelectionRange(3, 3); expect(reader.read()).toBeUndefined()
    prime(); field.value = 'a'.repeat(1_000_000); field.setSelectionRange(0, field.value.length)
    expect(reader.read()?.text.length).toBe(1_000_000)
    field.value += 'a'; field.setSelectionRange(0, field.value.length); expect(reader.read()).toBeUndefined()
    prime(); foreign.value = 'other owner'; foreign.focus(); foreign.setSelectionRange(0, 5); expect(reader.read()).toBeUndefined()
  } finally { app.unmount(); focus.mockRestore(); root.remove(); foreign.remove() }
})

it.each(['removed', 'hidden', 'reused', 'collapsed', 'concealed'] as const)('refuses a cached selection from a %s transcript row', async change => {
  const root = document.createElement('div')
  document.body.append(root)
  let reader!: ReturnType<typeof provideClaudeUiSelection>
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  root.getClientRects = () => [{ width: 500 }] as unknown as DOMRectList
  const app = createApp({
    setup() {
      reader = provideClaudeUiSelection(() => root)
      return () => h('div', { 'data-native-assistant': 'first-reply' }, 'Release notes')
    },
  })
  app.mount(root)
  try {
    const row = root.firstElementChild!
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(row)
    selection.removeAllRanges()
    selection.addRange(range)
    expect(reader.read()).toEqual({ text: 'Release notes', instance_id: 'first-reply' })
    selection.removeAllRanges()
    expect(reader.read()?.text).toBe('Release notes')
    if (change === 'removed') row.remove()
    if (change === 'hidden') row.setAttribute('aria-hidden', 'true')
    if (change === 'reused') row.setAttribute('data-native-assistant', 'new-reply')
    if (change === 'collapsed') (row as HTMLElement).style.display = 'none'
    if (change === 'concealed') (row as HTMLElement).style.visibility = 'hidden'
    expect(reader.read()).toBeUndefined()
    if (change === 'collapsed' || change === 'concealed') {
      row.removeAttribute('style')
      expect(reader.read()).toBeUndefined()
      selection.addRange(range)
      expect(reader.read()).toEqual({ text: 'Release notes', instance_id: 'first-reply' })
    }
  } finally { app.unmount(); focus.mockRestore(); root.remove() }
})

it('withholds a cached field selection when the original field value changes', () => {
  const root = document.createElement('div')
  document.body.append(root)
  let reader!: ReturnType<typeof provideClaudeUiSelection>
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  root.getClientRects = () => [{ width: 500 }] as unknown as DOMRectList
  const app = createApp({
    setup() {
      reader = provideClaudeUiSelection(() => root)
      return () => [h('input', { value: 'Release notes' }), h('button', 'Read selection')]
    },
  })
  app.mount(root)
  try {
    const field = root.querySelector('input')!, button = root.querySelector('button')!
    field.focus()
    field.setSelectionRange(0, 7)
    expect(reader.read()).toEqual({ text: 'Release' })
    button.focus()
    expect(reader.read()).toEqual({ text: 'Release' })
    field.value = 'Current draft'
    expect(reader.read()).toBeUndefined()
  } finally { app.unmount(); focus.mockRestore(); root.remove() }
})
