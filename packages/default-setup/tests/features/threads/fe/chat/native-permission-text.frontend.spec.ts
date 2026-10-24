import { createApp, h } from 'vue'
import NativePermissionText from '#features/threads/fe/chat/NativePermissionText.vue'
import { openLink } from '@apackdev/sdk/fe'
vi.mock('@apackdev/sdk/fe', () => ({ openLink: vi.fn() }))
afterEach(() => vi.clearAllMocks())
it('preserves original style and OSC links while routing only primary/middle activation', () => {
  const root = document.createElement('div'); document.body.append(root)
  const ansi = '\x1b[2murl: \x1b[22m\x1b]8;;https://example.test/review\x07\x1b[38;2;12;34;56mReview\x1b[39m\x1b]8;;\x07'
  const app = createApp({ render: () => h(NativePermissionText, { text: 'url: Review', ansi }) }); app.mount(root)
  try {
    expect(root.textContent).toBe('url: Review')
    expect(root.querySelector('span span')?.getAttribute('style')).toContain('opacity: 0.65')
    const link = root.querySelector('a')!; expect(link.style.color).toBe('rgb(12, 34, 56)')
    link.click(); expect(openLink).toHaveBeenLastCalledWith('https://example.test/review')
    link.dispatchEvent(new MouseEvent('auxclick', { button: 1 })); expect(openLink).toHaveBeenCalledTimes(2)
    link.dispatchEvent(new MouseEvent('auxclick', { button: 2 })); expect(openLink).toHaveBeenCalledTimes(2)
  } finally { app.unmount(); root.remove() }
})
it('keeps plain parameter URLs inert and refuses unsafe OSC links and literal HTML', () => {
  const root = document.createElement('div'); document.body.append(root)
  const ansi = '\x1b]8;;javascript:alert(1)\x07<script>literal</script>\x1b]8;;\x07'
  const app = createApp({ render: () => h('div', [h(NativePermissionText, { text: 'https://example.test/plain' }), h(NativePermissionText, { text: '<script>literal</script>', ansi })]) }); app.mount(root)
  try { expect(root.querySelector('a,script')).toBeNull(); expect(root.textContent).toContain('<script>literal</script>'); expect(openLink).not.toHaveBeenCalled() }
  finally { app.unmount(); root.remove() }
})
