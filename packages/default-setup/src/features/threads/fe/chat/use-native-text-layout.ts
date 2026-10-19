import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch, type InjectionKey, type Ref } from 'vue'
import type { ClaudeUiNode } from '#features/code/be/services/claude-code/ui-presentation.ts'
import { claudeInlineText, claudeTextCut, cutClaudeTextNode, type ClaudeTextCut } from './native-text-layout.ts'

export const claudeInlineTextParent: InjectionKey<Readonly<Ref<boolean>>> = Symbol('claude-inline-text-parent')

/** Measure original inline spans in their actual font, independently of the clipped drawing. */
export function useClaudeTextLayout(node: () => ClaudeUiNode, nested: Readonly<Ref<boolean>>, paint: () => unknown) {
  const element = shallowRef<HTMLElement>(), cut = shallowRef<ClaudeTextCut>(), naturalWidth = ref<number>()
  let observer: ResizeObserver | undefined, measurement: HTMLElement | undefined, epoch = 0, disposed = false
  let measureRange: ((start: number, end: number) => number) | undefined, ellipsisWidth = 0
  const mode = computed(() => { const value = node(); return value.kind === 'text' && !nested.value ? value.style?.wrap ?? 'wrap' : 'wrap' })
  const display = computed(() => { const value = node(); return value.kind === 'text' && cut.value ? cutClaudeTextNode(value, cut.value) : value })
  const layout = computed(() => nested.value ? { whiteSpace: 'inherit' as const, overflowWrap: 'inherit' as const } : mode.value === 'wrap'
    ? { whiteSpace: 'pre-wrap' as const, overflowWrap: 'anywhere' as const }
    : { display: 'block', minWidth: '0', maxWidth: '100%', width: naturalWidth.value === undefined ? undefined : `${naturalWidth.value}px`, flexShrink: 1, whiteSpace: 'pre' as const, overflow: 'hidden', overflowWrap: 'normal' as const })
  function measure() {
    const host = element.value, value = node(), text = claudeInlineText(value)
    if (!host || !measureRange || text === undefined || mode.value === 'wrap') return
    const width = host.getBoundingClientRect().width
    if (width <= 0) return
    cut.value = claudeTextCut(text, width, mode.value, measureRange, ellipsisWidth)
  }
  function clearMeasurement() { measurement?.remove(); measurement = undefined; measureRange = undefined }
  async function refresh() {
    const revision = ++epoch
    observer?.disconnect(); observer = undefined; clearMeasurement(); cut.value = undefined; naturalWidth.value = undefined
    if (mode.value === 'wrap' || claudeInlineText(node()) === undefined) return
    await nextTick()
    if (disposed || revision !== epoch || !element.value) return
    const host = element.value, text = claudeInlineText(node())!
    const clone = host.cloneNode(true) as HTMLElement
    const originals = [host, ...host.querySelectorAll<HTMLElement>('*')], copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
    originals.forEach((original, index) => {
      const copy = copies[index]!, style = getComputedStyle(original)
      copy.style.font = style.font; copy.style.fontVariantNumeric = style.fontVariantNumeric; copy.style.fontFeatureSettings = style.fontFeatureSettings; copy.style.fontKerning = style.fontKerning
      copy.style.letterSpacing = style.letterSpacing; copy.style.wordSpacing = style.wordSpacing; copy.style.textTransform = style.textTransform; copy.style.direction = style.direction
      copy.removeAttribute('id')
    })
    Object.assign(clone.style, { position: 'fixed', left: '-100000px', top: '0', width: 'max-content', maxWidth: 'none', minWidth: '0', overflow: 'visible', visibility: 'hidden', pointerEvents: 'none' })
    clone.inert = true; clone.setAttribute('aria-hidden', 'true'); document.body.append(clone); measurement = clone
    if (clone.textContent !== text) { clearMeasurement(); return }
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT), leaves: { node: Text; start: number; end: number }[] = []
    let next: Node | null, offset = 0
    while ((next = walker.nextNode())) { const leaf = next as Text; leaves.push({ node: leaf, start: offset, end: offset + leaf.length }); offset += leaf.length }
    measureRange = (start, end) => {
      if (end <= start || !leaves.length) return 0
      const first = leaves.find(leaf => leaf.end > start), last = leaves.find(leaf => leaf.end >= end)
      if (!first || !last) return 0
      const range = document.createRange(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start)
      return range.getBoundingClientRect().width
    }
    const ellipsis = document.createElement('span'); ellipsis.textContent = '…'; clone.append(ellipsis)
    ellipsisWidth = ellipsis.getBoundingClientRect().width; ellipsis.remove()
    naturalWidth.value = measureRange(0, text.length)
    await nextTick()
    if (disposed || revision !== epoch) return
    observer = new ResizeObserver(measure); observer.observe(host); measure()
  }
  watch([node, nested, element, paint], refresh, { flush: 'post' })
  const fontsChanged = () => { void refresh() }
  document.fonts?.addEventListener('loadingdone', fontsChanged)
  onBeforeUnmount(() => { disposed = true; epoch++; observer?.disconnect(); clearMeasurement(); document.fonts?.removeEventListener('loadingdone', fontsChanged) })
  return { element, display, layout }
}
