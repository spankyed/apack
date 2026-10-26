<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <CodePanelHeader :icon="Play" title="Actions" />

    <!-- Search / New Action toolbar -->
    <div class="flex-shrink-0 p-3 border-b border-neutral-800/50">
      <div v-if="!isSearchMode" class="flex gap-2">
        <Button
          variant="transparent"
          class="!p-2 !h-auto text-neutral-300 hover:text-white hover:bg-white/[0.03]"
          @click="handleSearchClick"
          title="Search actions"
        >
          <Search class="w-4 h-4" />
        </Button>
        <Button
          class="flex-1 !text-[0.8125rem] !font-medium !py-2 !px-3 text-center flex items-center justify-center"
          @click="createActionInline()"
        >
          <span>New Action</span>
        </Button>
      </div>
      <div v-else class="flex justify-center">
        <div class="relative w-full">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 w-3.5 h-3.5" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            class="w-full py-2 pr-8 text-xs transition-all duration-200 border rounded-md outline-none pl-9 bg-neutral-800/50 border-neutral-700/50 text-neutral-100 placeholder-neutral-500 focus:border-neutral-600 focus:bg-neutral-800/70"
            placeholder="Search actions..."
            @keyup.escape="closeSearch"
          />
          <button
            class="absolute p-1 transition-colors -translate-y-1/2 rounded right-2 top-1/2 hover:bg-neutral-700/50 text-neutral-500 hover:text-neutral-300"
            @click="closeSearch"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading && actions.length === 0" class="flex items-center justify-center flex-1">
      <div class="text-sm text-neutral-400">Loading actions...</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="p-4 m-2 border rounded bg-red-500/10 border-red-500/50">
      <div class="text-sm text-red-400">{{ error }}</div>
    </div>

    <!-- Actions List -->
    <div v-else class="flex-1 overflow-auto" @scroll="onScroll">
      <EmptyState
        v-if="actions.length === 0"
        :icon="Play"
        title="No actions found"
        subtitle="Create a new action to get started"
      />

      <div v-else-if="isSearchMode && searchQuery.trim() && filteredActions.length === 0" class="flex flex-col items-center pt-10 h-full px-6 text-center">
        <div class="flex items-center justify-center w-12 h-12 mb-3 rounded-full bg-neutral-800/30">
          <Search class="w-6 h-6 text-neutral-500" />
        </div>
        <p class="text-sm text-neutral-400">No actions match "{{ searchQuery }}"</p>
      </div>

      <ContextMenuRoot v-for="action in filteredActions" :key="action.id">
        <ContextMenuTrigger as-child>
          <div
            @click="selectAction(action)"
            class="px-4 py-2 transition-colors border-b cursor-pointer border-neutral-800 hover:bg-neutral-800/50"
          >
            <!-- Header row: label + controls on same line -->
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <template v-if="editingNameForAction === action.id">
                  <div class="relative w-full" @click.stop>
                    <input
                      v-model="editedName"
                      :data-edit-name="action.id"
                      @keydown.enter.stop="confirmEditName(action)"
                      @keydown.escape.stop="cancelEditName"
                      @blur="confirmEditName(action)"
                      @click.stop
                      class="text-sm font-medium bg-transparent border-b border-blue-500 focus:outline-none text-neutral-200 w-full pr-5"
                    />
                    <button
                      @mousedown.prevent.stop="cancelEditName"
                      class="absolute right-0 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400 transition-colors"
                      title="Cancel"
                    >
                      <X :size="12" />
                    </button>
                  </div>
                </template>
                <template v-else>
                  <div class="text-sm font-medium truncate text-neutral-200" :title="action.description">
                    {{ action.label }}
                  </div>
                  <div v-if="action.category" class="text-[11px] text-neutral-500 truncate">
                    {{ action.category }}
                  </div>
                </template>
              </div>

              <!-- Controls -->
              <div class="flex items-center gap-1 shrink-0">
                <button
                  @click.stop="toggleInputs(action.id)"
                  class="p-1 transition-colors rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700"
                  :title="expandedActions.has(action.id) ? 'Hide inputs' : 'Show inputs'"
                >
                  <ChevronDown v-if="expandedActions.has(action.id)" :size="14" />
                  <ChevronRight v-else :size="14" />
                </button>
                <button
                  @click.stop="goToAction(action)"
                  class="p-1 transition-colors rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700"
                  title="Go to action"
                >
                  <ExternalLink :size="14" />
                </button>
              </div>
            </div>

            <!-- Expanded inputs -->
            <div v-if="expandedActions.has(action.id)" class="mt-1 space-y-1">
              <div v-if="action.input && Object.keys(action.input).length > 0" class="flex flex-wrap gap-1">
                <ContextMenuRoot v-for="(param, key) in action.input" :key="key">
                  <ContextMenuTrigger as-child>
                    <span
                      @contextmenu.stop
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-neutral-800 text-neutral-400 transition-colors"
                    >
                      <template v-if="editingParameter?.actionId === action.id && editingParameter?.key === String(key)">
                        <input
                          v-model="editedParameterName"
                          :data-edit-param="`${action.id}-${key}`"
                          @keydown.enter.stop="confirmEditParameter(action)"
                          @keydown.escape.stop="cancelEditParameter"
                          @blur="confirmEditParameter(action)"
                          @click.stop
                          class="w-16 px-1 text-xs bg-transparent border-b border-blue-500 focus:outline-none text-neutral-200"
                        />
                        <button
                          @mousedown.prevent.stop="cancelEditParameter"
                          class="p-0.5 rounded hover:bg-neutral-600 text-neutral-500 hover:text-red-400 transition-colors"
                          title="Cancel edit"
                        >
                          <X :size="10" />
                        </button>
                      </template>
                      <template v-else>
                        <span
                          @dblclick.stop="startEditParameter(action.id, String(key))"
                          class="cursor-pointer hover:text-neutral-200"
                        >
                          <span class="font-medium">{{ key }}</span>
                          <span class="text-neutral-500">({{ param.type }})</span>
                          <span v-if="param.required" class="text-red-400">*</span>
                        </span>
                      </template>
                    </span>
                  </ContextMenuTrigger>
                  <ContextMenuPortal>
                    <ContextMenuContent :class="MENU_CONTENT_CLASS">
                      <ContextMenuItem @select="startEditParameter(action.id, String(key))" :class="MENU_ITEM_CLASS">
                        <Pencil :size="16" />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem @select="removeParameter(action, String(key))" :class="MENU_ITEM_CLASS">
                        <Trash2 :size="16" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenuPortal>
                </ContextMenuRoot>
              </div>
              <div v-else-if="addingParameterForAction !== action.id" class="text-xs italic text-neutral-500">
                No parameters
              </div>

              <!-- Add Parameter Input -->
              <div v-if="addingParameterForAction === action.id" class="mt-1 relative">
                <input
                  v-model="newParameterName"
                  :data-add-param="action.id"
                  @keydown.enter.stop="confirmAddParameter(action)"
                  @keydown.escape.stop="cancelAddParameter"
                  @blur="confirmAddParameter(action)"
                  @click.stop
                  class="w-full pl-2 pr-6 py-1 text-xs rounded bg-neutral-800 border border-blue-500 text-neutral-200 focus:outline-none"
                  placeholder="Parameter name"
                />
                <button
                  @mousedown.prevent.stop="cancelAddParameter"
                  class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400 transition-colors"
                  title="Cancel"
                >
                  <X :size="12" />
                </button>
              </div>
            </div>
          </div>
        </ContextMenuTrigger>

        <ContextMenuPortal>
          <ContextMenuContent :class="MENU_CONTENT_CLASS">
            <ContextMenuItem @select="startEditName(action)" :class="MENU_ITEM_CLASS">
              <Pencil :size="16" />
              Edit Name
            </ContextMenuItem>
            <ContextMenuItem @select="startAddParameter(action)" :class="MENU_ITEM_CLASS">
              <Plus :size="16" />
              Add Parameter
            </ContextMenuItem>
            <ContextMenuItem @select="deleteAction(action)" :class="MENU_ITEM_CLASS">
              <Trash2 :size="16" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
      <div v-if="loadingMore" class="flex justify-center py-3">
        <span class="text-xs text-neutral-500">Loading more actions...</span>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { ref, computed, watch, nextTick } from 'vue'
import { openEntity } from '@apackdev/sdk/fe'
import type { CodeState } from '#features/code/fe/state.ts'
import { useView } from '#generated/fe.ts'
import { ExternalLink, Plus, X, Pencil, Trash2, Play, Search, ChevronDown, ChevronRight } from 'lucide-vue-next'
import CodePanelHeader from '#features/code/fe/features/CodePanelHeader.vue'
import EmptyState from '#features/code/fe/features/EmptyState.vue'
import type { ActionEntity } from '@apackdev/sdk'
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
} from 'reka-ui'
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS } from '../explorer/constants.ts'
import { useInfiniteScroll } from '@apackdev/ui/composables/useInfiniteScroll'
import Button from '@apackdev/ui/design/button'
import uFuzzy from '@leeoniya/ufuzzy'
import { codeChild } from '../children.ts';

// The code surface's actor, and its codeActions child for tab management
const codeActor: CodeState = useSurface()
const codeActionsActor = codeChild(codeActor, 'codeActions')!

// The actions, as the actions feature's list view reads them: this panel's own page of it, a page more each time it's
// read to the end and all of it while searching
const PAGE_SIZE = 20
const limit = ref<number | null>(PAGE_SIZE)
const list = useView('actions', 'list', () => ({ limit: limit.value, categories: [] }), { keepPrevious: true })
const actions = computed(() => list.data?.actions ?? [])
const hasMore = computed(() => actions.value.length < (list.data?.totalCount ?? 0))
const loadingMore = computed(() => list.status === 'loading')
const isLoading = ref(false)
const error = ref<string | null>(null)

// Search state
const isSearchMode = ref(false)
const searchQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const pendingRename = ref(false)

const fuzzy = new uFuzzy({ intraMode: 1, interLft: 2, intraSub: 1, intraTrn: 1, intraDel: 1, intraIns: 1 })

const handleSearchClick = () => {
  isSearchMode.value = true
  if (hasMore.value) limit.value = null
  nextTick(() => searchInput.value?.focus())
}

const closeSearch = () => {
  isSearchMode.value = false
  searchQuery.value = ''
}

const filteredActions = computed(() => {
  if (!searchQuery.value.trim()) return actions.value
  const haystack = actions.value.map((a: ActionEntity) => `${a.label} ${a.category || ''}`.toLowerCase())
  const idxs = fuzzy.search(haystack, searchQuery.value.toLowerCase())
  if (!idxs) return []
  const [matchedIndexes, , order] = idxs
  if (!order || !matchedIndexes) return []
  return order.map(i => actions.value[matchedIndexes[i]])
})

// Auto-rename after inline creation
watch(actions, (newVal, oldVal) => {
  if (pendingRename.value && newVal.length > oldVal.length) {
    pendingRename.value = false
    const created = newVal[newVal.length - 1]
    nextTick(() => startEditName(created))
  }
})

// State for adding/editing parameters
const addingParameterForAction = ref<string | null>(null)
const newParameterName = ref('')
const editingParameter = ref<{ actionId: string, key: string } | null>(null)
const editedParameterName = ref('')

// State for expanded inputs
const expandedActions = ref<Set<string>>(new Set())

const toggleInputs = (actionId: string) => {
  const next = new Set(expandedActions.value)
  if (next.has(actionId)) {
    next.delete(actionId)
  } else {
    next.add(actionId)
  }
  expandedActions.value = next
}

// State for editing name
const editingNameForAction = ref<string | null>(null)
const editedName = ref('')

function startAddParameter(action: ActionEntity) {
  addingParameterForAction.value = action.id
  newParameterName.value = ''
  nextTick(() => {
    const input = document.querySelector(`[data-add-param="${action.id}"]`) as HTMLInputElement
    input?.focus()
  })
}

function confirmAddParameter(action: ActionEntity) {
  if (newParameterName.value.trim()) {
    const paramKey = newParameterName.value.trim()
    const updatedInput = {
      ...action.input,
      [paramKey]: { type: 'any' as const, required: false }
    }
    codeActionsActor.send({
      type: 'codeActions.UPDATE_INPUT',
      actionId: action.id,
      input: updatedInput
    })
  }
  addingParameterForAction.value = null
  newParameterName.value = ''
}

function cancelAddParameter() {
  addingParameterForAction.value = null
  newParameterName.value = ''
}

function startEditParameter(actionId: string, key: string) {
  editingParameter.value = { actionId, key }
  // For actions, the key IS the display name (no separate name field like prompts)
  editedParameterName.value = key
  nextTick(() => {
    const input = document.querySelector(`[data-edit-param="${actionId}-${key}"]`) as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

function confirmEditParameter(action: ActionEntity) {
  if (editingParameter.value && editedParameterName.value.trim()) {
    const { key: oldKey } = editingParameter.value
    const newKey = editedParameterName.value.trim()

    // Only update if the key actually changed
    if (oldKey !== newKey && action.input) {
      const updatedInput = { ...action.input }
      // Use newKey as the new key
      updatedInput[newKey] = {
        ...updatedInput[oldKey]
      }
      delete updatedInput[oldKey]
      codeActionsActor.send({
        type: 'codeActions.UPDATE_INPUT',
        actionId: action.id,
        input: updatedInput
      })
    }
  }
  editingParameter.value = null
  editedParameterName.value = ''
}

function cancelEditParameter() {
  editingParameter.value = null
  editedParameterName.value = ''
}

function removeParameter(action: ActionEntity, key: string) {
  if (action.input) {
    const updatedInput = { ...action.input }
    delete updatedInput[key]
    codeActionsActor.send({
      type: 'codeActions.UPDATE_INPUT',
      actionId: action.id,
      input: updatedInput
    })
  }
}

function startEditName(action: ActionEntity) {
  editingNameForAction.value = action.id
  editedName.value = action.label
  setTimeout(() => {
    const input = document.querySelector(`[data-edit-name="${action.id}"]`) as HTMLInputElement
    input?.focus()
    input?.select()
  }, 0)
}

function confirmEditName(action: ActionEntity) {
  if (editingNameForAction.value && editedName.value.trim()) {
    const newName = editedName.value.trim()
    if (newName !== action.label) {
      codeActionsActor.send({
        type: 'codeActions.UPDATE_LABEL',
        actionId: action.id,
        label: newName
      })
    }
  }
  editingNameForAction.value = null
  editedName.value = ''
}

function cancelEditName() {
  editingNameForAction.value = null
  editedName.value = ''
}

function deleteAction(action: ActionEntity) {
  codeActionsActor.send({
    type: 'codeActions.DELETE',
    actionId: action.id
  })
}

const { onScroll } = useInfiniteScroll({
  hasMore,
  loading: loadingMore,
  onLoadMore: () => { if (limit.value !== null) limit.value += PAGE_SIZE },
})

// Event handlers
const selectAction = (action: ActionEntity) => {
  codeActionsActor.send({ type: 'codeActions.OPEN_ACTION', actionId: action.id })
}

const goToAction = (action: ActionEntity) => {
  openEntity(action.id)
}

const createActionInline = () => {
  const defaultLabel = `Action ${actions.value.length + 1}`
  pendingRename.value = true
  codeActionsActor.send({
    type: 'codeActions.CREATE_INLINE',
    label: defaultLabel,
    actionFn: '// Your action function body here\nreturn { success: true };',
    input: {},
  })
}
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

</style>
