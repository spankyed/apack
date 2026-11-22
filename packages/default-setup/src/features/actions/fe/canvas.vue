<template>
  <div class="flex flex-col justify-center h-full">
    <div v-if="actions.data.writeError" class="flex items-center justify-between gap-2 px-3 py-2 text-sm text-red-400 bg-red-500/10 border-b border-red-500/20">
      <span>{{ actions.data.writeError }}</span>
      <button type="button" class="text-xs opacity-70 hover:opacity-100" @click="send({ type: 'CLEAR_WRITE_ERROR' })">Dismiss</button>
    </div>
    <!-- List View -->
    <ActionsList
      v-if="actions.at === 'list'"
      :actions="filteredActions"
      :categories="categories"
      :selected-categories="actions.data.selectedCategories"
      :has-actions="totalCount > 0"
      :has-more="hasMore"
      :loading-more="loadingMore"
      @select="handleSelectAction"
      @create="handleCreateAction"
      @delete="handleDeleteAction"
      @toggle-category="handleToggleCategory"
      @clear-filters="handleClearFilters"
      @load-more="handleLoadMore"
    />

    <!-- Create/Edit View -->
    <ActionDetail
      v-else-if="actions.at === 'create' || actions.at === 'detail'"
      :action="actions.at === 'detail' ? (open.data ?? undefined) : undefined"
      :form-data="actions.data.formData"
      :categories="categories"
      @update-label="handleUpdateLabel"
      @update-description="handleUpdateDescription"
      @update-parameters="handleUpdateParameters"
      @update-action="handleUpdateAction"
      @update-output="handleUpdateOutput"
      @update-category="handleUpdateCategory"
      @save="handleSave"
      @back="handleGoBack"
    />
  </div>
</template>

<script setup lang="ts">
import { useState } from '@apackdev/sdk/fe'

import { computed, watch } from 'vue';
import type { ActionsState } from './state.ts';
import ActionsList from './components/ActionsList.vue';
import ActionDetail from './components/ActionDetail.vue';
import type { EARS } from '@apackdev/sdk';
import type { ActionParameter } from '@apackdev/sdk';
import { useView } from '#generated/fe.ts';
import { useSettings } from '#generated/settings-fe.ts';

const { state: actions, send } = useState<ActionsState>();
const showingList = computed(() => actions.value.at === 'list');
const showingDetail = computed(() => actions.value.at === 'detail');

const settings = useSettings('actions');
const categories = computed(() => settings.value.value?.categories ?? []);

// The list this window shows, and the action it has open: each the view's result for what this window asked, kept
// up to date by the backend, so a change in another window reaches this one without anyone sending it
const list = useView('actions', 'list', () => (showingList.value ? { limit: actions.value.data.listLimit, categories: actions.value.data.selectedCategories } : null), { keepPrevious: true });
const open = useView('actions', 'byId', () => (showingDetail.value && actions.value.data.selectedActionId ? { id: actions.value.data.selectedActionId } : null));

const filteredActions = computed(() => list.data?.actions ?? []);
const totalCount = computed(() => list.data?.totalCount ?? 0);
const hasMore = computed(() => filteredActions.value.length < totalCount.value);
const loadingMore = computed(() => list.status === 'loading');

// The machine fills its form from the open action once, and leaves the detail view when the action is gone
watch(() => [open.status, open.data] as const, ([status, action]) => {
  if (status !== 'ready' || !actions.value.data.selectedActionId) return;
  send({ type: 'ACTION.LOADED', actionId: actions.value.data.selectedActionId, action: action ?? null });
});

// List handlers
function handleSelectAction(actionId: EARS.EntityId) {
  send({ type: 'ACTION.SELECT', actionId });
}

function handleCreateAction() {
  send({ type: 'ACTION.CREATE' });
}

function handleDeleteAction(actionId: EARS.EntityId) {
  send({ type: 'ACTION.DELETE', actionId });
}

function handleLoadMore() {
  send({ type: 'ACTIONS.LOAD_MORE' });
}

// Form handlers
function handleUpdateLabel(label: string) {
  send({ type: 'FORM.UPDATE_LABEL', label });
}

function handleUpdateDescription(description: string) {
  send({ type: 'FORM.UPDATE_DESCRIPTION', description });
}

function handleUpdateParameters(input: Record<string, ActionParameter>) {
  send({ type: 'FORM.UPDATE_PARAMETERS', input });
}

function handleUpdateAction(actionFn: string) {
  send({ type: 'FORM.UPDATE_ACTION', actionFn });
}

function handleUpdateOutput(output: any) {
  send({ type: 'FORM.UPDATE_OUTPUT', output });
}

function handleUpdateCategory(category: string) {
  send({ type: 'FORM.UPDATE_CATEGORY', category });
}

function handleSave() {
  send({ type: 'ACTION.SAVE' });
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