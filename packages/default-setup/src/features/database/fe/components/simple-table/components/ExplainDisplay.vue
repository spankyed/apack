<template>
  <div class="p-4 space-y-3 text-sm">
    <div class="text-neutral-400">
      {{ explanation.ids.length }} {{ explanation.ids.length === 1 ? 'entity' : 'entities' }} found,
      <template v-if="explanation.backend === 'elmdb'">{{ explanation.visited }} read from the store,</template>
      in {{ explanation.ms.toFixed(2) }} ms
    </div>
    <table v-if="explanation.backend === 'elmdb'" class="w-full border-collapse">
      <thead>
        <tr class="text-left text-neutral-500 border-b border-neutral-800">
          <th class="py-1 pr-4 font-normal">Stage</th>
          <th class="py-1 pr-4 font-normal">Index</th>
          <th class="py-1 pr-4 font-normal text-right">Visited</th>
          <th class="py-1 pr-4 font-normal text-right">Kept</th>
          <th class="py-1 font-normal text-right">ms</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(stage, at) in explanation.stages" :key="at" class="border-b border-neutral-800/60 text-neutral-200">
          <td class="py-1 pr-4 font-mono">{{ stage.stage }}</td>
          <td class="py-1 pr-4 font-mono" :class="stage.index?.startsWith('none') ? 'text-amber-400' : 'text-neutral-300'">{{ stage.index ?? '' }}</td>
          <td class="py-1 pr-4 text-right tabular-nums">{{ stage.visited }}</td>
          <td class="py-1 pr-4 text-right tabular-nums">{{ stage.kept }}</td>
          <td class="py-1 text-right tabular-nums">{{ stage.ms.toFixed(3) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="space-y-3">
      <p v-if="explanation.statementCount > explanation.statements.length" class="text-amber-400">First {{ explanation.statements.length }} of {{ explanation.statementCount }} statements shown.</p>
      <p class="text-neutral-500">Statement times include preparation, binding and returned rows. Query-plan collection is excluded.</p>
      <div v-for="(statement, at) in explanation.statements" :key="at" class="space-y-1">
        <div class="text-neutral-400">{{ statement.returnedRows }} rows returned · {{ statement.ms.toFixed(3) }} ms</div>
        <pre class="overflow-x-auto whitespace-pre-wrap text-neutral-200">{{ statement.sql }}</pre>
        <details v-if="statement.parameters.length" class="text-neutral-500">
          <summary>Bindings</summary>
          <pre class="overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(statement.parameters) }}</pre>
        </details>
        <ul class="font-mono text-neutral-400">
          <li v-for="(step, index) in statement.plan" :key="index">{{ step.id }} ← {{ step.parent }}: {{ step.detail }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { QueryExplanation } from '@apackdev/ears';

defineProps<{ explanation: QueryExplanation }>();
</script>
