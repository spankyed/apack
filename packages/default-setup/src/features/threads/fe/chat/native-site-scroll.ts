import { watch, onBeforeUnmount, nextTick, type Ref } from 'vue'
import type { ClaudeUiScrollEvent, ClaudeUiScrollState } from '#generated/types.ts'

/** Mirror one native window: native offsets do not echo; local gestures and focus reveals are reported. */
export function useClaudeSiteScroll(options: {
  element: Ref<HTMLElement | null>
  cellWidth?(): number
  state(): ClaudeUiScrollState | undefined
  paneId?(): string | undefined
  emit(event: ClaudeUiScrollEvent): void
}) {
  let revision = 0, lastSent = 0, appliedSerial = 0, lastOffset = 0, pendingBy = 0
  let pendingPointer: ClaudeUiScrollEvent['pointer']
  let followEnd = false, suppressedTop: number | undefined, lastLayout: string | undefined
  let frame: number | undefined, observer: ResizeObserver | undefined, mutations: MutationObserver | undefined, removeListener = () => {}
  const rowHeight = () => Number.parseFloat(options.element.value ? getComputedStyle(options.element.value).lineHeight : '') || 20
  function setTop(top: number) {
    const element = options.element.value
    if (!element) return
    element.scrollTop = top
    suppressedTop = element.scrollTop
    lastOffset = Math.max(0, Math.floor(element.scrollTop / rowHeight()))
  }
  function apply() {
    const state = options.state(), element = options.element.value
    if (!element || !state || state.serial <= appliedSerial) return
    appliedSerial = state.serial
    if (state.requestRevision !== undefined && (state.requestRevision < lastSent || pendingBy !== 0)) return
    if (state.requestRevision === undefined) { pendingBy = 0; pendingPointer = undefined }
    followEnd = state.followEnd
    if (state.requestRevision !== undefined && !followEnd && state.offset === Math.floor(element.scrollTop / rowHeight())) return
    setTop(followEnd ? Math.max(0, element.scrollHeight - element.clientHeight) : state.offset * rowHeight())
  }
  function report() {
    frame = undefined
    const element = options.element.value
    if (!element || element.clientHeight <= 0) return
    if (followEnd && pendingBy === 0) setTop(Math.max(0, element.scrollHeight - element.clientHeight))
    const line = rowHeight(), bounds = element.getBoundingClientRect()
    const keyed = [...element.querySelectorAll<HTMLElement>('[data-native-scroll-id]')].flatMap(item => {
      const rect = item.getBoundingClientRect(), id = item.dataset.nativeScrollId
      return id && rect.height > 0 && rect.width > 0 ? [{ id, top: Math.max(0, Math.floor((rect.top - bounds.top + element.scrollTop) / line)), bottom: Math.max(0, Math.ceil((rect.bottom - bounds.top + element.scrollTop) / line)) }] : []
    }).slice(0, 512)
    const offset = Math.max(0, Math.floor(element.scrollTop / line)), by = pendingBy, pointer = pendingPointer
    pendingBy = 0; pendingPointer = undefined; lastOffset = offset
    const layout = JSON.stringify({ paneId: options.paneId?.(), offset, rows: Math.floor(element.clientHeight / line), contentRows: Math.ceil(element.scrollHeight / line), keyed })
    if (by === 0 && layout === lastLayout) return
    lastLayout = layout; lastSent = ++revision
    options.emit({ ...(options.paneId?.() ? { paneId: options.paneId() } : {}), revision, offset, by, ...(pointer ? { pointer } : {}),
      rows: Math.max(0, Math.floor(element.clientHeight / line)), contentRows: Math.max(0, Math.ceil(element.scrollHeight / line)), keyed })
  }
  function schedule() { if (frame === undefined) frame = requestAnimationFrame(report) }
  function scrolled() {
    const element = options.element.value
    if (!element) return
    if (suppressedTop !== undefined && Math.abs(element.scrollTop - suppressedTop) < 1) { suppressedTop = undefined; return }
    suppressedTop = undefined
    const offset = Math.max(0, Math.floor(element.scrollTop / rowHeight()))
    pendingBy += offset - lastOffset; lastOffset = offset
    // A real gesture away from the bottom releases local pinning; native decides the final mode.
    if (element.scrollTop < element.scrollHeight - element.clientHeight - 1) followEnd = false
    schedule()
  }
  function move(by: number, pointer?: ClaudeUiScrollEvent['pointer']) {
    const element = options.element.value
    if (!element || !Number.isSafeInteger(by) || !by) return
    followEnd = false; pendingBy += by; pendingPointer = pointer
    setTop(Math.max(0, Math.min(element.scrollHeight - element.clientHeight, element.scrollTop + by * rowHeight())))
    schedule()
  }
  function wheel(event: WheelEvent) {
    const element = options.element.value
    if (!element || event.defaultPrevented || event.ctrlKey || event.metaKey || !Number.isFinite(event.deltaY) || !event.deltaY) return
    // Let a field or nested document consume its own wheel before scrolling the native site.
    for (let target = event.target instanceof HTMLElement ? event.target : null; target && target !== element; target = target.parentElement) {
      if (target instanceof HTMLSelectElement) return
      const style = getComputedStyle(target)
      if ((target instanceof HTMLTextAreaElement || /auto|scroll/.test(style.overflowY)) && target.scrollHeight > target.clientHeight
        && (event.deltaY < 0 ? target.scrollTop > 0 : target.scrollTop < target.scrollHeight - target.clientHeight)) return
    }
    const line = rowHeight(), bounds = element.getBoundingClientRect(), cell = options.cellWidth?.() || line / 2
    const amount = event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * Math.max(1, Math.floor(element.clientHeight / line)) : event.deltaY / line
    const by = Math.sign(amount) * Math.max(1, Math.round(Math.abs(amount)))
    if (!Number.isSafeInteger(by)) return
    event.preventDefault()
    move(by, { column: Math.floor((event.clientX - bounds.left - element.clientLeft) / cell), row: Math.floor((event.clientY - bounds.top - element.clientTop) / line) })
  }
  function key(event: KeyboardEvent) {
    const element = options.element.value
    if (!element || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return
    const rows = Math.max(1, Math.floor(element.clientHeight / rowHeight())), content = Math.max(1, Math.ceil(element.scrollHeight / rowHeight()))
    const by = ({ ArrowUp: -1, ArrowDown: 1, PageUp: -rows, PageDown: rows, Home: -content, End: content } as Record<string, number>)[event.key]
    if (by === undefined) return
    event.preventDefault(); event.stopPropagation(); move(by)
  }
  function cleanup() {
    removeListener(); observer?.disconnect(); observer = undefined; mutations?.disconnect(); mutations = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined; pendingBy = 0; pendingPointer = undefined
  }
  watch([() => options.element.value, () => options.paneId?.()], ([element]) => {
    cleanup(); lastLayout = undefined; appliedSerial = 0; lastOffset = 0; followEnd = false; suppressedTop = undefined
    if (!element) return
    element.addEventListener('scroll', scrolled, { passive: true }); element.addEventListener('wheel', wheel, { passive: false }); element.addEventListener('keydown', key)
    removeListener = () => { element.removeEventListener('scroll', scrolled); element.removeEventListener('wheel', wheel); element.removeEventListener('keydown', key) }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule); observer.observe(element)
      const content = element.querySelector('[data-native-scroll-content]'); if (content) observer.observe(content)
    }
    if (typeof MutationObserver !== 'undefined') {
      mutations = new MutationObserver(schedule)
      const content = element.querySelector('[data-native-scroll-content]')
      if (content) mutations.observe(content, { childList: true, subtree: true, characterData: true, attributes: true })
    }
    apply(); void nextTick(schedule)
  }, { flush: 'post', immediate: true })
  watch(options.state, apply, { flush: 'post' })
  onBeforeUnmount(cleanup)
  return { reveal(top: number) {
    const before = lastOffset
    pendingPointer = undefined
    followEnd = false; setTop(top)
    pendingBy += lastOffset - before
    schedule()
  }, reportLayout: schedule }
}
