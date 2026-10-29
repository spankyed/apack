import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

export interface ClaudeAgentScrollPosition {
  following: boolean
  top: number
  anchor?: { uuid: string; offset: number }
}

/** Follow output until a reader scrolls away; retain a native message across layout changes. */
export function useClaudeAgentScroll(options: {
  viewport: Ref<HTMLElement | undefined>
  content: Ref<HTMLElement | undefined>
  active: () => boolean
  initial?: ClaudeAgentScrollPosition
  save(position: ClaudeAgentScrollPosition): void
}) {
  let position: ClaudeAgentScrollPosition = options.initial ?? { following: true, top: 0 }
  const following = ref(position.following)
  let frame: number | undefined, intentUntil = 0, pointer = false, intentRevision = 0
  let disconnect: (() => void) | undefined
  function capture() {
    const element = options.viewport.value
    if (!element || !options.active() || !element.clientHeight) return
    const bounds = element.getBoundingClientRect()
    const first = [...element.querySelectorAll<HTMLElement>('[data-native-agent-message]')]
      .find(item => item.getBoundingClientRect().bottom > bounds.top)
    position = { following: following.value, top: element.scrollTop,
      ...(first ? { anchor: { uuid: first.dataset.nativeAgentMessage!, offset: first.getBoundingClientRect().top - bounds.top } } : {}) }
    options.save(position)
  }
  function reconcile() {
    frame = undefined
    const element = options.viewport.value
    if (!element || !options.active() || !element.clientHeight || !element.querySelector('[data-native-agent-message]')) return
    if (following.value) element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    else {
      const anchor = [...element.querySelectorAll<HTMLElement>('[data-native-agent-message]')]
        .find(item => item.dataset.nativeAgentMessage === position.anchor?.uuid)
      element.scrollTop = anchor && position.anchor
        ? element.scrollTop + anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - position.anchor.offset
        : position.top
    }
    // Keep the requested reading anchor while native frames hydrate or temporarily shrink.
    // Only a reader gesture may replace it with a newly chosen position.
    if (following.value) capture()
  }
  function schedule() { if (frame === undefined) frame = requestAnimationFrame(reconcile) }
  function intent(event: Event) {
    if (event instanceof KeyboardEvent && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return
    intentUntil = performance.now() + 500; intentRevision++
    if (event.type === 'pointerdown') pointer = true
    // Release the tail before the browser applies an upward gesture.
    if ((event instanceof WheelEvent && event.deltaY < 0) || (event instanceof KeyboardEvent && ['ArrowUp', 'PageUp', 'Home'].includes(event.key))) {
      following.value = false; capture()
    }
  }
  function released() { pointer = false }
  function scrolled() {
    const element = options.viewport.value
    if (!element || !options.active() || !element.clientHeight) return
    if (pointer || performance.now() < intentUntil) {
      following.value = element.scrollHeight - element.clientHeight - element.scrollTop <= 24
      capture()
    } else schedule()
  }
  function latest(expectedIntent?: number) {
    if (expectedIntent !== undefined && expectedIntent !== intentRevision) return
    following.value = true; intentUntil = 0; pointer = false; schedule()
  }
  watch([options.viewport, options.content], ([viewport, content]) => {
    disconnect?.()
    if (!viewport || !content) return
    const resize = new ResizeObserver(schedule), mutation = new MutationObserver(schedule)
    resize.observe(viewport); resize.observe(content)
    mutation.observe(content, { childList: true, subtree: true, characterData: true })
    viewport.addEventListener('scroll', scrolled, { passive: true })
    for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.addEventListener(name, intent, { passive: true })
    window.addEventListener('pointerup', released); window.addEventListener('pointercancel', released)
    disconnect = () => {
      resize.disconnect(); mutation.disconnect(); viewport.removeEventListener('scroll', scrolled)
      for (const name of ['wheel', 'pointerdown', 'touchstart', 'keydown']) viewport.removeEventListener(name, intent)
      window.removeEventListener('pointerup', released); window.removeEventListener('pointercancel', released)
    }
    schedule()
  }, { flush: 'post' })
  watch(options.active, active => { if (active) schedule() })
  onBeforeUnmount(() => { disconnect?.(); if (frame !== undefined) cancelAnimationFrame(frame) })
  return { following, latest, intentRevision: () => intentRevision }
}
