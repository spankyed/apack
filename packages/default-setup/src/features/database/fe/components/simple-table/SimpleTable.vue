<template>
  <div class="flex flex-col h-full overflow-hidden bg-neutral-800/20">
    <!-- Table Container -->
    <div class="flex-1 overflow-auto custom-scrollbar">
      <!-- State displays -->
      <ResultStates 
        v-if="currentState !== 'data'"
        :state="currentState"
        :error="error"
      />

      <!-- Data displays -->
      <template v-else>
        <!-- Array of Primitives -->
        <PrimitivesTable 
          v-if="isArrayOfPrimitives && resultCount > 0"
          :values="queryResult"
        />

        <!-- Array of Objects -->
        <ObjectsTable
          v-else-if="resultType === 'array' && !isArrayOfPrimitives && resultCount > 0"
          :headers="tableHeaders"
          :rows="tableData"
          @delete="handleDeleteEntity"
        />

        <!-- A query's explain(): its plan's stages -->
        <ExplainDisplay
          v-else-if="isExplanation(queryResult)"
          :explanation="queryResult"
        />

        <!-- Single Object -->
        <JsonDisplay
          v-else-if="resultType === 'object'"
          :data="queryResult"
        />

        <!-- Primitive Value -->
        <PrimitiveDisplay
          v-else
          :value="queryResult"
        />
      </template>
    </div>

    <!-- Results Info Bar -->
    <ResultsInfoBar
      :query-result="queryResult"
      :result-type="resultType"
      :result-count="resultCount"
      :is-array-of-primitives="isArrayOfPrimitives"
      :execution-time="executionTime"
    />
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue';
import { useSelector } from '@xstate/vue';
import { useResultAnalysis } from './composables/useResultAnalysis.ts';
import ResultsInfoBar from './components/ResultsInfoBar.vue';
import ResultStates from './components/ResultStates.vue';
import PrimitivesTable from './components/PrimitivesTable.vue';
import ObjectsTable from './components/ObjectsTable.vue';
import JsonDisplay from './components/JsonDisplay.vue';
import ExplainDisplay from './components/ExplainDisplay.vue';
import { isExplanation } from './composables/explanation.ts';
import PrimitiveDisplay from './components/PrimitiveDisplay.vue';
import type { DatabaseState } from '../../state.ts'

// State Management
const actor: DatabaseState = useSurface();
const queryResult = useSelector(actor, (state) => state.context.queryResult);
const isLoading = useSelector(actor, (state) => state.context.isLoading);
const error = useSelector(actor, (state) => state.context.error);
const executionTime = useSelector(actor, (state) => state.context.executionTime);

// Result Analysis
const { 
  resultType, 
  isArrayOfPrimitives, 
  resultCount, 
  tableHeaders, 
  tableData 
} = useResultAnalysis(queryResult);

// Computed Properties
const currentState = computed(() => {
  if (isLoading.value) return 'loading';
  if (error.value) return 'error';
  if (!queryResult.value) return 'no-results';
  if (resultType.value === 'array' && resultCount.value === 0) return 'empty-array';
  return 'data';
});

// Event Handlers
function handleDeleteEntity(entityId: string) {
  // Send delete event to the database state machine
  actor.send({ type: 'ENTITY.DELETE', entityId });
}
</script>

<style scoped>
/* Custom scrollbar styling */
.custom-scrollbar::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background-color: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(155, 155, 155, 0.3);
  border-radius: 6px;
  border: 3px solid transparent;
  background-clip: content-box;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(155, 155, 155, 0.5);
}

.custom-scrollbar::-webkit-scrollbar-corner {
  background-color: transparent;
}

/* Firefox scrollbar */
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(155, 155, 155, 0.3) transparent;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .custom-scrollbar::-webkit-scrollbar-track {
    background-color: transparent;
  }
  
  .custom-scrollbar::-webkit-scrollbar-corner {
    background-color: transparent;
  }
}
</style> 