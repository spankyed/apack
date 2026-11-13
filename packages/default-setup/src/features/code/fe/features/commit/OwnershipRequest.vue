<template>
  <!-- Git will not read a repository another user owns until the user adds it to safe.directory -->
  <div class="p-3 border-b border-yellow-800 bg-yellow-900/10" data-testid="ownership-request">
    <p class="text-sm text-yellow-500">
      <ShieldAlert class="inline w-4 h-4 mr-1" />
      Another user owns this repository, so git will not use it.
    </p>
    <p class="mt-1 text-xs truncate text-neutral-300" :title="directory"><code>{{ directory }}</code></p>
    <p class="mt-2 text-xs text-neutral-500">
      Trusting it adds it to git's safe.directory in your global git configuration, as git suggests.
    </p>
    <button
      class="px-2 py-1 mt-2 text-xs rounded text-neutral-100 bg-neutral-800 hover:bg-neutral-700"
      data-testid="trust-ownership"
      @click="emit('trust')"
    >
      Trust this repository
    </button>
  </div>
</template>

<script setup lang="ts">
import { ShieldAlert } from 'lucide-vue-next'

defineProps<{ directory: string }>()
const emit = defineEmits<{ trust: [] }>()
</script>
