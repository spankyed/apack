import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Recognize only the open listbox addressed by a native Select in this site. */
export function nativeSelectTrigger(site: HTMLElement | null, target: EventTarget | null): HTMLElement | undefined {
  const popup = target instanceof Element ? target.closest('[role="listbox"][data-state="open"]') : null
  if (!site || !popup?.id) return
  return [...site.querySelectorAll<HTMLElement>('[role="combobox"][data-native-focus-id]')]
    .find(element => element.getAttribute('aria-controls') === popup.id)
}

export function useNativeSelectFocus(site: Ref<HTMLElement | null>, release: () => void, acquire: (target: HTMLElement) => void, boundary = site) {
  let trigger: HTMLElement | undefined, suspended: HTMLElement | undefined
  function reset() { trigger = undefined; suspended = undefined }
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
    const owner = trigger
    if (!owner) return
    release()
    suspended = owner
  }
  function restore() {
    const owner = suspended
    suspended = undefined
    if (!owner || !document.hasFocus() || nativeSelectTrigger(site.value, document.activeElement) !== owner) return
    trigger = owner
    acquire(owner)
  }
  onMounted(() => {
    document.addEventListener('focusin', focusElsewhere, true)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', restore)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('focusin', focusElsewhere, true)
    window.removeEventListener('blur', blur)
    window.removeEventListener('focus', restore)
  })
  return { entersPopup, returnsToTrigger, reset }
}
