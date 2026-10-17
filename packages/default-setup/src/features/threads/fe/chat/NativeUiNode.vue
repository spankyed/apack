<template>
  <div v-if="node.kind === 'box'" class="flex flex-col gap-1 min-w-0" :data-native-plugin="node.plugin">
    <NativeUiNode v-for="(child, index) in node.children" :key="child.kind === 'input' || child.kind === 'select' ? child.actionId : index" :node="child" @press="(actionId, href) => emit('press', actionId, href)" @field="emit('field', $event)" />
  </div>
  <NativeUiDocument v-else-if="node.kind === 'markdown' || node.kind === 'code'" :node="node" @press="(actionId, href) => emit('press', actionId, href)" />
  <NativeUiField v-else-if="node.kind === 'input' || node.kind === 'select'" :key="node.actionId" :node="node" @field="emit('field', $event)" />
  <span v-else-if="node.kind === 'text'" class="whitespace-pre-wrap break-words" :data-native-plugin="node.plugin">{{ node.text }}</span>
  <button v-else-if="node.kind === 'button'" type="button" :disabled="!node.actionId" :data-native-plugin="node.plugin"
    class="self-start max-w-full whitespace-normal break-words rounded border border-neutral-600 px-2 py-1 text-left text-neutral-200 hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-50"
    @click="node.actionId && emit('press', node.actionId)">{{ node.label }}</button>
  <span v-else-if="node.component !== 'engine'" class="text-neutral-500" :data-native-plugin="node.plugin">Unsupported Claude component: {{ node.component }}</span>
</template>

<script setup lang="ts">
import NativeUiDocument from './NativeUiDocument.vue'
import NativeUiField from './NativeUiField.vue'
import type { ClaudeUiNode, ClaudeUiFieldEvent } from '#generated/types.ts'
defineProps<{ node: ClaudeUiNode }>()
const emit = defineEmits<{ press: [actionId: string, href?: string]; field: [event: ClaudeUiFieldEvent] }>()
</script>
