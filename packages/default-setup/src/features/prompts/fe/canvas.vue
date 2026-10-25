<template>
  <div class="flex flex-col justify-center h-full">
    <!-- List View -->
    <PromptsList
      v-if="state.hasTag('list-prompts')"
      :prompts="filteredPrompts"
      :categories="categories"
      :selected-categories="selectedCategories"
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
      v-else-if="state.hasTag('create-prompt') || state.hasTag('detail-prompt')"
      :prompt="state.hasTag('detail-prompt') ? (open.data ?? undefined) : undefined"
      :form-data="formData"
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
import { useSurface } from '@apackdev/sdk/fe'

import { computed, watch } from 'vue';
import { useSelector } from '@xstate/vue';
import type { PromptsState } from './state.ts';
import PromptsList from './components/PromptsList.vue';
import PromptDetail from './components/PromptDetail.vue';
import type { EARS } from '@apackdev/sdk';
import type { TemplateInput } from '@apackdev/sdk';
import { useView } from '#generated/fe.ts';
import { useSettings } from '#generated/settings-fe.ts';

const actor: PromptsState = useSurface();
const state = useSelector(actor, (state) => state);
const formData = useSelector(actor, (state) => state.context.formData);
const selectedCategories = useSelector(actor, (state) => state.context.selectedCategories);
const listLimit = useSelector(actor, (state) => state.context.listLimit);
const selectedPromptId = useSelector(actor, (state) => state.context.selectedPromptId);
const showingList = computed(() => state.value.hasTag('list-prompts'));
const showingDetail = computed(() => state.value.hasTag('detail-prompt'));

const settings = useSettings('prompts');
const categories = computed(() => settings.value.value?.categories ?? []);

// The list this window shows, and the prompt it has open: each the view's result for what this window asked, kept
// up to date by the backend, so a change in another window reaches this one without anyone sending it
const list = useView('prompts', 'list', () => (showingList.value ? { limit: listLimit.value, categories: selectedCategories.value } : null), { keepPrevious: true });
const open = useView('prompts', 'byId', () => (showingDetail.value && selectedPromptId.value ? { id: selectedPromptId.value } : null));

const filteredPrompts = computed(() => list.data?.prompts ?? []);
const totalCount = computed(() => list.data?.totalCount ?? 0);
const hasMore = computed(() => filteredPrompts.value.length < totalCount.value);
const loadingMore = computed(() => list.status === 'loading');

// The machine fills its form from the open prompt once, and leaves the detail view when the prompt is gone
watch(() => [open.status, open.data] as const, ([status, prompt]) => {
  if (status !== 'ready' || !selectedPromptId.value) return;
  actor.send({ type: 'PROMPT.LOADED', promptId: selectedPromptId.value, prompt: prompt ?? null });
});

// List handlers
function handleSelectPrompt(promptId: EARS.EntityId) {
  actor.send({ type: 'PROMPT.SELECT', promptId });
}

function handleCreatePrompt() {
  actor.send({ type: 'PROMPT.CREATE' });
}

function handleEditPrompt(promptId: EARS.EntityId) {
  // Navigate to detail page, then toggle edit mode
  actor.send({ type: 'PROMPT.SELECT', promptId });
  // Note: The detail view will handle editing functionality
}

function handleDeletePrompt(promptId: EARS.EntityId) {
  actor.send({ type: 'PROMPT.DELETE', promptId });
}

function handleLoadMore() {
  actor.send({ type: 'PROMPTS.LOAD_MORE' });
}

// Form handlers
function handleUpdateLabel(label: string) {
  actor.send({ type: 'FORM.UPDATE_LABEL', label });
}

function handleUpdateDescription(description: string) {
  actor.send({ type: 'FORM.UPDATE_DESCRIPTION', description });
}

function handleUpdateInputs(inputs: Record<string, TemplateInput>) {
  actor.send({ type: 'FORM.UPDATE_INPUTS', inputs });
}

function handleUpdateTemplate(templateFn: string) {
  actor.send({ type: 'FORM.UPDATE_TEMPLATE', templateFn });
}

function handleUpdateOutputSchema(outputSchema: any) {
  actor.send({ type: 'FORM.UPDATE_OUTPUT_SCHEMA', outputSchema });
}

function handleUpdateCategory(category: string) {
  actor.send({ type: 'FORM.UPDATE_CATEGORY', category });
}

function handleSave() {
  actor.send({ type: 'PROMPT.SAVE' });
}

function handleGoBack() {
  actor.send({ type: 'VIEW_LIST' });
}

// Filter handlers
function handleToggleCategory(categoryName: string) {
  actor.send({ type: 'FILTER.TOGGLE_CATEGORY', categoryName });
}

function handleClearFilters() {
  actor.send({ type: 'FILTER.CLEAR' });
}
</script> 