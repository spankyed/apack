<script setup lang="ts">
import { useState } from '#generated/state-fe.ts';

const { state: notes } = useState('notes');
</script>

<template>
  <div class="p-4">
    <h1 data-testid="fixture-notes-title">{{ notes.data.label }}</h1>
  </div>
</template>
