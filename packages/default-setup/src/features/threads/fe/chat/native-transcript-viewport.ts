import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Prefer a complete short reply to trailing native placements when the pane cannot fit both. */
export function nativeTranscriptLatestTop(viewport: HTMLElement): number {
  const tail = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  const row = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].reverse()
    .find(element => element.getBoundingClientRect().height > 0)
  if (!row || !viewport.clientHeight) return tail
  const rowBounds = row.getBoundingClientRect()
  const body = row.querySelector<HTMLElement>('[data-chat-message-content]')?.getBoundingClientRect()
  // A pending request includes its inputs and decision buttons, beyond its short title.
  const pending = row.querySelector<HTMLElement>('[data-chat-pending-interaction]')
  const bounds = rowBounds.height > viewport.clientHeight && body && body.height > 0 && !pending?.getBoundingClientRect().height ? body : rowBounds
  const top = viewport.scrollTop + bounds.top - viewport.getBoundingClientRect().top
  if (top >= tail) return tail
  return Math.max(0, Math.min(tail, bounds.height <= viewport.clientHeight ? top : top + bounds.height - viewport.clientHeight))
}

/** A short upward read must not be mistaken for continued native tail following. */
export function isAtNativeTranscriptLatest(viewport: HTMLElement): boolean {
  return viewport.scrollTop >= nativeTranscriptLatestTop(viewport) - 1
}

/** Layout follows the selected latest reply; reader gestures and owner changes retire queued work. */
export function useNativeTranscriptViewport(options: {
  viewport: Ref<HTMLElement | null>
  content: Ref<HTMLElement | null>
  owner(): string | undefined
  active(): boolean
  onFollowingChange?(following: boolean): void
}) {
  let requestFollow: (() => void) | undefined, requestPause: (() => void) | undefined
  let disconnect: (() => void) | undefined, frame: number | undefined, epoch = 0
  let retained: { viewport: HTMLElement; content: HTMLElement; owner: string; following: boolean; top: number } | undefined, suspended = false
  const cancel = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined }
  watch([options.viewport, options.content, options.owner, options.active], ([viewport, content, owner, active]) => {
    disconnect?.(); disconnect = undefined; requestFollow = undefined; requestPause = undefined; cancel(); const current = ++epoch
    if (!viewport || !content || !owner) { retained = undefined; suspended = !active; return }
    if (!active) { suspended = true; return }
    const returning = suspended
    const resume = returning && retained?.viewport === viewport && retained.content === content ? retained : undefined
    suspended = false
    let width = viewport.clientWidth, height = viewport.clientHeight, top = viewport.scrollTop
    // A new identity has no reader position; hidden geometry cannot decide its intent.
    let following = resume ? resume.owner !== owner || resume.following : true, restoring = returning
    // Preserve reading through late native reflow until an explicit user action retires it.
    let readerTarget = resume?.owner === owner && !resume.following ? resume.top : undefined
    const setFollowing = (value: boolean) => { following = value; options.onFollowingChange?.(value) }
    setFollowing(following)
    const valid = () => epoch === current && options.viewport.value === viewport && options.owner() === owner && options.active() && viewport.clientHeight > 0
    const positionLatest = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => { frame = undefined; if (valid() && following) { viewport.scrollTop = nativeTranscriptLatestTop(viewport); top = viewport.scrollTop } })
    }
    const positionReader = () => {
      if (frame !== undefined) return
      frame = requestAnimationFrame(() => {
        frame = undefined
        if (valid() && !following && readerTarget !== undefined) { viewport.scrollTop = readerTarget; top = viewport.scrollTop }
      })
    }
    requestFollow = () => { readerTarget = undefined; setFollowing(true); positionLatest() }
    requestPause = () => { readerTarget = undefined; setFollowing(false); restoring = false; cancel(); if (valid()) top = viewport.scrollTop }
    const scrolled = () => {
      if (!restoring && valid()) {
        if (readerTarget !== undefined) { positionReader(); return }
        // Upward reading intent survives while the short latest body is still visible.
        if (viewport.clientWidth === width && viewport.clientHeight === height && !following && viewport.scrollTop > top) setFollowing(isAtNativeTranscriptLatest(viewport))
        // Browser anchoring can move a reader during reflow before ResizeObserver runs.
        top = viewport.scrollTop
      }
    }
    const reading = (event: Event) => {
      if (event instanceof WheelEvent && event.deltaY >= 0) { readerTarget = undefined; restoring = false; cancel(); return }
      if (event instanceof KeyboardEvent && !['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
        if (['ArrowDown', 'PageDown', 'End'].includes(event.key)) { readerTarget = undefined; restoring = false; cancel() }
        return
      }
      requestPause?.()
    }
    const resize = new ResizeObserver(() => {
      if (!valid()) return
      width = viewport.clientWidth; height = viewport.clientHeight
      if (restoring) return
      if (!following) { if (readerTarget !== undefined) positionReader(); else top = viewport.scrollTop; return }
      positionLatest()
    })
    resize.observe(viewport); resize.observe(content)
    viewport.addEventListener('scroll', scrolled, { passive: true })
    for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.addEventListener(name, reading, { passive: true })
    disconnect = () => {
      retained = { viewport, content, owner, following, top }
      resize.disconnect(); viewport.removeEventListener('scroll', scrolled)
      for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.removeEventListener(name, reading)
    }
    if (returning) {
      // Hidden DOM has no usable scroll geometry. Restore only this view's intent,
      // after layout and async message bodies settle; a reader gesture cancels both passes.
      const restore = () => {
        frame = undefined
        if (!valid() || !restoring) return
        viewport.scrollTop = following ? nativeTranscriptLatestTop(viewport) : resume ? resume.top : top
        top = viewport.scrollTop
      }
      frame = requestAnimationFrame(() => {
        restore()
        if (valid() && restoring) frame = requestAnimationFrame(() => { restore(); restoring = false })
      })
    }
  }, { flush: 'post' })
  onBeforeUnmount(() => { epoch++; requestFollow = undefined; requestPause = undefined; disconnect?.(); cancel() })
  return { followLatest: () => requestFollow?.(), pauseFollowing: () => requestPause?.() }
}
