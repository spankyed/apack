import { createApp, h, nextTick, reactive } from 'vue'
import NativeUiBrokerImage from '#features/threads/fe/chat/NativeUiBrokerImage.vue'
import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'
const f = vi.hoisted(() => ({ observe: vi.fn() }))
vi.mock('#extensions/terminal/pool.ts', () => ({ observeNativeTerminalImage: f.observe }))
it('paints broker RGBA, withdraws deleted pixels, and releases the old owner on replacement/unmount', async () => {
  const subscriptions: { changed: (value: any) => void; stop: ReturnType<typeof vi.fn> }[] = []
  f.observe.mockImplementation((_session, _id, changed) => { const entry = { changed, stop: vi.fn() }; subscriptions.push(entry); return entry.stop })
  const paint = vi.fn()
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ putImageData: paint } as any)
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} })
  const node = reactive<Extract<ClaudeUiNode, { kind: 'broker-image' }>>({ kind: 'broker-image', imageId: 7, columns: 2, rows: 1, alt: 'Original cover', terminalSession: { id: 'first-owner', target: 'host' } })
  const root = document.createElement('div'), app = createApp(() => h(NativeUiBrokerImage, { node }))
  document.body.append(root); app.mount(root)
  try {
    expect(root.textContent).toContain('Original cover')
    expect(f.observe).toHaveBeenLastCalledWith({ id: 'first-owner', target: 'host' }, 7, expect.any(Function))
    subscriptions[0]!.changed({ generation: 1, width: 1, height: 1, pixels: new Uint8ClampedArray([255, 0, 0, 255]) }); await nextTick()
    expect(root.querySelector('canvas')?.getAttribute('aria-label')).toBe('Original cover')
    expect(paint.mock.calls.at(-1)?.[0].data).toEqual(new Uint8ClampedArray([255, 0, 0, 255]))
    subscriptions[0]!.changed(null); await nextTick(); expect(root.querySelector('canvas')).toBeNull()
    node.terminalSession = { id: 'replacement-owner', target: null }; await nextTick()
    expect(subscriptions[0]!.stop).toHaveBeenCalledOnce()
    expect(f.observe).toHaveBeenLastCalledWith({ id: 'replacement-owner', target: null }, 7, expect.any(Function))
    subscriptions[1]!.changed({ generation: 2, width: 2, height: 1, pixels: new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255]) }); await nextTick()
    expect(root.querySelector('canvas')?.width).toBe(2)
    expect(paint.mock.calls.at(-1)?.[0].data).toEqual(new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255]))
  } finally { app.unmount(); root.remove(); context.mockRestore(); vi.unstubAllGlobals() }
  expect(subscriptions[1]!.stop).toHaveBeenCalledOnce()
})
