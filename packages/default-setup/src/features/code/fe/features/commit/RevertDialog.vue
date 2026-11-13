<template>
  <Teleport to="body">
    <div
      v-if="show"
      @click.self="onCancel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div class="overflow-hidden border rounded-lg shadow-xl bg-neutral-900 border-neutral-700 w-96">
        <div class="p-4 border-b border-neutral-800">
          <h3 class="text-lg font-semibold text-neutral-100">{{ customTitle || 'Discard Changes' }}</h3>
        </div>

        <div class="p-4">
          <p class="mb-4 text-sm text-neutral-300">
            <template v-if="customMessage">
              {{ customMessage }}
            </template>
            <template v-else-if="fileCount != null && !file">
              Are you sure you want to discard unstaged changes to <strong>{{ fileCount }} files</strong>?
            </template>
            <template v-else>
              Are you sure you want to discard unstaged changes to:
            </template>
          </p>
          <div v-if="file" class="px-3 py-2 mb-4 overflow-hidden rounded bg-neutral-800">
            <code class="block text-sm truncate text-neutral-100" dir="rtl">
              <span dir="ltr">{{ file?.path }}</span>
            </code>
          </div>
          <template v-if="undoable">
            <p v-if="!noneKept" class="text-sm text-neutral-400" data-testid="discard-undoable">
              What this removes is kept, and Undo brings it back for 14 days.
            </p>
            <div v-if="notKept?.length" class="text-sm text-yellow-500" :class="{ 'mt-3': !noneKept }" data-testid="discard-not-kept">
              <AlertCircle class="inline w-4 h-4 mr-1" />
              Too large to keep a copy of, so {{ notKept.length === 1 ? 'this cannot' : 'these cannot' }} be brought back:
              <ul class="mt-1 ml-5 list-disc">
                <li v-for="path in notKept.slice(0, 5)" :key="path" class="truncate"><code>{{ path }}</code></li>
                <li v-if="notKept.length > 5">and {{ notKept.length - 5 }} more</li>
              </ul>
            </div>
          </template>
          <p v-else class="text-sm text-yellow-500">
            <AlertCircle class="inline w-4 h-4 mr-1" />
            This action cannot be undone.
          </p>
        </div>

        <div class="flex justify-end gap-2 p-4 border-t border-neutral-800">
          <button
            @click="onCancel"
            class="px-4 py-2 text-sm font-medium transition-colors rounded text-neutral-300 hover:text-neutral-100 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            @click="onConfirm"
            class="px-4 py-2 text-sm font-medium text-white transition-colors bg-red-600 rounded hover:bg-red-700"
          >
            {{ customTitle ? 'Confirm' : 'Discard Changes' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { AlertCircle } from 'lucide-vue-next'
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts'

const props = defineProps<{
  show: boolean
  file: GitStatusFile | null
  fileCount?: number
  customTitle?: string
  customMessage?: string
  /** Whether what this removes is kept and can be brought back, which a discard of files is */
  undoable?: boolean
  /** The paths it would remove that are too large to keep a copy of */
  notKept?: string[]
}>()

/** Whether nothing of what this removes can be kept, so there is nothing for Undo to bring back */
const noneKept = computed(() => (props.notKept?.length ?? 0) > 0 && props.notKept!.length >= (props.file ? 1 : props.fileCount ?? 0))

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const onConfirm = () => {
  emit('confirm')
}

const onCancel = () => {
  emit('cancel')
}
</script>