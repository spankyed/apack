import { createApp, h } from 'vue'
import NativeUiDocument from '#features/threads/fe/chat/NativeUiDocument.vue'
it('draws original Code ANSI as inert spans while keeping original source separate', () => {
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => h(NativeUiDocument, { node: { kind: 'code', source: 'original source', nativeAnsi: '\x1b[38;2;1;2;3m<script>drawn</script>\x1b[39m\nnext', color: '#abcdef', format: 'diff', wrap: 'wrap' } }) }); app.mount(root)
  try {
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelector('pre')?.textContent).toBe('<script>drawn</script>\nnext')
    expect((root.querySelector('pre span') as HTMLElement).style.color).toBe('rgb(1, 2, 3)')
    expect(root.querySelector('[data-native-code-ansi]')).not.toBeNull()
    expect(root.querySelector('.native-diff')).toBeNull()
  } finally { app.unmount(); root.remove() }
})

it('keeps native Markdown links scoped to the original callback and rejects unsafe hyperlink schemes', () => {
  const root = document.createElement('div'); document.body.append(root)
  const press = vi.fn(), href = 'https://example.com/native'
  const nativeAnsi = '\x1b[1mHeading\x1b[22m\n\x1b]8;id=native;' + href + '\x07\x1b[31m<script>link</script>\x1b]8;;\x07\x1b[39m\n\x1b]8;;javascript:alert(1)\x07unsafe\x1b]8;;\x07'
  const app = createApp({ render: () => h(NativeUiDocument, { node: { kind: 'markdown', text: 'original Markdown', nativeAnsi, dim: false, actionId: 'original-action', pressableLinks: [href] }, onPress: press }) }); app.mount(root)
  try {
    expect(root.querySelector('script')).toBeNull()
    expect(root.querySelectorAll('a')).toHaveLength(1)
    expect(root.querySelector('a')?.textContent).toBe('<script>link</script>')
    expect((root.querySelector('a') as HTMLElement).style.color).toBe('rgb(248, 113, 113)')
    root.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(press).toHaveBeenCalledWith('original-action', href)
    expect(root.textContent).toContain('unsafe')
    expect(root.querySelector('.ProseMirror')).toBeNull()
  } finally { app.unmount(); root.remove() }
})
