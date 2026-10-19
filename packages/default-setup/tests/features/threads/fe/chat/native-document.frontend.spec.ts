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
