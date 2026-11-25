import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Recognize only the open listbox addressed by a native Select in this site. */
export function nativeSelectTrigger(site: HTMLElement | null, target: EventTarget | null): HTMLElement | undefined {
  const popup = target instanceof Element ? target.closest('[role="listbox"][data-state="open"]') : null
  if (!site || !popup?.id) return
  return [...site.querySelectorAll<HTMLElement>('[role="combobox"][data-native-focus-id]')]
    .find(element => element.getAttribute('aria-controls') === popup.id)
}

export function useNativeSelectFocus(site: Ref<HTMLElement | null>, release: () => void, boundary = site) {
  let trigger: HTMLElement | undefined
  function reset() { trigger = undefined }
  function entersPopup(target: EventTarget | null): boolean {
    trigger = nativeSelectTrigger(site.value, target)
    return !!trigger
  }
  function returnsToTrigger(target: EventTarget | null): boolean {
    const returning = trigger !== undefined && trigger === target
    reset()
    return returning
  }
  // The portalled listbox does not bubble focus back through its owning site.
  function focusElsewhere(event: FocusEvent) {
    const target = event.target
    if (!trigger || !(target instanceof Node) || site.value?.contains(target) || nativeSelectTrigger(site.value, target) === trigger) return
    reset()
    if (!boundary.value?.contains(target)) release()
  }
  function blur() {
    if (!trigger) return
    reset()
    release()
  }
  onMounted(() => {
    document.addEventListener('focusin', focusElsewhere, true)
    window.addEventListener('blur', blur)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', focusElsewhere, true)
    window.removeEventListener('blur', blur)
  })
  return { entersPopup, returnsToTrigger, reset }
}
