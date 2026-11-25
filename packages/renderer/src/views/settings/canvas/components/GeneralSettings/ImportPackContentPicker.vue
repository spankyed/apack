<template>
  <div class="space-y-3">
    <!-- Directory path -->
    <p class="text-xs text-neutral-500 font-mono truncate" :title="preview.directory">
      {{ preview.directory }}
    </p>

    <!-- Keys no installed applier imports -->
    <p v-if="preview.unavailable.length" class="text-xs text-amber-400/80">
      Not importable ({{ preview.unavailable.map(labelOf).join(', ') }}): pack "{{ preview.packId }}" registers no applier for {{ preview.unavailable.length === 1 ? 'it' : 'them' }}.
    </p>
    <p v-if="rows.length === 0" class="text-sm text-neutral-500">
      Nothing in this directory can be imported.
    </p>

    <!-- Type rows -->
    <div class="rounded-lg border border-neutral-800 divide-y divide-neutral-800">
      <div v-for="row in rows" :key="row.key">
        <!-- Header row -->
        <div
          :title="row.hint"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 select-none',
            row.isEmpty ? 'opacity-40' : 'hover:bg-neutral-800/40',
          ]"
        >
          <!-- Expand chevron -->
          <button
            type="button"
            class="flex items-center justify-center w-5 h-5 text-neutral-400 hover:text-neutral-200 disabled:cursor-not-allowed"
            :disabled="row.isEmpty || importing"
            @click="emit('toggle-expand', row.key)"
          >
            <component
              :is="expanded[row.key] ? ChevronDown : ChevronRight"
              class="w-4 h-4"
            />
          </button>

          <!-- Header checkbox -->
          <input
            type="checkbox"
            role="checkbox"
            class="w-4 h-4 cursor-pointer disabled:cursor-not-allowed accent-blue-600"
            :checked="row.allSelected"
            :indeterminate.prop="row.indeterminate"
            :aria-checked="row.indeterminate ? 'mixed' : row.allSelected"
            :aria-label="`Select all ${row.label}`"
            :disabled="row.isEmpty || importing"
            @change="emit('toggle-type-all', row.key)"
          />

          <!-- Icon + label -->
          <component :is="row.icon" class="w-4 h-4 text-neutral-400" />
          <span class="text-sm text-neutral-200 font-medium">{{ row.label }}</span>

          <!-- Count / status -->
          <span class="ml-auto text-xs text-neutral-500">
            <template v-if="row.isEmpty">no items</template>
            <template v-else>
              {{ row.selectedCount }} / {{ row.totalCount }} items
            </template>
          </span>
        </div>

        <!-- Expanded item list -->
        <div
          v-if="expanded[row.key] && !row.isEmpty"
          class="px-3 pb-3 pl-11 space-y-1 bg-neutral-900/40"
        >
          <label
            v-for="item in (preview.content[row.key] ?? [])"
            :key="item.key"
            :class="[
              'flex items-start gap-2 py-1 text-xs rounded',
              importing ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-neutral-800/40',
            ]"
          >
            <input
              type="checkbox"
              class="mt-0.5 w-3.5 h-3.5 accent-blue-600"
              :checked="(selection[row.key] ?? []).includes(item.key)"
              :disabled="importing"
              @change="emit('toggle-item', { key: row.key, item: item.key })"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline gap-2">
                <span class="text-neutral-200 font-mono truncate">{{ item.key }}</span>
                <span
                  v-if="item.childCount && item.childCount > 0"
                  class="text-neutral-500 text-[10px]"
                >
                  ({{ item.childCount }} children)
                </span>
              </div>
              <p
                v-if="item.description"
                class="text-neutral-500 truncate"
                :title="item.description"
              >
                {{ item.description }}
              </p>
            </div>
          </label>
        </div>
      </div>
    </div>

    <!-- Import mode -->
    <div class="flex items-center gap-1 rounded-lg border border-neutral-800 p-0.5">
      <button
        v-for="opt in importModes"
        :key="opt.value"
        type="button"
        :disabled="importing"
        :class="[
          'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
          importMode === opt.value
            ? 'bg-neutral-700 text-neutral-200'
            : 'text-neutral-500 hover:text-neutral-300',
        ]"
        @click="emit('set-mode', opt.value)"
        :title="opt.description"
      >
        {{ opt.label }}
      </button>
    </div>

    <!-- Restart brain checkbox -->
    <label class="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        :checked="restartBrain"
        :disabled="importing"
        @change="emit('toggle-restart-brain')"
        class="w-3.5 h-3.5 accent-blue-600"
      />
      <span class="text-xs text-neutral-400">Restart brain after import</span>
    </label>

    <!-- Footer buttons -->
    <div class="flex items-center gap-2 pt-1">
      <button
        type="button"
        :disabled="importing || totalSelected === 0"
        :class="[
          'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
          importing || totalSelected === 0
            ? 'bg-neutral-700 text-neutral-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-500 text-white',
        ]"
        @click="emit('confirm')"
      >
        {{ importing ? 'Importing...' : `Import Selected (${totalSelected})` }}
      </button>
      <button
        type="button"
        :disabled="importing"
        class="px-4 py-2 rounded-lg text-sm font-medium text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40 disabled:cursor-not-allowed"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  Zap,
  MessageSquare,
  GitBranch,
  Library,
  StickyNote,
  Settings,
  Database,
  ChevronRight,
  ChevronDown,
} from 'lucide-vue-next'
import type { PackContentPreview } from '@apackdev/sdk/framework'

type ImportMode = 'keep-existing' | 'replace-on-collision' | 'wipe-and-replace'

const props = defineProps<{
  preview: PackContentPreview
  selection: Record<string, string[]>
  expanded: Record<string, boolean>
  importMode: ImportMode
  restartBrain: boolean
  importing: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-expand', key: string): void
  (e: 'toggle-type-all', key: string): void
  (e: 'toggle-item', payload: { key: string; item: string }): void
  (e: 'set-mode', mode: ImportMode): void
  (e: 'toggle-restart-brain'): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const importModes: { value: ImportMode; label: string; description: string }[] = [
  { value: 'keep-existing', label: 'Keep existing', description: 'Skip items that already exist' },
  { value: 'replace-on-collision', label: 'Replace', description: 'Overwrite existing items with imported versions' },
  { value: 'wipe-and-replace', label: 'Wipe & replace', description: 'Delete all data of selected types, then import fresh' },
]

interface Row {
  key: string
  label: string
  icon: Component
  hint?: string
  totalCount: number
  selectedCount: number
  allSelected: boolean
  indeterminate: boolean
  isEmpty: boolean
}

// Content keys the pack's compiled content.json lists; known keys get an icon and hint, any other key a generic row
const KEY_META: Record<string, { icon: Component; hint?: string }> = {
  actions: { icon: Zap },
  prompts: { icon: MessageSquare },
  flows: {
    icon: GitBranch,
    hint: 'Flows reference actions and prompts by label. Any referenced action/prompt must already exist in the database (or be imported in the same run) or the flow will be skipped.',
  },
  documents: { icon: Library },
  commands: { icon: Library },
  notes: { icon: StickyNote },
  settings: { icon: Settings },
}

const labelOf = (key: string) => key.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

const rows = computed<Row[]>(() =>
  Object.entries(props.preview.content).map(([key, items]) => {
    const totalCount = items.length
    const selectedCount = (props.selection[key] ?? []).length
    return {
      key,
      label: labelOf(key),
      icon: KEY_META[key]?.icon ?? Database,
      hint: KEY_META[key]?.hint,
      totalCount,
      selectedCount,
      allSelected: totalCount > 0 && selectedCount === totalCount,
      indeterminate: selectedCount > 0 && selectedCount < totalCount,
      isEmpty: totalCount === 0,
    }
  }),
)

const totalSelected = computed(() =>
  rows.value.reduce((acc, r) => acc + r.selectedCount, 0),
)
</script>
