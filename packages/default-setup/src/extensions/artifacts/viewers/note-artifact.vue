<template>
  <div class="max-w-3xl h-full flex flex-col min-h-20">
    <div class="rounded-md bg-neutral-850 border border-neutral-800 animate-fade-in flex flex-col min-h-0 flex-1">
      <!-- Header -->
      <div class="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <div class="flex items-center gap-2">
          <StickyNote :size="14" class="text-neutral-400" />
          <h3 class="text-sm font-medium text-neutral-200">
            {{ note?.title || artifact.title || 'Note' }}
          </h3>
        </div>
        <CopyButton :text="noteContent" />
      </div>

      <!-- Note body -->
      <div class="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
        <TiptapEditor
          v-if="noteContent"
          mode="viewer"
          variant="chat"
          :model-value="noteContent"
        />
        <p v-else class="text-xs text-neutral-500 italic">
          Note not found.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { StickyNote } from 'lucide-vue-next'
import type { ArtifactItem } from '@apackdev/sdk/artifacts'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'
import CopyButton from '@apackdev/ui/design/CopyButton'
import { useView } from '#generated/fe.ts'

const props = defineProps<{
  artifact: ArtifactItem<string | { noteId?: string }>
}>()

// The artifact content is a noteId string — look up the note from the notes system
const noteId = computed(() =>
  typeof props.artifact.content === 'string'
    ? props.artifact.content
    : props.artifact.content?.noteId ?? ''
)

// The note with its text, as the notes feature's note view reads it, kept current by the backend
const noteView = useView('notes', 'note', () => (noteId.value ? { id: noteId.value as never } : null))
const note = computed(() => noteView.data ?? undefined)

const noteContent = computed(() => note.value?.content ?? '')
</script>
