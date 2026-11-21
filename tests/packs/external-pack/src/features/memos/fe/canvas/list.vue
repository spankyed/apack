<script setup lang="ts">
import { ref } from 'vue';
import { useState, useSurface } from '@apackdev/sdk/fe';
// Comes from the host app at runtime, not bundled into the pack
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';
import { id, type MemosState } from '../state.ts';

const actor: MemosState = useSurface();
const { state: memos, send } = useState(actor);
const draft = ref('');
const referenceDraft = ref('');

function add() {
  const text = draft.value.trim();
  if (!text) return;
  send({ type: 'MEMOS.ADD', text });
  draft.value = '';
}
</script>

<template>
  <!-- p-[13px] only exists in the pack's own Tailwind output, so tests can tell pack CSS loaded -->
  <div data-testid="memos-canvas" class="flex flex-col gap-3 p-[13px]">
    <form class="flex gap-2" @submit.prevent="add">
      <input
        v-model="draft"
        data-testid="memo-input"
        type="text"
        placeholder="New memo"
        class="flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
      />
      <button data-testid="memo-add" type="submit" class="rounded-md bg-neutral-800 px-3 py-1.5 text-sm">
        Add
      </button>
    </form>
    <div data-testid="memo-preview">
      <TiptapEditor mode="viewer" :model-value="draft || 'Memo preview'" />
    </div>
    <div data-testid="memo-reference-editor">
      <TiptapEditor mode="editor" v-model="referenceDraft" :show-gutter="false" />
    </div>
    <ul data-testid="memo-list" class="flex flex-col gap-1">
      <li v-for="memo in memos.data.memos" :key="memo.id" class="text-sm">{{ memo.text }}</li>
    </ul>
  </div>
</template>
