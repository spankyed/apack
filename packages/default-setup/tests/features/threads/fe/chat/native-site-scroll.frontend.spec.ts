import { createApp, h, ref, reactive, nextTick } from 'vue'
import { useClaudeSiteScroll } from '#features/threads/fe/chat/native-site-scroll.ts'
import type { ClaudeUiScrollState } from '#features/code/be/services/claude-code/ui-presentation.ts'

it('applies native offsets without echo, reports gestures, preserves fractional scrolling and follows growth', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(), observers: ResizeObserverCallback[] = []
  let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  const frame = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) }
  const state = reactive<{ scroll?: ClaudeUiScrollState }>({}), emit = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const element = ref<HTMLElement | null>(null)
  let bridge!: ReturnType<typeof useClaudeSiteScroll>
  const app = createApp({ setup() {
    bridge = useClaudeSiteScroll({ element, state: () => state.scroll, emit })
    return () => h('div', { ref: element, style: { lineHeight: '20px' } }, [h('div', { 'data-native-scroll-content': '' }, [h('span', { 'data-native-scroll-id': 'opaque' }, 'Target')])])
  } }); app.mount(root)
  try {
    await nextTick(); await nextTick()
    const site = element.value!
    let height = 400
    Object.defineProperties(site, { clientHeight: { value: 100 }, scrollHeight: { get: () => height } })
    site.getBoundingClientRect = () => ({ top: 0, bottom: 100, width: 200, height: 100 }) as DOMRect
    site.querySelector<HTMLElement>('span')!.getBoundingClientRect = () => ({ top: 160 - site.scrollTop, bottom: 200 - site.scrollTop, width: 100, height: 40 }) as DOMRect
    frame()
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 1, offset: 0, by: 0, rows: 5, contentRows: 20, keyed: [{ id: 'opaque', top: 8, bottom: 10 }] }))
    observers[0]([], {} as ResizeObserver); frame(); expect(emit).toHaveBeenCalledTimes(1)
    site.querySelector<HTMLElement>('span')!.style.color = 'red'; await nextTick(); await Promise.resolve(); frame(); expect(emit).toHaveBeenCalledTimes(1)
    state.scroll = { serial: 1, offset: 5, followEnd: false }; await nextTick()
    expect(site.scrollTop).toBe(100); site.dispatchEvent(new Event('scroll')); frame(); expect(emit).toHaveBeenCalledTimes(1)
    site.scrollTop = 60; site.dispatchEvent(new Event('scroll')); frame()
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, offset: 3, by: -2 }))
    state.scroll = { serial: 2, requestRevision: 2, offset: 4, followEnd: false }; await nextTick()
    expect(site.scrollTop).toBe(80); site.dispatchEvent(new Event('scroll')); frame(); expect(emit).toHaveBeenCalledTimes(2)
    site.scrollTop = 85; site.dispatchEvent(new Event('scroll')); frame()
    state.scroll = { serial: 3, requestRevision: 3, offset: 4, followEnd: false }; await nextTick()
    expect(site.scrollTop).toBe(85)
    state.scroll = { serial: 4, requestRevision: 2, offset: 0, followEnd: false }; await nextTick(); expect(site.scrollTop).toBe(85)
    bridge.reveal(180)
    state.scroll = { serial: 5, requestRevision: 3, offset: 4, followEnd: false }; await nextTick()
    expect(site.scrollTop).toBe(180); frame()
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 9, by: 5 }))
    state.scroll = { serial: 6, offset: 15, followEnd: true }; await nextTick(); expect(site.scrollTop).toBe(300)
    height = 600; observers[0]([], {} as ResizeObserver); frame(); expect(site.scrollTop).toBe(500)
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ by: 0, contentRows: 30 }))
    bridge.reveal(200); frame(); expect(site.scrollTop).toBe(200)
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 10, by: -15 }))
    observers[0]([], {} as ResizeObserver); app.unmount(); expect(callbacks.size).toBe(0)
  } finally { if (root.firstChild) app.unmount(); root.remove(); vi.unstubAllGlobals() }
})

it('reports wheel intent at edges with the latest pointer, supports scroll keys and leaves field input alone', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(); let frameId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  const frame = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) }
  const emit = vi.fn(), root = document.createElement('div'); document.body.append(root)
  const element = ref<HTMLElement | null>(null)
  const app = createApp({ setup() { useClaudeSiteScroll({ element, state: () => undefined, cellWidth: () => 10, emit }); return () => h('div', { ref: element, style: { lineHeight: '20px' }, tabindex: 0 }, [h('textarea')]) } })
  app.mount(root)
  try {
    await nextTick(); await nextTick()
    const site = element.value!, field = site.querySelector('textarea')!
    Object.defineProperties(site, { clientHeight: { value: 100 }, scrollHeight: { value: 400 } })
    site.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect
    frame(); emit.mockClear()
    const wheel = new WheelEvent('wheel', { deltaY: -40, clientX: 45, clientY: 25, bubbles: true, cancelable: true })
    site.dispatchEvent(wheel); frame()
    expect(wheel.defaultPrevented).toBe(true); expect(site.scrollTop).toBe(0)
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ by: -2, offset: 0, pointer: { column: 4, row: 1 } }))
    site.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, clientX: 25, clientY: 5, bubbles: true, cancelable: true }))
    site.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, clientX: 65, clientY: 45, bubbles: true, cancelable: true })); frame()
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ by: 3, offset: 3, pointer: { column: 6, row: 2 } }))
    site.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); frame()
    expect(site.scrollTop).toBe(0); expect(emit.mock.lastCall![0]).toMatchObject({ by: -20, offset: 0 }); expect(emit.mock.lastCall![0].pointer).toBeUndefined()
    site.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })); frame()
    expect(emit.mock.lastCall![0]).toMatchObject({ by: -1, offset: 0 })
    const count = emit.mock.calls.length
    const edit = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }); field.dispatchEvent(edit)
    const zoom = new WheelEvent('wheel', { deltaY: 20, ctrlKey: true, bubbles: true, cancelable: true }); site.dispatchEvent(zoom); frame()
    expect(edit.defaultPrevented).toBe(false); expect(zoom.defaultPrevented).toBe(false); expect(emit).toHaveBeenCalledTimes(count)
    Object.defineProperties(field, { clientHeight: { value: 20 }, scrollHeight: { value: 80 } })
    const nested = new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true }); field.dispatchEvent(nested); frame()
    expect(nested.defaultPrevented).toBe(false); expect(emit).toHaveBeenCalledTimes(count)
  } finally { app.unmount(); root.remove(); vi.unstubAllGlobals() }
})
