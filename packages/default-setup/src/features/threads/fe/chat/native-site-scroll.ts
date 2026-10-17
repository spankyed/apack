import { watch, onBeforeUnmount, nextTick, type Ref } from 'vue'
import type { ClaudeUiScrollEvent, ClaudeUiScrollState } from '#generated/types.ts'

/** Mirror one native window; programmatic offsets never feed back as person gestures. */
export function useClaudeSiteScroll(options: {
  element: Ref<HTMLElement | null>
  state(): ClaudeUiScrollState | undefined
  paneId?(): string | undefined
  emit(event: ClaudeUiScrollEvent): void
}) {
  let revision = 0, lastSent = 0, appliedSerial = 0, lastOffset = 0, pendingBy = 0
  let followEnd = false, suppressedTop: number | undefined
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
    if (state.requestRevision !== undefined && state.requestRevision < lastSent) return
    if (state.requestRevision === undefined) pendingBy = 0
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
    const offset = Math.max(0, Math.floor(element.scrollTop / line)), by = pendingBy
    pendingBy = 0; lastOffset = offset; lastSent = ++revision
    options.emit({ ...(options.paneId?.() ? { paneId: options.paneId() } : {}), revision, offset, by,
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
  function cleanup() {
    removeListener(); observer?.disconnect(); observer = undefined; mutations?.disconnect(); mutations = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined; pendingBy = 0
  }
  watch([() => options.element.value, () => options.paneId?.()], ([element]) => {
    cleanup(); appliedSerial = 0; lastOffset = 0; followEnd = false; suppressedTop = undefined
    if (!element) return
    element.addEventListener('scroll', scrolled, { passive: true }); removeListener = () => element.removeEventListener('scroll', scrolled)
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
  return { reveal(top: number) { setTop(top) }, reportLayout: schedule }
}
