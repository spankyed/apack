import { createApp, h, nextTick, ref } from 'vue'
import { nativeTranscriptLatestTop, useNativeTranscriptViewport } from '#features/threads/fe/chat/native-transcript-viewport.ts'

it('keeps short replies readable ahead of trailing placements and ends long replies at the viewport edge', () => {
  const viewport = document.createElement('div'), row = document.createElement('article')
  row.dataset.messageId = 'reply'; viewport.append(row)
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 600 } })
  viewport.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
  let top = 450, height = 30
  row.getBoundingClientRect = () => ({ top: 10 + top - viewport.scrollTop, height }) as DOMRect
  expect(nativeTranscriptLatestTop(viewport)).toBe(450)
  top = 520; expect(nativeTranscriptLatestTop(viewport)).toBe(500)
  top = 300; height = 250; expect(nativeTranscriptLatestTop(viewport)).toBe(450)
})

it('follows viewport resizing without stealing focus and retires queued work on reader intent or owner replacement', async () => {
  const frames = new Map<number, FrameRequestCallback>(), observers: ResizeObserverCallback[] = []
  let serial = 0, width = 800, height = 100
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  const viewport = ref<HTMLElement | null>(null), content = ref<HTMLElement | null>(null), owner = ref('session-one')
  const root = document.createElement('div'), editor = document.createElement('input')
  document.body.append(root, editor); editor.focus()
  const app = createApp({ setup() {
    useNativeTranscriptViewport({ viewport, content, owner: () => owner.value, active: () => true })
    return () => h('div', { ref: viewport }, h('div', { ref: content }, h('article', { 'data-message-id': 'reply' })))
  } })
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) }
  const resize = () => observers.at(-1)!([], {} as ResizeObserver)
  app.mount(root)
  try {
    await nextTick()
    const element = viewport.value!, row = content.value!.firstElementChild!
    Object.defineProperties(element, { clientWidth: { get: () => width }, clientHeight: { get: () => height }, scrollHeight: { value: 600 } })
    element.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
    row.getBoundingClientRect = () => ({ top: 460 - element.scrollTop, height: 30 }) as DOMRect
    element.scrollTop = 450; resize()
    height = 200; width = 600; resize(); flush()
    expect(element.scrollTop).toBe(400); expect(document.activeElement).toBe(editor)
    height = 100; resize()
    element.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); flush()
    expect(element.scrollTop).toBe(400)
    element.scrollTop = 100; element.dispatchEvent(new Event('scroll'))
    height = 200; resize(); flush(); expect(element.scrollTop).toBe(100)
    resize(); flush(); expect(element.scrollTop).toBe(100)
    element.scrollTop = 400; element.dispatchEvent(new Event('scroll'))
    height = 100; resize(); expect(frames.size).toBe(1)
    owner.value = 'session-two'; await nextTick(); expect(frames.size).toBe(0)
    flush(); expect(element.scrollTop).toBe(400)
    element.scrollTop = 450; element.dispatchEvent(new Event('scroll'))
    height = 200; resize(); expect(frames.size).toBe(1)
    app.unmount(); expect(frames.size).toBe(0)
  } finally { if (root.firstChild) app.unmount(); root.remove(); editor.remove(); vi.unstubAllGlobals() }
})
