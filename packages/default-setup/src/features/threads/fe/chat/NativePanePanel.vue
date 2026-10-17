<template>
  <section ref="panel" data-native-pane-panel @keydown="panelKey" class="min-h-0 shrink-0 border-b border-white/[0.06] bg-[#202022] px-5 py-3" aria-label="Claude panes">
    <div class="mb-3 flex items-center gap-2 border-b border-white/[0.05] pb-2">
      <div v-if="panes.roster.panes.length > 1" class="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Claude pane tabs">
        <button v-for="pane in panes.roster.panes" :key="pane.id" type="button" role="tab" :aria-selected="pane.id === shown" :tabindex="pane.id === shown ? 0 : -1"
          class="max-w-48 shrink-0 truncate rounded-md border border-transparent px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" :class="{ '!border-white/[0.08] bg-white/[0.06] !text-neutral-100': pane.id === shown }"
          @click="emit('operate', { kind: 'show', id: pane.id })" @keydown="tabKey($event, pane.id)">{{ pane.title }}</button>
      </div>
      <span v-else class="flex-1 truncate text-xs font-medium text-neutral-300">{{ title }}</span>
      <button v-if="preferredRows !== undefined" type="button" class="rounded p-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" aria-label="Use requested pane height" title="Use requested pane height" @click="emit('resize', undefined)"><RotateCcw :size="12" /></button>
      <button type="button" class="rounded p-1 text-neutral-500 hover:bg-white/[0.06] hover:text-neutral-200 focus-visible:outline focus-visible:outline-blue-400" :aria-label="`Close ${title}`" @click="emit('operate', { kind: 'close', id: shown })"><X :size="14" /></button>
    </div>
    <div ref="site" class="native-pane-surface min-h-10 min-w-0 overflow-auto text-[13px] leading-5 outline-none" :style="{ height: `${bodyRows * rowPixels}px` }" role="tabpanel" :aria-label="title" tabindex="0"
      @focusin="focusIn" @focusout="focusOut" @compositionstart="composing = true" @compositionend="composing = false"
      @keydown="siteKey" @pointerover="hover.point" @pointermove="hover.point" @pointerleave="hover.leave">
      <div data-native-scroll-content><NativeUiNode v-if="panes.body.status === 'live'" :node="panes.body.tree" @press="(id, href) => emit('press', id, href)" @field="emit('field', $event)" />
      <p v-else-if="panes.body.status === 'error'" role="status" class="text-xs text-neutral-500">Claude pane unavailable</p>
      <span v-else class="text-xs text-neutral-500" role="status">Loading pane…</span></div>
    </div>
    <div role="separator" aria-label="Resize Claude pane" aria-orientation="horizontal" tabindex="0"
      :aria-valuemin="minRows" :aria-valuemax="maxRows" :aria-valuenow="bodyRows" :aria-valuetext="`${bodyRows} rows`"
      class="group -mx-5 -mb-3 mt-2 flex h-3 touch-none select-none items-center justify-center cursor-row-resize rounded-sm outline-none focus-visible:bg-blue-400/10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400/60"
      @pointerdown="startResize" @pointermove="moveResize" @pointerup="endResize" @pointercancel="endResize" @lostpointercapture="endResize" @keydown="resizeKey">
      <span aria-hidden="true" class="h-0.5 w-8 rounded-full bg-white/10 transition-colors group-hover:bg-white/30 group-focus-visible:bg-blue-400/60" />
    </div>
    <span ref="measure" data-pane-cell-measure aria-hidden="true" class="pointer-events-none invisible fixed -left-[9999px] whitespace-pre font-mono text-[13px]">0000000000</span>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, provide, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { X, RotateCcw } from 'lucide-vue-next'
import type { ClaudeUiPanePresentation, ClaudeUiPaneEvent, ClaudeUiFocusEvent, ClaudeUiFocusReply, ClaudeUiFieldEvent } from '#generated/types.ts'
import { useClaudeSiteScroll } from './native-site-scroll.ts'
import NativeUiNode from './NativeUiNode.vue'
import { createClaudeHoverSurface, claudeHoverSurface } from './native-ui-hover.ts'
import { pressClaudeUiHotkey } from './native-ui-hotkeys.ts'
const props = defineProps<{ panes: ClaudeUiPanePresentation; focus?: ClaudeUiFocusReply; grantFocus?: string | null; preferredRows?: number }>()
const emit = defineEmits<{ resize: [rows: number | undefined]; operate: [event: ClaudeUiPaneEvent]; press: [id: string, href?: string]; field: [event: ClaudeUiFieldEvent]; 'focus-report': [event: ClaudeUiFocusEvent]; 'return-focus': []; scroll: [event: import('#generated/types.ts').ClaudeUiScrollEvent] }>()
const shown = computed(() => props.panes.roster.shown_id)
const activePane = computed(() => props.panes.roster.panes.find(pane => pane.id === shown.value))
const title = computed(() => activePane.value?.title ?? 'Claude pane')
const minRows = 2, rowPixels = ref(20), availableHeight = ref(768)
// The surface reserves space for the composer, toolbar and pane header before granting body rows.
const maxRows = computed(() => Math.max(minRows, Math.floor((availableHeight.value - 200) / rowPixels.value)))
const bodyRows = computed(() => Math.max(minRows, Math.min(maxRows.value, props.preferredRows ?? activePane.value?.rows ?? Math.floor(availableHeight.value / rowPixels.value / 3))))
let drag: { id: number; y: number; rows: number; element: HTMLElement } | undefined
function startResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  drag = { id: event.pointerId, y: event.clientY, rows: bodyRows.value, element }
  element.setPointerCapture?.(event.pointerId)
}
function moveResize(event: PointerEvent) {
  if (!drag || drag.id !== event.pointerId) return
  event.preventDefault()
  emit('resize', Math.max(minRows, Math.min(maxRows.value, Math.round(drag.rows + (event.clientY - drag.y) / rowPixels.value))))
}
function endResize() {
  const previous = drag; drag = undefined
  if (previous?.element.hasPointerCapture?.(previous.id)) previous.element.releasePointerCapture(previous.id)
}
function resizeKey(event: KeyboardEvent) {
  if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
  const rows = ({ ArrowUp: bodyRows.value - 1, ArrowDown: bodyRows.value + 1, PageUp: bodyRows.value - 4, PageDown: bodyRows.value + 4, Home: minRows, End: maxRows.value } as Record<string, number>)[event.key]
  if (rows === undefined) return
  event.preventDefault(); event.stopPropagation(); emit('resize', Math.max(minRows, Math.min(maxRows.value, rows)))
}
const site = ref<HTMLElement | null>(null)
const scroll = useClaudeSiteScroll({ element: site, cellWidth: () => (measure.value?.getBoundingClientRect().width ?? 0) / 10, state: () => props.panes.scroll, paneId: () => shown.value ?? undefined, emit: event => emit('scroll', event) })
const panel = ref<HTMLElement | null>(null), measure = ref<HTMLElement | null>(null)
const hover = createClaudeHoverSurface(); provide(claudeHoverSurface, hover); onBeforeUnmount(() => hover.dispose())
let revision = 0, applying = false, held = false, autoEntering = false
let consumedGrant: string | null = null
const composing = ref(false)
function focusIn(event: FocusEvent) {
  if (applying || !shown.value || !site.value || event.target !== document.activeElement) return
  held = true
  const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-native-focus-id]') : null
  emit('focus-report', { paneId: shown.value, revision: ++revision, isHeld: true, focusId: target?.dataset.nativeFocusId ?? null, by: autoEntering ? 'auto' : 'person' })
}
function focusOut(event: FocusEvent) {
  if (!held || applying || panel.value?.contains(event.relatedTarget as Node | null) || !shown.value) return
  held = false; emit('focus-report', { paneId: shown.value, revision: ++revision, isHeld: false, by: 'person' })
}
function panelKey(event: KeyboardEvent) { if (!site.value?.contains(event.target as Node)) siteKey(event) }
function siteKey(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if (event.key === 'Tab') event.stopPropagation()
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation()
    if (activePane.value?.close_on_escape) emit('operate', { kind: 'close', id: shown.value })
    else { emit('operate', { kind: 'focus', id: null }); emit('return-focus') }
    return
  }
  pressClaudeUiHotkey(event, site.value)
}
function tabKey(event: KeyboardEvent, id: string) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const panes = props.panes.roster.panes, index = panes.findIndex(pane => pane.id === id)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? panes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length
  event.preventDefault(); event.stopPropagation(); emit('operate', { kind: 'show', id: panes[next].id })
  const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]'); tabs?.[next]?.focus()
}
function reportLayout() {
  const element = site.value, id = shown.value, cell = (measure.value?.getBoundingClientRect().width ?? 0) / 10
  if (!element || !id || cell <= 0 || element.clientHeight <= 0) return
  const line = Number.parseFloat(getComputedStyle(element).lineHeight) || 20
  emit('operate', { kind: 'layout', id, columns: Math.max(1, Math.floor(element.clientWidth / cell)), rows: Math.max(1, Math.floor(element.clientHeight / line)), offset: Math.max(0, Math.floor(element.scrollTop / line)) })
}
let observer: ResizeObserver | undefined
onMounted(() => {
  const area = panel.value?.closest<HTMLElement>('[data-testid="chat-composer-area"]')
  const update = () => {
    availableHeight.value = area?.clientHeight || window.innerHeight || 768
    rowPixels.value = Number.parseFloat(site.value ? getComputedStyle(site.value).lineHeight : '') || 20
    reportLayout()
  }
  observer = new ResizeObserver(update); if (site.value) observer.observe(site.value); if (area) observer.observe(area)
  update()
})
onBeforeUnmount(() => { endResize(); observer?.disconnect() })
watch(shown, () => { held = false; void nextTick(reportLayout) })
watch([() => props.panes.roster.focused_id, () => props.grantFocus, () => props.panes.body.status], async ([id, grant, status]) => {
  if (!grant) consumedGrant = null
  if (!id || id !== grant || consumedGrant === grant || id !== shown.value || status !== 'live' || !document.hasFocus()) return
  await nextTick()
  if (props.grantFocus !== grant || props.panes.roster.focused_id !== id || !document.hasFocus()) return
  const element = site.value
  if (!element || element.contains(document.activeElement) || panel.value?.contains(document.activeElement)) return
  consumedGrant = grant
  autoEntering = true
  try { (element.querySelector<HTMLElement>('[data-native-autofocus="true"]') ?? element).focus() } finally { autoEntering = false }
})
watch(() => props.focus, reply => {
  const element = site.value
  if (!reply || reply.paneId !== shown.value || reply.revision !== revision || !held || composing.value || !element?.contains(document.activeElement) || !document.hasFocus()) return
  const target = reply.focusId === null ? element : [...element.querySelectorAll<HTMLElement>('[data-native-focus-id]')].find(item => item.dataset.nativeFocusId === reply.focusId)
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return
  applying = true
  try {
    target.focus({ preventScroll: true })
    const bounds = element.getBoundingClientRect(), control = target.getBoundingClientRect()
    if (control.top < bounds.top) scroll.reveal(element.scrollTop + control.top - bounds.top)
    else if (control.bottom > bounds.bottom) scroll.reveal(element.scrollTop + control.bottom - bounds.bottom)
  } finally { applying = false }
})
</script>
