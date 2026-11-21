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
