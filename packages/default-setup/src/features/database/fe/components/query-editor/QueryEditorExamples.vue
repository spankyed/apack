<template>
  <div class="h-full overflow-hidden">
    <div class="h-full p-4 overflow-y-auto scrollbar-custom">
      <div class="space-y-3">
        <ExampleCard
          v-for="(example, index) in examples"
          :key="index"
          :example="example"
          @select="$emit('select', example.query)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useState } from '#generated/state-fe.ts';
import ExampleCard from './ExampleCard.vue';
import { queryExamples } from './query-examples.ts';
import { transactionExamples } from './transaction-examples.ts';

const { state: database } = useState('database');

const examples = computed(() => 
  database.value.data.mode === 'query' ? queryExamples : transactionExamples
);

defineEmits<{
  select: [query: string];
}>();
</script>

<style scoped>
/* Custom scrollbar styling */
.scrollbar-custom::-webkit-scrollbar {
  width: 8px;
}

.scrollbar-custom::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-custom::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 4px;
}

.scrollbar-custom::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.7);
}

/* Firefox scrollbar styling */
.scrollbar-custom {
  scrollbar-width: thin;
  scrollbar-color: rgba(156, 163, 175, 0.5) transparent;
}

/* Dark mode scrollbar */
:global(.dark) .scrollbar-custom::-webkit-scrollbar-thumb {
  background-color: rgba(75, 85, 99, 0.5);
}

:global(.dark) .scrollbar-custom::-webkit-scrollbar-thumb:hover {
  background-color: rgba(75, 85, 99, 0.7);
}

:global(.dark) .scrollbar-custom {
  scrollbar-color: rgba(75, 85, 99, 0.5) transparent;
}
</style> 