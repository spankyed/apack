import { createApp, h, nextTick, ref } from 'vue'
import { isAtNativeTranscriptLatest, nativeTranscriptLatestTop, useNativeTranscriptViewport } from '#features/threads/fe/chat/native-transcript-viewport.ts'

it('keeps short replies readable and includes visible pending controls in the scroll target', () => {
  const viewport = document.createElement('div'), row = document.createElement('article')
  row.dataset.messageId = 'reply'; viewport.append(row)
  Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 600 } })
  viewport.getBoundingClientRect = () => ({ top: 10 }) as DOMRect
  let top = 450, height = 30
  row.getBoundingClientRect = () => ({ top: 10 + top - viewport.scrollTop, height }) as DOMRect
  expect(nativeTranscriptLatestTop(viewport)).toBe(450)
  viewport.scrollTop = 420; expect(isAtNativeTranscriptLatest(viewport)).toBe(false)
  viewport.scrollTop = 450; expect(isAtNativeTranscriptLatest(viewport)).toBe(true)
  top = 520; expect(nativeTranscriptLatestTop(viewport)).toBe(500)
  top = 300; height = 250; expect(nativeTranscriptLatestTop(viewport)).toBe(450)
  const body = document.createElement('div'); body.dataset.chatMessageContent = ''; row.append(body)
  body.getBoundingClientRect = () => ({ top: 330 - viewport.scrollTop, height: 25 }) as DOMRect
  expect(nativeTranscriptLatestTop(viewport)).toBe(320)
  const request = document.createElement('div'); request.dataset.chatPendingInteraction = 'true'; row.append(request)
  let requestHeight = 150
  request.getBoundingClientRect = () => ({ height: requestHeight }) as DOMRect
  expect(nativeTranscriptLatestTop(viewport)).toBe(450)
  requestHeight = 0
  expect(nativeTranscriptLatestTop(viewport)).toBe(320)
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


it.each(['following', 'reading', 'new conversation'] as const)('restores %s after the native terminal temporarily hides conversation layout', async mode => {
  const frames = new Map<number, FrameRequestCallback>(), observers: ResizeObserverCallback[] = []
  let serial = 0, height = 100, total = 600, latestTop = 450
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  const viewport = ref<HTMLElement | null>(null), content = ref<HTMLElement | null>(null), owner = ref('session-one'), active = ref(true)
  const root = document.createElement('div'), editor = document.createElement('input'); document.body.append(root, editor); editor.focus()
  const app = createApp({ setup() {
    useNativeTranscriptViewport({ viewport, content, owner: () => owner.value, active: () => active.value })
    return () => h('div', { ref: viewport }, h('div', { ref: content }, h('article', { 'data-message-id': 'latest-reply' })))
  } })
  const flush = () => { for (let i=0;i<3&&frames.size;i++){const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(0))} }
  app.mount(root)
  try {
    await nextTick();const element=viewport.value!,row=content.value!.firstElementChild!
    Object.defineProperties(element,{clientWidth:{get:()=>800},clientHeight:{get:()=>height},scrollHeight:{get:()=>total}})
    element.getBoundingClientRect=()=>({top:10}) as DOMRect
    row.getBoundingClientRect=()=>({top:10+latestTop-element.scrollTop,height:30}) as DOMRect
    element.scrollTop=450;observers.at(-1)!([],{} as ResizeObserver);flush();element.dispatchEvent(new Event('scroll'))
    if(mode!=='following'){element.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));element.scrollTop=100;element.dispatchEvent(new Event('scroll'))}
    // Navigation/layout can reflow the reading viewport before its scroll event and observer settle.
    // Keep the resulting visible position, rather than the pre-resize cached top.
    if(mode==='reading'){
      height=145;element.scrollTop=155;element.dispatchEvent(new Event('scroll'))
      observers.at(-1)!([],{} as ResizeObserver)
    }
    // v-show yields no geometry, and hidden message/layout work can clamp scrollTop to zero.
    height=0;element.scrollTop=0;active.value=false;await nextTick()
    latestTop=650;total=800
    if(mode==='new conversation'){owner.value='session-two';await nextTick()}
    height=150;active.value=true;await nextTick();flush()
    expect(element.scrollTop).toBe(mode==='reading'?155:650)
    expect(document.activeElement).toBe(editor)
    // A gesture before the queued return frames run wins over restored following.
    element.scrollTop=650;element.dispatchEvent(new Event('scroll'))
    height=0;element.scrollTop=0;active.value=false;await nextTick()
    height=150;active.value=true;await nextTick();expect(frames.size).toBe(1)
    element.dispatchEvent(new WheelEvent('wheel',{deltaY:-100}));element.scrollTop=80;element.dispatchEvent(new Event('scroll'))
    flush();expect(element.scrollTop).toBe(80);expect(frames.size).toBe(0)
    height=120;observers.at(-1)!([],{} as ResizeObserver);flush();expect(element.scrollTop).toBe(80)
  } finally { app.unmount();root.remove();editor.remove();vi.unstubAllGlobals() }
})
