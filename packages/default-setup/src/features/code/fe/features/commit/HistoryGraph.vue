<template>
  <!-- One row of the drawn history: the lanes running through it, the commit's dot, and its lines to its parents -->
  <svg :width="LANE * width" :height="ROW" class="flex-shrink-0" aria-hidden="true">
    <line v-for="at in row.through" :key="`t${at}`" :x1="x(at)" :y1="0" :x2="x(at)" :y2="ROW / 2" stroke="currentColor" class="text-neutral-600" />
    <line v-for="at in row.below" :key="`b${at}`" :x1="x(at === row.lane || row.merges.includes(at) ? row.lane : at)" :y1="ROW / 2" :x2="x(at)" :y2="ROW" stroke="currentColor" class="text-neutral-600" />
    <circle :cx="x(row.lane)" :cy="ROW / 2" r="3" class="fill-blue-400" />
  </svg>
</template>

<script setup lang="ts">
import type { LaneRow } from '#features/code/fe/utils/history-lanes.ts'

defineProps<{ row: LaneRow; width: number }>()

const LANE = 10
const ROW = 32
const x = (lane: number) => LANE / 2 + lane * LANE
</script>
