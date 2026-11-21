<template>
  <div class="@container flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4 px-6 py-3 border-b border-neutral-800">
      <div class="flex items-center gap-2">
        <Play class="w-4 h-4 text-neutral-500" />
        <p class="text-sm text-neutral-400">Manage action templates</p>
      </div>
      <Button @click="$emit('create')" variant="primary" data-onboarding-id="actions-create-button">
        <span>New Action</span>
      </Button>
    </div>

    <!-- Actions Table -->
    <div class="flex-1 overflow-hidden">
      <div v-if="hasActions" class="h-full overflow-y-auto custom-scrollbar" @scroll="onScroll">
        <table class="w-full">
          <thead class="sticky top-0 z-10 bg-neutral-900">
            <tr class="text-xs font-medium tracking-wider text-left uppercase border-b text-neutral-400 border-neutral-800">
              <th class="px-6 py-3">Label</th>
              <th class="px-6 py-3">Description</th>
              <th class="p-0">
                <CategoryFilter
                  :categories="categories"
                  :selected-categories="selectedCategories"
                  @toggle-category="$emit('toggle-category', $event)"
                  @clear-filters="$emit('clear-filters')"
                />
              </th>
              <th class="px-6 py-3 hidden @3xl:table-cell">Inputs</th>
              <th class="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="action in actions"
              :key="action.id"
              class="transition-all duration-200 cursor-pointer group hover:bg-neutral-800"
              @click="$emit('select', action.id)"
            >
              <td class="px-6 py-1.5 whitespace-nowrap">
                <span class="text-sm font-medium text-neutral-100">{{ action.label }}</span>
              </td>
              <td class="px-6 py-1.5 min-w-[200px]">
                <span class="text-sm text-neutral-400 line-clamp-1" :title="action.description">
                  {{ action.description || 'No description' }}
                </span>
              </td>
              <td class="px-6 py-1.5">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                  :class="action.category ? 'border' : 'text-neutral-500'"
                  :style="categoryStyle(action.category)"
                >
                  {{ getCategoryName(action.category) }}
                </span>
              </td>
              <td class="px-6 py-1.5 hidden @3xl:table-cell">
                <div class="flex items-center gap-1.5 overflow-hidden">
                  <template v-if="Object.keys(action.input || {}).length > 0">
                    <span
                      v-for="param in Object.entries(action.input || {}).slice(0, 2)"
                      :key="param[0]"
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-neutral-800/50 text-neutral-400 border border-neutral-700 whitespace-nowrap flex-shrink-0"
                      :title="param[1].description || ''"
                    >
                      {{ param[0] }}
                    </span>
                    <span
                      v-if="Object.keys(action.input || {}).length > 2"
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-neutral-800/30 text-neutral-500 whitespace-nowrap flex-shrink-0"
                      :title="Object.keys(action.input || {}).slice(2).join(', ')"
                    >
                      +{{ Object.keys(action.input || {}).length - 2 }} more
                    </span>
                  </template>
                  <span v-else class="text-xs text-neutral-500">none</span>
                </div>
              </td>
              <td class="px-6 py-1.5">
                <div class="flex items-center justify-end gap-2">
                  <button
                    @click.stop="handleDelete(action.id)"
                    data-onboarding-id="action-delete-button"
                    class="p-1.5 text-neutral-400 transition-all duration-200 rounded-md hover:text-red-400 hover:bg-red-400/10 active:scale-95"
                    aria-label="Delete action"
                    title="Delete action"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loadingMore" class="flex justify-center py-4">
          <span class="text-sm text-neutral-500">Loading more actions...</span>
        </div>
      </div>
      <!-- Empty State (only when no actions exist at all) -->
      <div v-if="!hasActions" class="flex flex-col items-center pt-10 h-full">
        <div class="text-center">
          <Play class="w-12 h-12 mx-auto mb-4 text-neutral-600" />
          <h3 class="mb-2 text-lg font-medium text-neutral-300">No actions yet</h3>
          <p class="mb-4 text-sm text-neutral-500">Create your first action function to get started</p>
          <Button @click="$emit('create')" variant="primary" class="justify-self-center">
            <Plus class="w-4 h-4" />
            <span>New Action</span>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Category } from '#generated/types.ts'
import { Play, Trash2, Plus } from 'lucide-vue-next'
import Button from '@apackdev/ui/design/button'
import CategoryFilter from '@apackdev/ui/design/CategoryFilter'
import { useInfiniteScroll } from '@apackdev/ui/composables/useInfiniteScroll'
import type { ActionEntity, EARS } from '@apackdev/sdk'

interface Props {
  actions: ActionEntity[]
  categories: Category[]
  selectedCategories: readonly string[]
  hasActions: boolean
  hasMore: boolean
  loadingMore: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'select': [actionId: EARS.EntityId]
  'create': []
  'delete': [actionId: EARS.EntityId]
  'toggle-category': [categoryName: string]
  'clear-filters': []
  'load-more': []
}>()

const { onScroll } = useInfiniteScroll({
  hasMore: () => props.hasMore,
  loading: () => props.loadingMore,
  onLoadMore: () => emit('load-more'),
})

function handleDelete(actionId: EARS.EntityId) {
  if (confirm('Are you sure you want to delete this action?')) {
    emit('delete', actionId)
  }
}

// Get category name and style
function getCategoryName(categoryName?: string) {
  if (!categoryName) return 'none';
  const category = props.categories.find(c => c.name === categoryName);
  return category?.name || categoryName;
}

function categoryStyle(categoryName?: string) {
  if (!categoryName) return {}; // Return empty object for inline styles when no category

  const category = props.categories.find(c => c.name === categoryName);
  if (!category) {
    // Default style for unrecognized categories - neutral like input fields
    return {
      backgroundColor: 'rgb(38 38 38)', // bg-neutral-800
      color: 'rgb(245 245 245)', // text-neutral-100
      borderColor: 'rgb(64 64 64)' // border-neutral-700
    };
  }

  // Create inline styles using the category color
  return {
    backgroundColor: `${category.color}1A`, // 10% opacity
    color: category.color,
    borderColor: `${category.color}33` // 20% opacity
  };
}
</script>

<style scoped>
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: #525252 #171717;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 8px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: #171717;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #525252;
  border-radius: 4px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #737373;
}

.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
