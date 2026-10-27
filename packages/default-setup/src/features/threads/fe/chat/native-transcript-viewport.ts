import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Prefer a complete short reply to trailing native placements when the pane cannot fit both. */
export function nativeTranscriptLatestTop(viewport: HTMLElement): number {
  const tail = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const row = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].reverse()
    .find(element => element.getBoundingClientRect().height > 0)
  if (!row || !viewport.clientHeight) return tail
  const bounds = row.getBoundingClientRect(), top = viewport.scrollTop + bounds.top - viewport.getBoundingClientRect().top
  if (top >= tail) return tail
  return Math.max(0, Math.min(tail, bounds.height <= viewport.clientHeight ? top : top + bounds.height - viewport.clientHeight))
}

/** Layout follows the selected latest reply; reader gestures and owner changes retire queued work. */
export function useNativeTranscriptViewport(options: {
  viewport: Ref<HTMLElement | null>
  content: Ref<HTMLElement | null>
  owner(): string | undefined
  active(): boolean
}) {
  let disconnect: (() => void) | undefined, frame: number | undefined, epoch = 0
  const cancel = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined }
  watch([options.viewport, options.content, options.owner, options.active], ([viewport, content, owner, active]) => {
    disconnect?.(); disconnect = undefined; cancel(); const current = ++epoch
    if (!viewport || !content || !owner || !active) return
    let width = viewport.clientWidth, height = viewport.clientHeight
    let following = viewport.scrollTop >= nativeTranscriptLatestTop(viewport) - 1
    const valid = () => epoch === current && options.viewport.value === viewport && options.owner() === owner && options.active() && viewport.clientHeight > 0
    const scrolled = () => {
      if (valid() && viewport.clientWidth === width && viewport.clientHeight === height) following = viewport.scrollTop >= nativeTranscriptLatestTop(viewport) - 1
    }
    const reading = (event: Event) => {
      if (event instanceof WheelEvent && event.deltaY >= 0) return
      if (event instanceof KeyboardEvent && !['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return
      following = false; cancel()
    }
    const resize = new ResizeObserver(() => {
      if (!valid()) return
      const changed = width !== viewport.clientWidth || height !== viewport.clientHeight
      width = viewport.clientWidth; height = viewport.clientHeight
      if (!changed) { following = viewport.scrollTop >= nativeTranscriptLatestTop(viewport) - 1; return }
      if (!following || frame !== undefined) return
      frame = requestAnimationFrame(() => { frame = undefined; if (valid() && following) viewport.scrollTop = nativeTranscriptLatestTop(viewport) })
    })
    resize.observe(viewport); resize.observe(content)
    viewport.addEventListener('scroll', scrolled, { passive: true })
    for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.addEventListener(name, reading, { passive: true })
    disconnect = () => {
      resize.disconnect(); viewport.removeEventListener('scroll', scrolled)
      for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.removeEventListener(name, reading)
    }
  }, { flush: 'post' })
  onBeforeUnmount(() => { epoch++; disconnect?.(); cancel() })
}
