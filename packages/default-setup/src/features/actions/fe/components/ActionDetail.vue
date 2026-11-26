<template>
  <div class="flex flex-col h-full bg-neutral-900" @keydown="handleKeydown">
    <!-- Header -->
    <NameSaveHeader :isEditing="!!action" :isValid="isValid" @back="$emit('back')" @save="handleSave">
      <input
        :value="formData.label"
        @input="$emit('update-label', ($event.target as HTMLInputElement).value)"
        type="text"
        data-onboarding-id="action-label-input"
        class="flex-1 min-w-0 px-4 py-2 text-sm font-medium transition-colors border rounded-md bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
        placeholder="Enter action name"
      />
      <select
        :value="formData.category || ''"
        @input="$emit('update-category', ($event.target as HTMLSelectElement).value)"
        class="px-3 py-2 text-sm font-medium transition-colors border rounded-md shrink-0 bg-neutral-800 border-neutral-700 text-neutral-100 hover:border-neutral-600 focus:outline-none focus:border-blue-500"
      >
        <option value="">No Category</option>
        <option
          v-for="category in categories"
          :key="category.name"
          :value="category.name"
        >
          {{ category.name }}
        </option>
      </select>
    </NameSaveHeader>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <div class="max-w-4xl p-4 mx-auto">
        <div class="space-y-6">
          <!-- Parameters -->
          <div class="pt-2">
            <CollapsibleSection v-model="parametersExpanded" label="Input Parameters">
              <ActionParametersEditor
                :parameters="formData.input"
                @update="$emit('update-parameters', $event)"
              />
            </CollapsibleSection>
          </div>

          <!-- Action Function -->
          <div class="pt-6 border-t border-neutral-800">
            <div class="flex items-center gap-3 mb-2">
              <label class="text-xs font-medium tracking-wider uppercase text-neutral-400">
                Function Template<span class="text-red-400">*</span>
              </label>
              <button
                v-if="action"
                @click="openInEditor"
                class="flex items-center gap-1 px-1.5 py-0.5 text-xs transition-colors rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
              >
                <ExternalLink class="w-3 h-3" />
                Open in editor
              </button>
            </div>
            <p class="mb-4 text-xs text-neutral-500" data-onboarding-id="action-services-info">
              An async JavaScript function body that receives `params` object and `services` (logger, database, LLM, http) object.
            </p>
            <div class="overflow-hidden border rounded-md border-neutral-700" style="height: 400px;" data-onboarding-id="action-function-editor">
              <ActionFunctionEditor
                :value="formData.actionFn"
                :input-params="formData.input"
                @update="$emit('update-action', $event)"
              />
            </div>
          </div>

          <!-- Output Schema -->
          <div class="pt-6 border-t border-neutral-800">
            <CollapsibleSection v-model="outputExpanded" label="Output Schema (Optional)" :defaultOpen="!!formData.output">
              <div class="space-y-4">
                <JsonSchemaEditor
                  :value="formData.output"
                  @update="$emit('update-output', $event)"
                />
              </div>
            </CollapsibleSection>
          </div>

          <!-- Description -->
          <div class="pt-6 border-t border-neutral-800">
            <CollapsibleSection label="Description" :defaultOpen="false">
              <textarea
                :value="formData.description"
                @input="$emit('update-description', ($event.target as HTMLTextAreaElement).value)"
                rows="3"
                data-onboarding-id="action-description-input"
                class="w-full px-4 py-3 text-sm transition-colors border rounded-md resize-y bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
                placeholder="Describe what this action does..."
              />
            </CollapsibleSection>
          </div>

          <!-- Metadata -->
          <div class="pt-6 border-t border-neutral-800">
            <CollapsibleSection v-model="metadataExpanded" label="Metadata">
              <div class="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-neutral-500 w-full">
                <span>ID <span class="font-mono text-neutral-400">{{ action?.id }}</span></span>
                <span>Created <span class="text-neutral-400">{{ formatDate(action?.createdAt) }}</span></span>
                <span>Updated <span class="text-neutral-400">{{ formatDate(action?.updatedAt) }}</span></span>
              </div>
            </CollapsibleSection>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Category } from '#generated/types.ts';
import { ExternalLink } from 'lucide-vue-next';
import NameSaveHeader from '@apackdev/ui/design/NameSaveHeader';
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection';
import ActionParametersEditor from './ActionParametersEditor.vue';
import ActionFunctionEditor from './ActionFunctionEditor.vue';
import JsonSchemaEditor from '@apackdev/ui/components/JsonSchemaEditor';
import { openSurface } from '#generated/fe.ts'
import { useState } from '#generated/state-fe.ts';
import type { ActionEntity } from '@apackdev/sdk';
import type { ActionParameter } from '@apackdev/sdk';

const props = defineProps<{
  action?: ActionEntity;
  formData: {
    label: string;
    description?: string;
    category?: string;
    input: Record<string, ActionParameter>;
    actionFn: string;
    output?: any;
  };
  categories: Category[];
}>();

const emit = defineEmits<{
  'update-label': [value: string];
  'update-description': [value: string];
  'update-category': [value: string];
  'update-parameters': [value: Record<string, ActionParameter>];
  'update-action': [value: string];
  'update-output': [value: any];
  save: [];
  back: [];
}>();

const { state: actions, send } = useState('actions');

const parametersExpanded = computed({
  get: () => Boolean(actions.value.data.formData.parametersExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_PARAMETERS_SECTION', show }),
});
const outputExpanded = computed({
  get: () => Boolean(actions.value.data.formData.outputExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_OUTPUT_SECTION', show }),
});
const metadataExpanded = computed({
  get: () => Boolean(actions.value.data.formData.metadataExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_METADATA_SECTION', show }),
});

const isValid = computed(() => {
  return props.formData.label.trim() !== '' && props.formData.actionFn.trim() !== '';
});

function handleSave() {
  if (isValid.value) {
    emit('save');
  }
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault();
    handleSave();
  }
}

function openInEditor() {
  if (!props.action) return;

  // The code surface routes a codeActions.* event to its actions panel
  openSurface('code', [
    { type: 'UPDATE_STATE', updates: { selectedPanel: 'actions' } },
    { type: 'codeActions.OPEN_ACTION', actionId: props.action.id },
  ]);
}

function formatDate(timestamp?: number) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString();
}

</script>
