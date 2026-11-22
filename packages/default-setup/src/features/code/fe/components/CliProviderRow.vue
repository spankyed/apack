<template>
  <div
    class="p-3 rounded-lg border border-neutral-800/80 bg-neutral-900/30 hover:border-neutral-700/80 transition-colors max-w-[480px]"
  >
    <!-- Header: label + status -->
    <div class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-gray-200">{{ label }}</span>
        <CheckCircle
          v-if="status === 'success'"
          role="img"
          aria-label="CLI available"
          class="w-3.5 h-3.5 text-green-400"
        />
        <XCircle
          v-else-if="status === 'error'"
          class="w-3.5 h-3.5 text-red-400"
        />
      </div>
      <button
        @click="emit('test')"
        :disabled="status === 'testing'"
        class="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
        :class="status === 'testing'
          ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
          : 'bg-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-700 border border-neutral-700/50'"
        title="Test if CLI is available"
      >
        <Loader2
          v-if="status === 'testing'"
          class="w-3.5 h-3.5 animate-spin"
        />
        <span v-else>Test</span>
      </button>
    </div>

    <!-- Path input -->
    <input
      type="text"
      :value="modelValue"
      :aria-label="label + ' path'"
      :disabled="status === 'testing'"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value.trim())"
      :placeholder="placeholder"
      class="w-full px-3 py-1.5 bg-neutral-800/60 border border-neutral-700/50 rounded-md text-white placeholder-neutral-600 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 hover:border-neutral-600 transition-all"
    />

    <!-- Helper: install command -->
    <div class="mt-2 flex items-center gap-2 text-xs text-neutral-500">
      <span>{{ installHint }}</span>
      <CliCommand>{{ installCmd }}</CliCommand>
    </div>

    <!-- Error message -->
    <div
      v-if="status === 'error' && testResult?.error"
      class="mt-2 text-xs text-red-400/70"
    >
      {{ testResult.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle, XCircle, Loader2 } from 'lucide-vue-next'
import CliCommand from './CliCommand.vue'

const props = defineProps<{
  label: string
  installHint: string
  installCmd: string
  placeholder: string
  modelValue: string
  testResult?: { status: string; resolvedPath?: string; error?: string }
}>()

const status = computed(() => props.testResult?.status)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'test': []
}>()
</script>
