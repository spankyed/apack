<template>
  <div class="@container flex flex-col h-full bg-neutral-900">
    <!-- Header -->
    <div class="flex items-center justify-between gap-4 px-6 py-3 border-b border-neutral-800">
      <div class="flex items-center gap-2">
        <Sparkle class="w-4 h-4 text-neutral-500" />
        <p class="text-sm text-neutral-400">Manage prompt templates</p>
      </div>
      <Button @click="$emit('create')" variant="primary" data-onboarding-id="prompts-create-button">
        <span>New Prompt</span>
      </Button>
    </div>

    <!-- Prompts Table -->
    <div class="flex-1 overflow-hidden">
      <div v-if="hasPrompts" class="h-full overflow-y-auto custom-scrollbar" @scroll="onScroll">
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
              v-for="prompt in prompts"
              :key="prompt.id"
              class="transition-all duration-200 cursor-pointer group hover:bg-neutral-800"
              @click="$emit('select', prompt.id)"
            >
              <td class="px-6 py-1.5 whitespace-nowrap">
                <span class="text-sm font-medium text-neutral-100">{{ prompt.label }}</span>
              </td>
              <td class="px-6 py-1.5 min-w-[200px]">
                <span class="text-sm text-neutral-400 line-clamp-1" :title="prompt.description">
                  {{ prompt.description || 'No description' }}
                </span>
              </td>
              <td class="px-6 py-1.5">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                  :class="prompt.category ? 'border' : 'text-neutral-500'"
                  :style="categoryStyle(prompt.category)"
                >
                  {{ getCategoryName(prompt.category) }}
                </span>
              </td>
              <td class="px-6 py-1.5 hidden @3xl:table-cell">
                <div class="flex items-center gap-1.5 overflow-hidden">
                  <template v-if="Object.keys(prompt.inputs || {}).length > 0">
                    <span
                      v-for="input in Object.entries(prompt.inputs || {}).slice(0, 2)"
                      :key="input[0]"
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-neutral-800/50 text-neutral-400 border border-neutral-700 whitespace-nowrap flex-shrink-0"
                      :title="input[1].description || ''"
                    >
                      {{ input[1].name || input[0] }}
                    </span>
                    <span
                      v-if="Object.keys(prompt.inputs || {}).length > 2"
                      class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-neutral-800/30 text-neutral-500 whitespace-nowrap flex-shrink-0"
                      :title="Object.keys(prompt.inputs || {}).slice(2).join(', ')"
                    >
                      +{{ Object.keys(prompt.inputs || {}).length - 2 }} more
                    </span>
                  </template>
                  <span v-else class="text-xs text-neutral-500">none</span>
                </div>
              </td>
              <td class="px-6 py-1.5">
                <div class="flex items-center justify-end gap-2">
                  <button
                    @click.stop="confirmDelete(prompt)"
                    class="p-1.5 text-neutral-400 transition-all duration-200 rounded-md hover:text-red-400 hover:bg-red-400/10 active:scale-95"
                    aria-label="Delete prompt"
                    title="Delete prompt"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="loadingMore" class="flex justify-center py-4">
          <span class="text-sm text-neutral-500">Loading more prompts...</span>
        </div>
      </div>

      <!-- Empty State (only when no prompts exist at all) -->
      <div
        v-if="!hasPrompts"
        class="flex flex-col items-center pt-10 h-full"
      >
        <div class="flex flex-col items-center max-w-sm text-center">
          <div class="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-neutral-800">
            <Sparkle class="w-8 h-8 text-neutral-500" />
          </div>
          <h3 class="mb-2 text-lg font-semibold text-neutral-100">No prompts yet</h3>
          <p class="mb-6 text-sm text-neutral-400">
            Create your first prompt template to get started with reusable AI workflows
          </p>
          <Button @click="$emit('create')" variant="primary">
            <Plus class="w-4 h-4" />
            <span>New Prompt</span>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Trash2, Sparkle, Plus } from 'lucide-vue-next';
import Button from '@apackdev/ui/design/button';
import CategoryFilter from '@apackdev/ui/design/CategoryFilter';
import type { Category } from '#generated/types.ts';
import { useInfiniteScroll } from '@apackdev/ui/composables/useInfiniteScroll';
import type { PromptEntity, EARS } from '@apackdev/sdk';

const props = defineProps<{
  prompts: PromptEntity[];
  categories: Category[];
  selectedCategories: readonly string[];
  hasPrompts: boolean;
  hasMore: boolean;
  loadingMore: boolean;
}>();
const emit = defineEmits<{
  select: [promptId: EARS.EntityId];
  create: [];
  edit: [promptId: EARS.EntityId];
  delete: [promptId: EARS.EntityId];
  'toggle-category': [categoryName: string];
  'clear-filters': [];
  'load-more': [];
}>();

const { onScroll } = useInfiniteScroll({
  hasMore: () => props.hasMore,
  loading: () => props.loadingMore,
  onLoadMore: () => emit('load-more'),
})

function confirmDelete(prompt: PromptEntity) {
  if (confirm(`Are you sure you want to delete "${prompt.label}"?`)) {
    emit('delete', prompt.id);
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
