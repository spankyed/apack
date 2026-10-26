<template>
  <div class="flex flex-col justify-center h-full">
    <!-- List View -->
    <ActionsList
      v-if="state.hasTag('list-actions')"
      :actions="filteredActions"
      :categories="categories"
      :selected-categories="selectedCategories"
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
      v-else-if="state.hasTag('create-action') || state.hasTag('detail-action')"
      :action="state.hasTag('detail-action') ? (open.data ?? undefined) : undefined"
      :form-data="formData"
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
import { useSurface } from '@apackdev/sdk/fe'

import { computed, watch } from 'vue';
import { useSelector } from '@xstate/vue';
import type { ActionsState } from './state.ts';
import ActionsList from './components/ActionsList.vue';
import ActionDetail from './components/ActionDetail.vue';
import type { EARS } from '@apackdev/sdk';
import type { ActionParameter } from '@apackdev/sdk';
import { useView } from '#generated/fe.ts';
import { useSettings } from '#generated/settings-fe.ts';

const actor: ActionsState = useSurface();
const state = useSelector(actor, (state) => state);
const formData = useSelector(actor, (state) => state.context.formData);
const selectedCategories = useSelector(actor, (state) => state.context.selectedCategories);
const listLimit = useSelector(actor, (state) => state.context.listLimit);
const selectedActionId = useSelector(actor, (state) => state.context.selectedActionId);
const showingList = computed(() => state.value.hasTag('list-actions'));
const showingDetail = computed(() => state.value.hasTag('detail-action'));

const settings = useSettings('actions');
const categories = computed(() => settings.value.value?.categories ?? []);

// The list this window shows, and the action it has open: each the view's result for what this window asked, kept
// up to date by the backend, so a change in another window reaches this one without anyone sending it
const list = useView('actions', 'list', () => (showingList.value ? { limit: listLimit.value, categories: selectedCategories.value } : null), { keepPrevious: true });
const open = useView('actions', 'byId', () => (showingDetail.value && selectedActionId.value ? { id: selectedActionId.value } : null));

const filteredActions = computed(() => list.data?.actions ?? []);
const totalCount = computed(() => list.data?.totalCount ?? 0);
const hasMore = computed(() => filteredActions.value.length < totalCount.value);
const loadingMore = computed(() => list.status === 'loading');

// The machine fills its form from the open action once, and leaves the detail view when the action is gone
watch(() => [open.status, open.data] as const, ([status, action]) => {
  if (status !== 'ready' || !selectedActionId.value) return;
  actor.send({ type: 'ACTION.LOADED', actionId: selectedActionId.value, action: action ?? null });
});

// List handlers
function handleSelectAction(actionId: EARS.EntityId) {
  actor.send({ type: 'ACTION.SELECT', actionId });
}

function handleCreateAction() {
  actor.send({ type: 'ACTION.CREATE' });
}

function handleDeleteAction(actionId: EARS.EntityId) {
  actor.send({ type: 'ACTION.DELETE', actionId });
}

function handleLoadMore() {
  actor.send({ type: 'ACTIONS.LOAD_MORE' });
}

// Form handlers
function handleUpdateLabel(label: string) {
  actor.send({ type: 'FORM.UPDATE_LABEL', label });
}

function handleUpdateDescription(description: string) {
  actor.send({ type: 'FORM.UPDATE_DESCRIPTION', description });
}

function handleUpdateParameters(input: Record<string, ActionParameter>) {
  actor.send({ type: 'FORM.UPDATE_PARAMETERS', input });
}

function handleUpdateAction(actionFn: string) {
  actor.send({ type: 'FORM.UPDATE_ACTION', actionFn });
}

function handleUpdateOutput(output: any) {
  actor.send({ type: 'FORM.UPDATE_OUTPUT', output });
}

function handleUpdateCategory(category: string) {
  actor.send({ type: 'FORM.UPDATE_CATEGORY', category });
}

function handleSave() {
  actor.send({ type: 'ACTION.SAVE' });
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