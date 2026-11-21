<template>
  <div class="flex flex-col flex-1 overflow-y-auto p-3 gap-3">
    <!-- Title -->
    <div>
      <label class="block text-xs text-neutral-400 mb-1">Title</label>
      <input
        :value="title"
        @input="$emit('update-field', 'title', ($event.target as HTMLInputElement).value)"
        placeholder="PR title"
        class="w-full px-2 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-blue-600"
      />
    </div>

    <!-- Body -->
    <div class="flex-1 flex flex-col min-h-0">
      <label class="block text-xs text-neutral-400 mb-1">Description</label>
      <div class="flex-1 min-h-[80px] max-h-[200px] overflow-y-auto rounded bg-neutral-800 border border-neutral-700">
        <TiptapEditor
          mode="editor"
          :modelValue="body"
          @update:modelValue="$emit('update-field', 'body', $event)"
          placeholder="Describe your changes..."
          editorClass="pr-create-editor"
          disableImages
        />
      </div>
    </div>

    <!-- Branches: head → base -->
    <div>
      <label class="block text-xs text-neutral-400 mb-1">Merge into</label>
      <div class="flex items-center gap-1.5">
        <div
          class="flex items-center gap-1 px-2 py-1.5 text-xs rounded bg-neutral-800/60 border border-neutral-700 text-neutral-300 min-w-0"
          :title="headBranch || 'Current branch'"
        >
          <GitBranch :size="11" class="shrink-0 text-neutral-500" />
          <span class="truncate">{{ headBranch || '(current branch)' }}</span>
        </div>
        <ArrowRight :size="12" class="shrink-0 text-neutral-500" />
        <select
          :value="baseBranch || defaultBaseBranch"
          @change="$emit('update-field', 'baseBranch', ($event.target as HTMLSelectElement).value)"
          class="flex-1 min-w-0 px-2 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 text-neutral-200 focus:outline-none focus:border-blue-600 appearance-none cursor-pointer"
        >
          <option
            v-for="branch in branchOptions"
            :key="branch"
            :value="branch"
          >{{ branch }}</option>
        </select>
      </div>
    </div>

    <!-- Actions -->
    <div class="flex items-center gap-2 pt-1">
      <button
        @click="$emit('submit')"
        :disabled="!title.trim() || isCreating"
        class="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Loader2 v-if="isCreating" :size="12" class="animate-spin" />
        <GitPullRequest v-else :size="12" />
        <span>Create PR</span>
      </button>
      <button
        @click="$emit('submit-draft')"
        :disabled="!title.trim() || isCreating"
        class="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FileEdit :size="12" />
        <span>Create Draft</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GitPullRequest, Loader2, FileEdit, GitBranch, ArrowRight } from 'lucide-vue-next'
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor'

const props = defineProps<{
  title: string
  body: string
  baseBranch: string
  defaultBaseBranch: string
  headBranch: string
  branches: readonly string[]
  isCreating: boolean
}>()

// Ensure defaultBaseBranch is always in the list, even if branches haven't loaded
const branchOptions = computed(() => {
  if (props.branches.length === 0 && props.defaultBaseBranch) {
    return [props.defaultBaseBranch]
  }
  if (props.defaultBaseBranch && !props.branches.includes(props.defaultBaseBranch)) {
    return [props.defaultBaseBranch, ...props.branches]
  }
  return props.branches
})

defineEmits<{
  'update-field': [field: string, value: any]
  'submit': []
  'submit-draft': []
}>()
</script>

<style scoped>
:deep(.pr-create-editor) {
  font-size: 0.6875rem;
  line-height: 1.5;
}
:deep(.pr-create-editor .tiptap) {
  padding: 0.375rem 0.5rem;
  min-height: 60px;
}
</style>
