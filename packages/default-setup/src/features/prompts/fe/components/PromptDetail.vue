<template>
  <div class="flex flex-col h-full bg-neutral-900" @keydown="handleKeydown">
    <!-- Header -->
    <NameSaveHeader :isEditing="!!prompt" :isValid="isValid" @back="$emit('back')" @save="handleSave">
      <input
        :value="formData.label"
        @input="$emit('update-label', ($event.target as HTMLInputElement).value)"
        type="text"
        data-onboarding-id="prompt-name-input"
        class="flex-1 min-w-0 px-4 py-2 text-sm font-medium transition-colors border rounded-md bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
        placeholder="Enter prompt name"
      />
      <select
        :value="formData.category || ''"
        @input="$emit('update-category', ($event.target as HTMLSelectElement).value)"
        class="px-3 py-2 text-sm font-medium transition-colors border rounded-md shrink-0 bg-neutral-800 border-neutral-700 text-neutral-100 hover:border-neutral-600 focus:outline-none focus:border-blue-500"
      >
        <option value="">No Category</option>
        <option v-for="category in categories" :key="category.name" :value="category.name">
          {{ category.name }}
        </option>
      </select>
    </NameSaveHeader>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto custom-scrollbar" v-if="prompt || formData">
      <div class="max-w-4xl p-4 mx-auto space-y-6">
        <!-- Input Parameters -->
        <div class="pt-2">
          <CollapsibleSection v-model="inputsExpanded" label="Input Parameters">
            <PromptInputsEditor
              :inputs="formData.inputs"
              @update="$emit('update-inputs', $event)"
            />
          </CollapsibleSection>
        </div>

        <!-- Template Function -->
        <div class="pt-6 border-t border-neutral-800">
          <div class="flex items-center gap-3 mb-2">
            <label class="text-xs font-medium tracking-wider uppercase text-neutral-400">
              Function Template <span class="text-red-400">*</span>
            </label>
            <button
              v-if="prompt"
              @click="openInEditor"
              class="flex items-center gap-1 px-1.5 py-0.5 text-xs transition-colors rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            >
              <ExternalLink class="w-3 h-3" />
              Open in editor
            </button>
          </div>
          <p class="mb-4 text-xs text-neutral-500">
            Write a JavaScript function body that returns a template string. The function will receive a `params` object with your defined inputs.
          </p>
          <div class="overflow-hidden border rounded-md border-neutral-700" style="height: 300px;" data-onboarding-id="prompt-template-editor">
            <PromptTemplateEditor
              :value="formData.templateFn"
              :input-params="formData.inputs"
              @update="$emit('update-template', $event)"
            />
          </div>
        </div>

        <!-- Output Schema -->
        <div class="pt-6 border-t border-neutral-800">
          <CollapsibleSection v-model="outputExpanded" label="Output Schema (Optional)" :defaultOpen="!!formData.outputSchema">
            <div class="space-y-4">
              <JsonSchemaEditor
                :value="formData.outputSchema"
                @update="$emit('update-output-schema', $event)"
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
              class="w-full px-4 py-3 text-sm transition-colors border rounded-md resize-y bg-neutral-800 border-neutral-700 text-neutral-100 focus:outline-none focus:border-blue-500"
              placeholder="Describe what this prompt template does..."
            />
          </CollapsibleSection>
        </div>

        <!-- Metadata -->
        <div class="pt-6 border-t border-neutral-800">
          <CollapsibleSection v-model="metadataExpanded" label="Metadata">
            <div class="flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-neutral-500">
              <span>ID <span class="font-mono text-neutral-400">{{ prompt?.id }}</span></span>
              <span>Created <span class="text-neutral-400">{{ formatDate(prompt?.createdAt) }}</span></span>
              <span>Updated <span class="text-neutral-400">{{ formatDate(prompt?.updatedAt) }}</span></span>
            </div>
          </CollapsibleSection>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ExternalLink } from 'lucide-vue-next';
import NameSaveHeader from '@apackdev/ui/design/NameSaveHeader';
import CollapsibleSection from '@apackdev/ui/design/CollapsibleSection';
import type { Category } from '#generated/types.ts';
import PromptInputsEditor from './PromptInputsEditor.vue';
import PromptTemplateEditor from './PromptTemplateEditor.vue';
import JsonSchemaEditor from '@apackdev/ui/components/JsonSchemaEditor';
import { openSurface } from '#generated/fe.ts'
import { useState } from '#generated/state-fe.ts';
import type { PromptEntity } from '@apackdev/sdk';
import type { TemplateInput } from '@apackdev/sdk';

const props = defineProps<{
  prompt?: PromptEntity;
  formData: {
    label: string;
    description?: string;
    category?: string;
    inputs: Record<string, TemplateInput>;
    templateFn: string;
    outputSchema?: any;
  };
  categories: Category[];
}>();

const emit = defineEmits<{
  'update-label': [value: string];
  'update-description': [value: string];
  'update-category': [value: string];
  'update-inputs': [value: Record<string, TemplateInput>];
  'update-template': [value: string];
  'update-output-schema': [value: any];
  save: [];
  back: [];
}>();

const { state: prompts, send } = useState('prompts');

const inputsExpanded = computed({
  get: () => Boolean(prompts.value.data.formData.inputsExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_INPUTS_SECTION', show }),
});
const outputExpanded = computed({
  get: () => Boolean(prompts.value.data.formData.outputExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_OUTPUT_SECTION', show }),
});
const metadataExpanded = computed({
  get: () => Boolean(prompts.value.data.formData.metadataExpanded),
  set: (show: boolean) => send({ type: 'TOGGLE_METADATA_SECTION', show }),
});

const isValid = computed(() => {
  return props.formData.label.trim() !== '' && props.formData.templateFn.trim() !== '';
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



function formatDate(timestamp?: number) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString();
}

function openInEditor() {
  if (!props.prompt) return;

  // The code surface routes a codePrompts.* event to its prompts panel
  openSurface('code', [
    { type: 'UPDATE_STATE', updates: { selectedPanel: 'prompts' } },
    { type: 'codePrompts.OPEN_PROMPT', promptId: props.prompt.id },
  ]);
}
</script>
