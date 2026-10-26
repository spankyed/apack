<script setup lang="ts">
import { useSurfaceDraft } from '@apackdev/sdk/fe';
// Bundled into this pack (apack.json fe.bundleUi); ProseMirror and tiptap's core still come from the host
import TiptapEditor from '@apackdev/ui/components/tiptap/TiptapEditor';
// A component whose classes name the host theme (primary-*): without @apackdev/ui's Tailwind preset
// its accent silently gets no CSS, which fe-bundler-ui-theme.spec.ts checks for
import Button from '@apackdev/ui/design/button';

// What the user typed, kept across the remount a reconnect causes rather than in a component `ref`, which goes with it
const text = useSurfaceDraft('text', 'Bundled editor');
</script>

<template>
  <div data-testid="scribbles-canvas" class="flex flex-col gap-3 p-[13px]">
    <div data-testid="scribbles-editor">
      <TiptapEditor v-model="text" mode="editor" />
    </div>
    <p data-testid="scribbles-text" class="text-sm">{{ text }}</p>
    <Button data-testid="scribbles-button" variant="primary">Themed</Button>
  </div>
</template>
