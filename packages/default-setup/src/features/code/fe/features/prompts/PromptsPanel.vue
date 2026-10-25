<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <CodePanelHeader :icon="Sparkle" title="Prompts" />

    <!-- Search / New Prompt toolbar -->
    <div class="flex-shrink-0 p-3 border-b border-neutral-800/50">
      <div v-if="!isSearchMode" class="flex gap-2">
        <Button
          variant="transparent"
          class="!p-2 !h-auto text-neutral-300 hover:text-white hover:bg-white/[0.03]"
          @click="handleSearchClick"
          title="Search prompts"
        >
          <Search class="w-4 h-4" />
        </Button>
        <Button
          class="flex-1 !text-[0.8125rem] !font-medium !py-2 !px-3 text-center flex items-center justify-center"
          @click="createPromptInline()"
        >
          <span>New Prompt</span>
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
            placeholder="Search prompts..."
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
    <div v-if="isLoading && prompts.length === 0" class="flex items-center justify-center flex-1">
      <div class="text-sm text-neutral-400">Loading prompts...</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="p-4 m-2 border rounded bg-red-500/10 border-red-500/50">
      <div class="text-sm text-red-400">{{ error }}</div>
    </div>

    <!-- Prompts List -->
    <div v-else class="flex-1 overflow-auto" @scroll="onScroll">
      <EmptyState
        v-if="prompts.length === 0"
        :icon="Sparkle"
        title="No prompts found"
        subtitle="Create a new prompt to get started"
      />

      <div v-else-if="isSearchMode && searchQuery.trim() && filteredPrompts.length === 0" class="flex flex-col items-center pt-10 h-full px-6 text-center">
        <div class="flex items-center justify-center w-12 h-12 mb-3 rounded-full bg-neutral-800/30">
          <Search class="w-6 h-6 text-neutral-500" />
        </div>
        <p class="text-sm text-neutral-400">No prompts match "{{ searchQuery }}"</p>
      </div>

      <ContextMenuRoot v-for="prompt in filteredPrompts" :key="prompt.id">
        <ContextMenuTrigger as-child>
          <div
            @click="selectPrompt(prompt)"
            class="px-4 py-2 transition-colors border-b cursor-pointer border-neutral-800 hover:bg-neutral-800/50"
          >
            <!-- Header row: label + controls on same line -->
            <div class="flex items-start gap-2">
              <div class="flex-1 min-w-0">
                <template v-if="editingNameForPrompt === prompt.id">
                  <div class="relative w-full" @click.stop>
                    <input
                      v-model="editedName"
                      :data-edit-name="prompt.id"
                      @keydown.enter.stop="confirmEditName(prompt)"
                      @keydown.escape.stop="cancelEditName"
                      @blur="confirmEditName(prompt)"
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
                  <div class="text-sm font-medium truncate text-neutral-200" :title="prompt.description">
                    {{ prompt.label }}
                  </div>
                  <div v-if="prompt.category" class="text-[11px] text-neutral-500 truncate">
                    {{ prompt.category }}
                  </div>
                </template>
              </div>

              <!-- Controls -->
              <div class="flex items-center gap-1 shrink-0">
                <button
                  @click.stop="toggleInputs(prompt.id)"
                  class="p-1 transition-colors rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700"
                  :title="expandedPrompts.has(prompt.id) ? 'Hide inputs' : 'Show inputs'"
                >
                  <ChevronDown v-if="expandedPrompts.has(prompt.id)" :size="14" />
                  <ChevronRight v-else :size="14" />
                </button>
                <button
                  @click.stop="goToPrompt(prompt)"
                  class="p-1 transition-colors rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700"
                  title="Go to prompt"
                >
                  <ExternalLink :size="14" />
                </button>
              </div>
            </div>

            <!-- Expanded inputs -->
            <div v-if="expandedPrompts.has(prompt.id)" class="mt-1 space-y-1">
              <div v-if="prompt.inputs && Object.keys(prompt.inputs).length > 0" class="flex flex-wrap gap-1">
                <ContextMenuRoot v-for="(input, key) in prompt.inputs" :key="key">
                  <ContextMenuTrigger as-child>
                    <span
                      @contextmenu.stop
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded bg-neutral-800 text-neutral-400 transition-colors"
                    >
                      <template v-if="editingParameter?.promptId === prompt.id && editingParameter?.key === String(key)">
                        <input
                          v-model="editedParameterName"
                          :data-edit-param="`${prompt.id}-${key}`"
                          @keydown.enter.stop="confirmEditParameter(prompt)"
                          @keydown.escape.stop="cancelEditParameter"
                          @blur="confirmEditParameter(prompt)"
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
                          @dblclick.stop="startEditParameter(prompt.id, String(key))"
                          class="cursor-pointer hover:text-neutral-200"
                        >
                          <span class="font-medium">{{ input.name || key }}</span>
                          <span class="text-neutral-500">({{ input.type }})</span>
                          <span v-if="input.required !== false" class="text-red-400">*</span>
                        </span>
                      </template>
                    </span>
                  </ContextMenuTrigger>
                  <ContextMenuPortal>
                    <ContextMenuContent :class="MENU_CONTENT_CLASS">
                      <ContextMenuItem @select="startEditParameter(prompt.id, String(key))" :class="MENU_ITEM_CLASS">
                        <Pencil :size="16" />
                        Rename
                      </ContextMenuItem>
                      <ContextMenuItem @select="removeParameter(prompt, String(key))" :class="MENU_ITEM_CLASS">
                        <Trash2 :size="16" />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenuPortal>
                </ContextMenuRoot>
              </div>
              <div v-else-if="addingParameterForPrompt !== prompt.id" class="text-xs italic text-neutral-500">
                No inputs
              </div>

              <!-- Add Parameter Input -->
              <div v-if="addingParameterForPrompt === prompt.id" class="mt-1 relative">
                <input
                  v-model="newParameterName"
                  :data-add-param="prompt.id"
                  @keydown.enter.stop="confirmAddParameter(prompt)"
                  @keydown.escape.stop="cancelAddParameter"
                  @blur="confirmAddParameter(prompt)"
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
            <ContextMenuItem @select="startEditName(prompt)" :class="MENU_ITEM_CLASS">
              <Pencil :size="16" />
              Edit Name
            </ContextMenuItem>
            <ContextMenuItem @select="startAddParameter(prompt)" :class="MENU_ITEM_CLASS">
              <Plus :size="16" />
              Add Parameter
            </ContextMenuItem>
            <ContextMenuItem @select="deletePrompt(prompt)" :class="MENU_ITEM_CLASS">
              <Trash2 :size="16" />
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenuPortal>
      </ContextMenuRoot>
      <div v-if="loadingMore" class="flex justify-center py-3">
        <span class="text-xs text-neutral-500">Loading more prompts...</span>
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
import { ExternalLink, Plus, X, Pencil, Trash2, Sparkle, Search, ChevronDown, ChevronRight } from 'lucide-vue-next'
import CodePanelHeader from '#features/code/fe/features/CodePanelHeader.vue'
import EmptyState from '#features/code/fe/features/EmptyState.vue'
import type { PromptEntity } from '@apackdev/sdk'
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

// The code surface's actor, and its codePrompts child for tab management
const codeActor: CodeState = useSurface()
const codePromptsActor = codeChild(codeActor, 'codePrompts')!

// The prompts, as the prompts feature's list view reads them: this panel's own page of it, a page more each time it's
// read to the end and all of it while searching
const PAGE_SIZE = 20
const limit = ref<number | null>(PAGE_SIZE)
const list = useView('prompts', 'list', () => ({ limit: limit.value, categories: [] }), { keepPrevious: true })
const prompts = computed(() => list.data?.prompts ?? [])
const hasMore = computed(() => prompts.value.length < (list.data?.totalCount ?? 0))
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

const filteredPrompts = computed(() => {
  if (!searchQuery.value.trim()) return prompts.value
  const haystack = prompts.value.map((p: PromptEntity) => `${p.label} ${p.category || ''}`.toLowerCase())
  const idxs = fuzzy.search(haystack, searchQuery.value.toLowerCase())
  if (!idxs) return []
  const [matchedIndexes, , order] = idxs
  if (!order || !matchedIndexes) return []
  return order.map(i => prompts.value[matchedIndexes[i]])
})

// Auto-rename after inline creation
watch(prompts, (newVal, oldVal) => {
  if (pendingRename.value && newVal.length > oldVal.length) {
    pendingRename.value = false
    const created = newVal[newVal.length - 1]
    nextTick(() => startEditName(created))
  }
})

// State for adding/editing parameters
const addingParameterForPrompt = ref<string | null>(null)
const newParameterName = ref('')
const editingParameter = ref<{ promptId: string, key: string } | null>(null)
const editedParameterName = ref('')

// State for expanded inputs
const expandedPrompts = ref<Set<string>>(new Set())

const toggleInputs = (promptId: string) => {
  const next = new Set(expandedPrompts.value)
  if (next.has(promptId)) {
    next.delete(promptId)
  } else {
    next.add(promptId)
  }
  expandedPrompts.value = next
}

// State for editing name
const editingNameForPrompt = ref<string | null>(null)
const editedName = ref('')

function startAddParameter(prompt: PromptEntity) {
  addingParameterForPrompt.value = prompt.id
  newParameterName.value = ''
  nextTick(() => {
    const input = document.querySelector(`[data-add-param="${prompt.id}"]`) as HTMLInputElement
    input?.focus()
  })
}

function confirmAddParameter(prompt: PromptEntity) {
  if (newParameterName.value.trim()) {
    const paramKey = newParameterName.value.trim()
    const updatedInputs = {
      ...prompt.inputs,
      [paramKey]: { name: paramKey, type: 'any' as const, required: false }
    }
    codePromptsActor.send({
      type: 'codePrompts.UPDATE_INPUTS',
      promptId: prompt.id,
      inputs: updatedInputs
    })
  }
  addingParameterForPrompt.value = null
  newParameterName.value = ''
}

function cancelAddParameter() {
  addingParameterForPrompt.value = null
  newParameterName.value = ''
}

function startEditParameter(promptId: string, key: string) {
  // Find the prompt to get the actual parameter data
  const prompt = prompts.value.find((p: PromptEntity) => p.id === promptId)
  const inputData = prompt?.inputs?.[key]
  const displayName = inputData?.name || key

  editingParameter.value = { promptId, key }
  editedParameterName.value = displayName
  nextTick(() => {
    const input = document.querySelector(`[data-edit-param="${promptId}-${key}"]`) as HTMLInputElement
    input?.focus()
    input?.select()
  })
}

function confirmEditParameter(prompt: PromptEntity) {
  if (editingParameter.value && editedParameterName.value.trim()) {
    const { key: oldKey } = editingParameter.value
    const newName = editedParameterName.value.trim()
    const oldInputData = prompt.inputs?.[oldKey]
    const oldName = oldInputData?.name || oldKey

    // Only update if the name actually changed
    if (oldName !== newName && prompt.inputs) {
      const updatedInputs = { ...prompt.inputs }
      // Use newName as the new key
      updatedInputs[newName] = {
        ...updatedInputs[oldKey],
        name: newName
      }
      delete updatedInputs[oldKey]
        codePromptsActor.send({
        type: 'codePrompts.UPDATE_INPUTS',
        promptId: prompt.id,
        inputs: updatedInputs
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

function removeParameter(prompt: PromptEntity, key: string) {
  if (prompt.inputs) {
    const updatedInputs = { ...prompt.inputs }
    delete updatedInputs[key]
    codePromptsActor.send({
      type: 'codePrompts.UPDATE_INPUTS',
      promptId: prompt.id,
      inputs: updatedInputs
    })
  }
}

function startEditName(prompt: PromptEntity) {
  editingNameForPrompt.value = prompt.id
  editedName.value = prompt.label
  setTimeout(() => {
    const input = document.querySelector(`[data-edit-name="${prompt.id}"]`) as HTMLInputElement
    input?.focus()
    input?.select()
  }, 0)
}

function confirmEditName(prompt: PromptEntity) {
  if (editingNameForPrompt.value && editedName.value.trim()) {
    const newName = editedName.value.trim()
    if (newName !== prompt.label) {
      codePromptsActor.send({
        type: 'codePrompts.UPDATE_LABEL',
        promptId: prompt.id,
        label: newName
      })
    }
  }
  editingNameForPrompt.value = null
  editedName.value = ''
}

function cancelEditName() {
  editingNameForPrompt.value = null
  editedName.value = ''
}

function deletePrompt(prompt: PromptEntity) {
  codePromptsActor.send({
    type: 'codePrompts.DELETE',
    promptId: prompt.id
  })
}

const { onScroll } = useInfiniteScroll({
  hasMore,
  loading: loadingMore,
  onLoadMore: () => { if (limit.value !== null) limit.value += PAGE_SIZE },
})

// Event handlers
const selectPrompt = (prompt: PromptEntity) => {
  codePromptsActor.send({ type: 'codePrompts.OPEN_PROMPT', promptId: prompt.id })
}

const goToPrompt = (prompt: PromptEntity) => {
  openEntity(prompt.id)
}

const createPromptInline = () => {
  const defaultLabel = `Prompt ${prompts.value.length + 1}`
  pendingRename.value = true
  codePromptsActor.send({
    type: 'codePrompts.CREATE_INLINE',
    label: defaultLabel,
    templateFn: '// Your template function body here\nreturn `Your prompt template`;',
    inputs: {},
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
