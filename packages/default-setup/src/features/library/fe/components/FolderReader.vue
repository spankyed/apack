<script setup lang="ts">
// One folder the library shows, watched: the folder open or one expanded in the tree. It renders nothing, and hands
// each result of the folder's view to the surface, which puts it in that folder's slot.
import { watch } from 'vue'
import { useSurface } from '@apackdev/sdk/fe'
import { useView } from '#generated/fe.ts'
import type { LibraryActor } from '../state.ts'

const props = defineProps<{ folderId: string | null }>()
const actor = useSurface<LibraryActor>()
const folder = useView('library', 'folder', () => ({ folderId: props.folderId }))
watch(() => folder.data, (data) => {
  if (data) actor.send({ type: 'FOLDER.READ', folderId: props.folderId, folder: data })
}, { immediate: true })
</script>

<template><template v-if="false" /></template>
