<template>
  <div class="space-y-6">
    <!-- Index Name -->
    <div>
      <label class="block text-xs font-medium text-neutral-400 mb-1.5">
        INDEX NAME <span class="text-red-500">*</span>
      </label>
      <input
        v-model="localData.name"
        type="text"
        placeholder="Enter index name"
        class="w-full px-3 py-2 bg-neutral-800/50 border border-neutral-700/50 rounded-md text-neutral-100 text-sm focus:outline-none focus:border-neutral-600 placeholder-neutral-500"
        @input="updateValue"
      />
    </div>

    <!-- About Index -->
    <div>
      <label class="block text-xs font-medium text-neutral-400 mb-1.5">
        DESCRIPTION
      </label>
      <textarea
        v-model="localData.description"
        placeholder="Describe the purpose of this index"
        rows="3"
        class="w-full px-3 py-2 bg-neutral-800/50 border border-neutral-700/50 rounded-md text-neutral-100 text-sm focus:outline-none focus:border-neutral-600 placeholder-neutral-500 resize-none"
        @input="updateValue"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SearchIndexFormData } from '../../types/search-index.ts'

const props = defineProps<{
  modelValue: SearchIndexFormData
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SearchIndexFormData]
}>()

const localData = ref<SearchIndexFormData>({ ...props.modelValue })

watch(() => props.modelValue, (newValue) => {
  localData.value = { ...newValue }
}, { deep: true })

function updateValue() {
  emit('update:modelValue', { ...localData.value })
}
</script>