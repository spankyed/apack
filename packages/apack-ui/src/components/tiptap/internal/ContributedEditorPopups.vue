<template>
  <component v-for="popup in popups" :key="`${generation}/${popup.id}`" :is="popup.component"
    :editor="editor" :variant="variant" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { TextEditorExtensionsBinding } from '@apackdev/sdk/fe'
import type { TiptapVariant } from '../extensions.ts'

const props = defineProps<{
  editor: Editor
  groups: TextEditorExtensionsBinding[]
  generation: number
  variant: TiptapVariant
}>()
const popups = computed(() => props.groups.flatMap(group => Object.entries(group.binding.popups ?? {})
  .map(([id, component]) => ({ id: `${group.packId}/${group.groupId}/${id}`, component }))))
</script>
