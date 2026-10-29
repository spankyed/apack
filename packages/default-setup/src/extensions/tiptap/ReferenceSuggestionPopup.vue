<template>
  <Teleport to="body">
    <div
      v-if="isActive"
      ref="popupEl"
      class="reference-suggestion-popup"
      :style="popupStyle"
    >
      <!-- Category Level -->
      <template v-if="level === 'category'">
        <div
          v-for="(cat, index) in filteredCategories"
          :key="`${cat.featureRef}/${cat.id}`"
          class="reference-suggestion-item"
          :class="{ 'is-selected': index === selectedIndex }"
          @mousedown.prevent="selectCategory(cat.id)"
          @mouseenter="selectedIndex = index"
        >
          <component :is="getCategoryIcon(cat.id)" class="reference-suggestion-icon" :size="16" />
          <span>{{ cat.declaration.label }}</span>
        </div>
        <div v-if="filteredCategories.length === 0" class="reference-suggestion-empty">
          No matching categories
        </div>
      </template>

      <!-- Items Level -->
      <template v-else>
        <div
          class="reference-suggestion-header"
          @mousedown.prevent="goBackToCategories"
        >
          <span class="reference-suggestion-back">&larr;</span>
          <span>{{ activeCategoryLabel }}</span>
        </div>
        <div
          v-for="(item, index) in items"
          :key="item.id"
          class="reference-suggestion-item"
          :class="{ 'is-selected': index === selectedIndex }"
          @mousedown.prevent="insertReference(item)"
          @mouseenter="selectedIndex = index"
        >
          <component :is="getReferenceTypeBinding(item.type)?.binding.icon" class="reference-suggestion-icon" :size="16" />
          <span class="reference-suggestion-label">{{ item.label }}</span>
          <span class="reference-suggestion-code" :title="item.shortCode">{{ item.shortCode.length > 12 ? item.shortCode.slice(0, 12) + '…' : item.shortCode }}</span>
        </div>
        <div v-if="items.length === 0" class="reference-suggestion-empty">
          No matching items
        </div>
      </template>
      <CompletionRows :offer="nativeOffer" :selected-index="selectedIndex - hostRowCount" @hover="selectedIndex = hostRowCount + $event" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import CompletionRows from '@apackdev/ui/components/tiptap/CompletionRows'
import { getEditorCompletionOffer } from '@apackdev/sdk/fe'
import { ref, shallowRef, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { Editor } from '@tiptap/core'
import { referenceSuggestionKey, type ReferenceSuggestionState } from './reference-suggestion.ts'
import { useReferenceItems, type ReferenceCategory, type ReferenceItem } from './useReferenceItems.ts'
import { getReferenceCategoryBinding, getReferenceTypeBinding } from '@apackdev/sdk/fe/references'

const props = defineProps<{
  editor: Editor
  variant?: 'full' | 'chat'
}>()

const nativeOffer = computed(() => getEditorCompletionOffer(props.editor).value)
const hostRowCount = computed(() => level.value === 'category' ? filteredCategories.value.length : items.value.length)
const selectedIndex = ref(-1)
const popupEl = ref<HTMLElement | null>(null)
const popupStyle = ref<Record<string, string>>({ bottom: '0px', left: '0px' })

function getCategoryIcon(id: ReferenceCategory) {
  return getReferenceCategoryBinding(id)?.binding.icon
}

const suggestionState = shallowRef<ReferenceSuggestionState>()
watch(() => props.editor, (editor, _previous, onCleanup) => {
  const update = () => { suggestionState.value = referenceSuggestionKey.getState(editor.state) }
  update()
  editor.on('transaction', update)
  onCleanup(() => { editor.off('transaction', update) })
}, { immediate: true })

const isActive = computed(() => suggestionState.value?.active ?? false)
const level = computed(() => suggestionState.value?.level ?? 'category')
const query = computed(() => suggestionState.value?.query ?? '')
const selectedCategory = computed(() => suggestionState.value?.selectedCategory ?? null)

const activeCategoryLabel = computed(() => {
  const cat = categories.value.find((c) => c.id === selectedCategory.value)
  return cat?.declaration.label ?? ''
})

const filteredCategories = computed(() => {
  const q = query.value.toLowerCase()
  if (!q) return categories.value
  return categories.value.filter((c) => c.declaration.label.toLowerCase().includes(q))
})

watch([query, level], ([q, lvl]) => {
  if (lvl !== 'category' || !q.endsWith(':')) return
  const typed = q.slice(0, -1).toLowerCase()
  const match = categories.value.find(
    (c) => c.declaration.label.toLowerCase().replace(/\s+/g, '') === typed
  )
  if (!match) return
  const state = suggestionState.value
  if (!state) return
  const { tr } = props.editor.state
  tr.setMeta(referenceSuggestionKey, {
    active: true,
    triggerPos: state.triggerPos,
    query: '',
    level: 'items',
    selectedCategory: match.id,
    categoryQuery: q,
  })
  props.editor.view.dispatch(tr)
  selectedIndex.value = hostRowCount.value ? 0 : -1
})

const itemQuery = computed(() => (level.value === 'items' ? query.value : ''))
const { items, categories } = useReferenceItems(selectedCategory, itemQuery, isActive)

watch([filteredCategories, items, level], () => {
  selectedIndex.value = hostRowCount.value ? 0 : -1
}, { immediate: true })
watch(() => nativeOffer.value?.id, () => {
  nextTick(updatePosition)
  if (selectedIndex.value >= hostRowCount.value) selectedIndex.value = hostRowCount.value ? 0 : -1
})

function updatePosition() {
  if (!isActive.value || !suggestionState.value) return

  try {
    const coords = props.editor.view.coordsAtPos(suggestionState.value.triggerPos)
    const left = `${coords.left}px`

    if (props.variant === 'full') {
      const spaceAbove = coords.top
      const popupHeight = popupEl.value?.offsetHeight ?? 280
      if (spaceAbove < popupHeight + 8) {
        popupStyle.value = { top: `${coords.bottom + 4}px`, left }
      } else {
        popupStyle.value = { bottom: `${window.innerHeight - coords.top + 4}px`, left }
      }
    } else {
      popupStyle.value = { bottom: `${window.innerHeight - coords.top + 4}px`, left }
    }
  } catch {
    // Position might be invalid during transitions
  }
}

watch(isActive, (active) => {
  if (active) {
    nextTick(updatePosition)
  }
})

watch(() => suggestionState.value?.triggerPos, () => {
  if (isActive.value) nextTick(updatePosition)
})

watch([level, items], () => {
  if (isActive.value) nextTick(updatePosition)
})

onMounted(() => {
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})

function handleClickOutside(event: MouseEvent) {
  if (!isActive.value) return
  const target = event.target as Node
  if (popupEl.value?.contains(target)) return
  deactivateAndClean()
}

watch(isActive, (active) => {
  if (active) {
    document.addEventListener('mousedown', handleClickOutside, true)
  } else {
    document.removeEventListener('mousedown', handleClickOutside, true)
  }
})

function scrollSelectedIntoView() {
  nextTick(() => {
    const el = popupEl.value?.querySelector('.is-selected') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function handleKeyDown(event: KeyboardEvent) {
  if (!isActive.value) return

  const currentList = level.value === 'category' ? filteredCategories.value : items.value
  const maxIndex = currentList.length + (nativeOffer.value?.rows.length ?? 0) - 1

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      event.stopPropagation()
      selectedIndex.value = Math.min(selectedIndex.value + 1, maxIndex)
      scrollSelectedIntoView()
      break

    case 'ArrowUp':
      event.preventDefault()
      event.stopPropagation()
      selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
      scrollSelectedIntoView()
      break

    case 'Enter':
    case 'Tab':
      event.preventDefault()
      event.stopPropagation()
      if (selectedIndex.value >= currentList.length) { nativeOffer.value?.rows[selectedIndex.value - currentList.length]?.select(); break }
      if (level.value === 'category') {
        const cat = filteredCategories.value[selectedIndex.value]
        if (cat) selectCategory(cat.id)
      } else {
        const item = items.value[selectedIndex.value]
        if (item) insertReference(item)
      }
      break

    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      nativeOffer.value?.dismiss()
      deactivateAndClean()
      break

    case 'Backspace':
      if (level.value === 'items' && query.value === '') {
        event.preventDefault()
        event.stopPropagation()
        goBackToCategories()
      }
      break
  }
}

watch([isActive, () => props.editor], ([active, editor], _previous, onCleanup) => {
  if (!active) return
  const dom = editor.view.dom
  dom.addEventListener('keydown', handleKeyDown, true)
  onCleanup(() => { dom.removeEventListener('keydown', handleKeyDown, true) })
}, { immediate: true })

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside, true)
})

function selectCategory(id: ReferenceCategory) {
  const cat = categories.value.find((c) => c.id === id)
  if (!cat) return

  const state = suggestionState.value
  if (!state) return

  const { tr } = props.editor.state
  const from = state.triggerPos + 1
  const to = props.editor.state.selection.head
  const categoryPrefix = cat.declaration.label.toLowerCase().replace(/\s+/g, '') + ':'

  tr.replaceWith(from, to, props.editor.state.schema.text(categoryPrefix))
  tr.setMeta(referenceSuggestionKey, {
    active: true,
    triggerPos: state.triggerPos,
    query: '',
    level: 'items',
    selectedCategory: id,
    categoryQuery: categoryPrefix,
  })

  props.editor.view.dispatch(tr)
  selectedIndex.value = 0
}

function goBackToCategories() {
  const state = suggestionState.value
  if (!state) return

  const { tr } = props.editor.state
  const from = state.triggerPos + 1
  const to = props.editor.state.selection.head
  tr.delete(from, to)
  tr.setMeta(referenceSuggestionKey, {
    active: true,
    triggerPos: state.triggerPos,
    query: '',
    level: 'category',
    selectedCategory: null,
    categoryQuery: '',
  })

  props.editor.view.dispatch(tr)
  selectedIndex.value = 0
}

function insertReference(item: ReferenceItem) {
  const state = suggestionState.value
  if (!state) return

  const from = state.triggerPos
  const to = props.editor.state.selection.head

  props.editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContentAt(from, [
      {
        type: 'reference',
        attrs: {
          refType: item.type,
          refId: item.id,
          shortCode: item.shortCode,
          label: item.label,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run()

  const { tr } = props.editor.state
  tr.setMeta(referenceSuggestionKey, { deactivate: true })
  props.editor.view.dispatch(tr)
}

function deactivateAndClean() {
  const state = suggestionState.value
  if (!state) return

  const from = state.triggerPos
  const to = props.editor.state.selection.head

  const { tr } = props.editor.state
  tr.delete(from, to)
  tr.setMeta(referenceSuggestionKey, { deactivate: true })
  props.editor.view.dispatch(tr)
}
</script>

<style scoped>
.reference-suggestion-popup {
  position: fixed;
  z-index: 9999;
  min-width: 220px;
  max-width: 320px;
  max-height: 280px;
  overflow-y: auto;
  background: rgb(30 30 30);
  border: 1px solid rgb(64 64 64);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  padding: 4px;
}

.reference-suggestion-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 0.8rem;
  color: rgb(163 163 163);
  cursor: pointer;
  border-bottom: 1px solid rgb(50 50 50);
  margin-bottom: 2px;
}

.reference-suggestion-header:hover {
  color: rgb(212 212 212);
}

.reference-suggestion-back {
  font-size: 0.9rem;
}

.reference-suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 0.85rem;
  color: rgb(212 212 212);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reference-suggestion-item.is-selected {
  background: rgb(55 55 55);
  color: rgb(245 245 245);
}

.reference-suggestion-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: rgb(163 163 163);
}

.reference-suggestion-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reference-suggestion-code {
  flex-shrink: 0;
  font-size: 0.75rem;
  color: rgb(115 115 115);
  font-family: ui-monospace, SFMono-Regular, monospace;
}

.reference-suggestion-empty {
  padding: 8px 10px;
  font-size: 0.8rem;
  color: rgb(115 115 115);
  text-align: center;
}
</style>
