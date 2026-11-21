<template>
  <div class="flex flex-col h-full border-r border-neutral-800">
    <QueryEditorHeader
      :active-mode="activeMode"
      @update:active-mode="$emit('update:activeMode', $event)"
      :is-loading="isLoading"
      :current-query="database.data.currentQuery"
      :error="database.data.error"
      :success-message="successMessage"
      :mode="database.data.mode"
      :execute-query="database.data.settings?.hotkeys?.executeQuery ?? undefined"
      :is-ai-prompt-open="showAiPrompt"
      @execute="handleExecute"
      @clear="handleClear"
      @ai-query="toggleAiPrompt"
      @toggle-mode="handleToggleMode"
    />

    <!-- Inline AI prompt input -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0 -translate-y-1 max-h-0"
      enter-to-class="opacity-100 translate-y-0 max-h-40"
      leave-from-class="opacity-100 translate-y-0 max-h-40"
      leave-to-class="opacity-0 -translate-y-1 max-h-0"
    >
      <div v-if="showAiPrompt" ref="aiPromptContainer" class="border-b border-neutral-800 overflow-hidden">
        <div class="flex items-start gap-2 px-3 py-2 bg-neutral-800">
          <textarea
            ref="aiPromptInput"
            v-model="aiPrompt"
            placeholder="Describe what you want to query..."
            class="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 resize-none focus:outline-none leading-5"
            rows="1"
            @keydown="handleAiPromptKeydown"
            @input="autoGrow"
          />
          <button
            v-if="aiPrompt.trim()"
            class="mt-0.5 text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors shrink-0"
            @click="submitAiPrompt"
          >
            ↵
          </button>
        </div>
      </div>
    </Transition>

    <div class="flex-1 overflow-hidden relative">
      <SimpleMonacoEditor
        v-if="activeMode === 'query'"
        v-model="editorQuery"
        language="typescript"
        :function-body="true"
        dsl-type="database"
        :actions="['executeCode']"
        :execute-keybinding="database.data.settings?.hotkeys?.executeQuery || undefined"
        @execute="handleExecute"
        class="h-full"
      />

      <QueryEditorExamples
        v-else
        @select="handleExampleSelect"
      />

      <!-- Loading overlay for AI query generation -->
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div
          v-if="database.data.isAiQueryLoading && activeMode === 'query'"
          class="absolute inset-0 flex items-center justify-center bg-neutral-900/80 backdrop-blur-sm z-10"
        >
          <div class="flex flex-col items-center space-y-3">
            <div class="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
            <div class="text-sm text-neutral-300">
              Generating {{ database.data.mode === 'transaction' ? 'transaction' : 'query' }} from prompt...
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { isRunningCode, type DatabaseState } from '../state.ts';
import QueryEditorHeader from './query-editor/QueryEditorHeader.vue';
import SimpleMonacoEditor from '@apackdev/ui/components/SimpleMonacoEditor';
import QueryEditorExamples from './query-editor/QueryEditorExamples.vue';

const actor: DatabaseState = useSurface();
const { state: database, send } = useState(actor);
const isLoading = computed(() => isRunningCode(database.value.data.making));

// Props and emits
defineProps<{
  activeMode: 'query' | 'examples';
}>();

const emit = defineEmits<{
  'update:activeMode': [mode: 'query' | 'examples'];
}>();

// Local state
const successMessage = ref('');
const showAiPrompt = ref(false);
const aiPrompt = ref('');
const aiPromptInput = ref<HTMLTextAreaElement | null>(null);
const aiPromptContainer = ref<HTMLElement | null>(null);
const editorQuery = ref(database.value.data.currentQuery);

// Sync editor query with state
watch(() => database.value.data.currentQuery, (newQuery) => {
  editorQuery.value = newQuery;
});

watch(editorQuery, (newQuery) => {
  send({
    type: 'QUERY.UPDATE',
    code: newQuery
  });
});

// Clear success message after delay
watch(successMessage, (msg) => {
  if (msg) {
    setTimeout(() => {
      successMessage.value = '';
    }, SUCCESS_MESSAGE_TIMEOUT);
  }
});

// Close prompt bar on outside click (ignore clicks on the wand toggle button)
function handleOutsideClick(e: MouseEvent) {
  if (!showAiPrompt.value || !aiPromptContainer.value) return;
  const target = e.target as HTMLElement;
  if (aiPromptContainer.value.contains(target)) return;
  if (target.closest('[title="Generate query with AI"]')) return;
  showAiPrompt.value = false;
}
onMounted(() => document.addEventListener('mousedown', handleOutsideClick));
onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick));

// Close prompt bar when generation starts
watch(() => database.value.data.isAiQueryLoading, (loading) => {
  if (loading) {
    showAiPrompt.value = false;
  }
});

const SUCCESS_MESSAGES = {
  query: 'Query executed successfully',
  transaction: 'Transaction executed successfully'
} as const;

const SUCCESS_MESSAGE_DELAY = 100;
const SUCCESS_MESSAGE_TIMEOUT = 3000;

function handleExecute() {
  if (!isLoading.value && editorQuery.value.trim()) {
    send({
      type: database.value.data.mode === 'query' ? 'QUERY.EXECUTE' : 'TRANSACTION.EXECUTE',
      code: editorQuery.value
    });

    setTimeout(() => {
      if (!database.value.data.error) {
        successMessage.value = SUCCESS_MESSAGES[database.value.data.mode];
      }
    }, SUCCESS_MESSAGE_DELAY);
  }
}

function handleClear() {
  editorQuery.value = '';
}

function toggleAiPrompt() {
  showAiPrompt.value = !showAiPrompt.value;
  if (showAiPrompt.value) {
    nextTick(() => {
      aiPromptInput.value?.focus();
    });
  }
}

function submitAiPrompt() {
  const prompt = aiPrompt.value.trim();
  if (!prompt) return;
  send({
    type: 'AI_QUERY.GENERATE',
    prompt,
    mode: database.value.data.mode,
  });
  aiPrompt.value = '';
}

function handleAiPromptKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitAiPrompt();
  } else if (e.key === 'Escape') {
    showAiPrompt.value = false;
  }
}

function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleExampleSelect(query: string) {
  editorQuery.value = query;
  emit('update:activeMode', 'query');
}

function handleToggleMode() {
  send({
    type: 'MODE.TOGGLE'
  });
}
</script>
