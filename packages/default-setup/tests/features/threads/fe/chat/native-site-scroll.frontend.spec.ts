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
  const app = createApp({ setup() {
    useClaudeSiteScroll({ element, state: () => state.scroll, emit })
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
    state.scroll = { serial: 5, offset: 15, followEnd: true }; await nextTick(); expect(site.scrollTop).toBe(300)
    height = 600; observers[0]([], {} as ResizeObserver); frame(); expect(site.scrollTop).toBe(500)
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({ by: 0, contentRows: 30 }))
    observers[0]([], {} as ResizeObserver); app.unmount(); expect(callbacks.size).toBe(0)
  } finally { if (root.firstChild) app.unmount(); root.remove(); vi.unstubAllGlobals() }
})
