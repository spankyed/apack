<template>
  <div class="flex flex-col justify-center h-full">
    <div v-if="prompts.data.writeError" class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-red-400 bg-red-500/10 border-b border-red-500/20">
      <span>{{ prompts.data.writeError }}</span>
      <button type="button" class="text-xs opacity-70 hover:opacity-100" @click="send({ type: 'CLEAR_WRITE_ERROR' })">Dismiss</button>
    </div>
    <!-- List View -->
    <PromptsList
      v-if="prompts.at === 'list'"
      :prompts="filteredPrompts"
      :categories="categories"
      :selected-categories="prompts.data.selectedCategories"
      :has-prompts="totalCount > 0"
      :has-more="hasMore"
      :loading-more="loadingMore"
      @select="handleSelectPrompt"
      @create="handleCreatePrompt"
      @edit="handleEditPrompt"
      @delete="handleDeletePrompt"
      @toggle-category="handleToggleCategory"
      @clear-filters="handleClearFilters"
      @load-more="handleLoadMore"
    />

    <!-- Create/Edit View -->
    <PromptDetail
      v-else-if="prompts.at === 'create' || prompts.at === 'detail'"
      :prompt="prompts.at === 'detail' ? (open.data ?? undefined) : undefined"
      :form-data="prompts.data.formData"
      :categories="categories"
      @update-label="handleUpdateLabel"
      @update-description="handleUpdateDescription"
      @update-inputs="handleUpdateInputs"
      @update-template="handleUpdateTemplate"
      @update-output-schema="handleUpdateOutputSchema"
      @update-category="handleUpdateCategory"
      @save="handleSave"
      @back="handleGoBack"
    />
  </div>
</template>

<script setup lang="ts">
import { useState } from '@apackdev/sdk/fe'

import { computed, watch } from 'vue';
import type { PromptsState } from './state.ts';
import PromptsList from './components/PromptsList.vue';
import PromptDetail from './components/PromptDetail.vue';
import type { EARS } from '@apackdev/sdk';
import type { TemplateInput } from '@apackdev/sdk';
import { useView } from '#generated/fe.ts';
import { useSettings } from '#generated/settings-fe.ts';

const { state: prompts, send } = useState<PromptsState>();
const showingList = computed(() => prompts.value.at === 'list');
const showingDetail = computed(() => prompts.value.at === 'detail');

const settings = useSettings('prompts');
const categories = computed(() => settings.value.value?.categories ?? []);

// The list this window shows, and the prompt it has open: each the view's result for what this window asked, kept
// up to date by the backend, so a change in another window reaches this one without anyone sending it
const list = useView('prompts', 'list', () => (showingList.value ? { limit: prompts.value.data.listLimit, categories: prompts.value.data.selectedCategories } : null), { keepPrevious: true });
const open = useView('prompts', 'byId', () => (showingDetail.value && prompts.value.data.selectedPromptId ? { id: prompts.value.data.selectedPromptId } : null));

const filteredPrompts = computed(() => list.data?.prompts ?? []);
const totalCount = computed(() => list.data?.totalCount ?? 0);
const hasMore = computed(() => filteredPrompts.value.length < totalCount.value);
const loadingMore = computed(() => list.status === 'loading');

// The machine fills its form from the open prompt once, and leaves the detail view when the prompt is gone
watch(() => [open.status, open.data] as const, ([status, prompt]) => {
  if (status !== 'ready' || !prompts.value.data.selectedPromptId) return;
  send({ type: 'PROMPT.LOADED', promptId: prompts.value.data.selectedPromptId, prompt: prompt ?? null });
});

// List handlers
function handleSelectPrompt(promptId: EARS.EntityId) {
  send({ type: 'PROMPT.SELECT', promptId });
}

function handleCreatePrompt() {
  send({ type: 'PROMPT.CREATE' });
}

function handleEditPrompt(promptId: EARS.EntityId) {
  // Navigate to detail page, then toggle edit mode
  send({ type: 'PROMPT.SELECT', promptId });
  // Note: The detail view will handle editing functionality
}

function handleDeletePrompt(promptId: EARS.EntityId) {
  send({ type: 'PROMPT.DELETE', promptId });
}

function handleLoadMore() {
  send({ type: 'PROMPTS.LOAD_MORE' });
}

// Form handlers
function handleUpdateLabel(label: string) {
  send({ type: 'FORM.UPDATE_LABEL', label });
}

function handleUpdateDescription(description: string) {
  send({ type: 'FORM.UPDATE_DESCRIPTION', description });
}

function handleUpdateInputs(inputs: Record<string, TemplateInput>) {
  send({ type: 'FORM.UPDATE_INPUTS', inputs });
}

function handleUpdateTemplate(templateFn: string) {
  send({ type: 'FORM.UPDATE_TEMPLATE', templateFn });
}

function handleUpdateOutputSchema(outputSchema: any) {
  send({ type: 'FORM.UPDATE_OUTPUT_SCHEMA', outputSchema });
}

function handleUpdateCategory(category: string) {
  send({ type: 'FORM.UPDATE_CATEGORY', category });
}

function handleSave() {
  send({ type: 'PROMPT.SAVE' });
}

function handleGoBack() {
  send({ type: 'VIEW_LIST' });
}

// Filter handlers
function handleToggleCategory(categoryName: string) {
  send({ type: 'FILTER.TOGGLE_CATEGORY', categoryName });
}

function handleClearFilters() {
  send({ type: 'FILTER.CLEAR' });
}
</script> 