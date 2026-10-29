import { createApp, h, nextTick, ref } from 'vue'
import { useClaudeAgentScroll, type ClaudeAgentScrollPosition } from '#features/threads/fe/chat/native-agent-scroll.ts'

it('follows replies, anchors readers through reflow, restores saved positions and cancels on teardown', async () => {
  const callbacks = new Map<number, FrameRequestCallback>(), observers: ResizeObserverCallback[] = []
  let serial = 0, height = 600, messageTop = 200
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  const flush = () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) }
  const viewport = ref<HTMLElement>(), content = ref<HTMLElement>(), active = ref(true), saved: ClaudeAgentScrollPosition[] = []
  let scroll!: ReturnType<typeof useClaudeAgentScroll>
  const root = document.createElement('div'); document.body.append(root)
  const app = createApp({ setup() {
    scroll = useClaudeAgentScroll({ viewport, content, active: () => active.value, save: value => saved.push(value) })
    return () => h('div', { ref: viewport }, h('div', { ref: content }, h('article', { 'data-native-agent-message': 'native-uuid' })))
  } }); app.mount(root)
  try {
    await nextTick()
    const element = viewport.value!, message = content.value!.firstElementChild!
    Object.defineProperties(element, { clientHeight: { get: () => active.value ? 100 : 0 }, scrollHeight: { get: () => height } })
    element.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect
    message.getBoundingClientRect = () => ({ top: messageTop - element.scrollTop, bottom: messageTop + 1000 - element.scrollTop }) as DOMRect
    flush(); expect(element.scrollTop).toBe(500)
    height = 800; observers[0]([], {} as ResizeObserver); flush(); expect(element.scrollTop).toBe(700)
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }))
    element.scrollTop = 220; element.dispatchEvent(new Event('scroll'))
    expect(scroll.following.value).toBe(false)
    expect(saved.at(-1)?.anchor).toEqual({ uuid: 'native-uuid', offset: -20 })
    messageTop += 80; height += 80; observers[0]([], {} as ResizeObserver); flush()
    expect(element.scrollTop).toBe(300)
    const revision = scroll.intentRevision()
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
    scroll.latest(revision); flush(); expect(element.scrollTop).toBe(300)
    active.value = false; await nextTick(); height += 100; observers[0]([], {} as ResizeObserver); flush()
    expect(element.scrollTop).toBe(300)
    active.value = true; await nextTick(); flush(); expect(element.scrollTop).toBe(300)
    scroll.latest(); flush(); expect(element.scrollTop).toBe(height - 100)
    expect(scroll.following.value).toBe(true)
    observers[0]([], {} as ResizeObserver); app.unmount(); expect(callbacks.size).toBe(0)
  } finally { if (root.firstChild) app.unmount(); root.remove(); vi.unstubAllGlobals() }
})

it('restores a saved native message anchor without changing keyboard focus', async () => {
  let frame: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const root = document.createElement('div'), editor = document.createElement('input')
  document.body.append(root, editor); editor.focus()
  const viewport = ref<HTMLElement>(), content = ref<HTMLElement>(), ready = ref(false)
  const save = vi.fn()
  const app = createApp({ setup() {
    useClaudeAgentScroll({ viewport, content, active: () => true, initial: { following: false, top: 90, anchor: { uuid: 'saved', offset: -12 } }, save })
    return () => h('div', { ref: viewport }, h('div', { ref: content }, ready.value ? [h('article', { 'data-native-agent-message': 'saved' })] : []))
  } }); app.mount(root)
  try {
    await nextTick()
    Object.defineProperties(viewport.value!, { clientHeight: { value: 100 }, scrollHeight: { value: 900 } })
    viewport.value!.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
    frame?.(0); expect(save).not.toHaveBeenCalled()
    ready.value = true; await nextTick()
    content.value!.firstElementChild!.getBoundingClientRect = () => ({ top: 210 - viewport.value!.scrollTop, bottom: 410 - viewport.value!.scrollTop }) as DOMRect
    frame?.(0)
    expect(viewport.value!.scrollTop).toBe(212)
    expect(document.activeElement).toBe(editor)
  } finally { app.unmount(); root.remove(); editor.remove(); vi.unstubAllGlobals() }
})
