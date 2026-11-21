<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe';
import type { NotesState } from '../state.ts';

const actor: NotesState = useSurface();
const { state: notes } = useState(actor);
</script>

<template>
  <div class="p-4">
    <h1 data-testid="fixture-notes-title">{{ notes.data.label }}</h1>
  </div>
</template>
