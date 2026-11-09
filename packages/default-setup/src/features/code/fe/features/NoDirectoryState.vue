<template>
  <div class="flex-1 flex flex-col items-center pt-16 px-6 text-center overflow-auto">
    <div class="flex flex-col items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-neutral-800/80 flex items-center justify-center">
        <FolderOpen class="w-5 h-5 text-neutral-500" />
      </div>
      <div>
        <p class="text-sm text-neutral-400">No directory selected</p>
        <p class="text-xs text-neutral-600 mt-0.5">Browse files or open a project</p>
      </div>
      <button
        @click="handleDirectorySelect"
        class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors font-medium"
      >
        Select a Directory
      </button>
    </div>

    <!-- Project quick-open -->
    <div v-if="allProjects.length > 0" class="mt-6 w-full max-w-[200px]">
      <div class="flex items-center gap-2 mb-2">
        <div class="flex-1 h-px bg-neutral-800" />
        <span class="text-[10px] uppercase tracking-wider text-neutral-600 font-medium">Projects</span>
        <div class="flex-1 h-px bg-neutral-800" />
      </div>
      <div class="flex flex-col gap-0.5">
        <button
          v-for="{ project } in allProjects"
          :key="project.name"
          @click="handleProjectOpen(project.directories[0])"
          class="flex items-center gap-2.5 px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/80 rounded-md transition-colors text-left group"
        >
          <div
            class="w-2 h-2 rounded-full flex-shrink-0 ring-2 ring-transparent group-hover:ring-current/10 transition-all"
            :style="{ backgroundColor: project.color }"
          />
          {{ project.name }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { FolderOpen } from 'lucide-vue-next'
import type { CodeState } from '#features/code/fe/state.ts'
import { useProjectActions } from './explorer/composables/useProjectActions.ts'
import { panelChild } from './children.ts';

const codeActor: CodeState = useSurface()
const explorerActor = panelChild(codeActor, 'explorer')!

const { allProjects } = useProjectActions()

const handleDirectorySelect = async () => {
  try {
    const directoryPath = await window.electronAPI?.fileUtils.selectDirectory()
    if (directoryPath) {
      explorerActor?.send({ type: 'explorer.SET_BASE_DIRECTORY', path: directoryPath })
    }
  } catch (error) {
    console.error('Error selecting directory:', error)
  }
}

const handleProjectOpen = (path: string) => {
  explorerActor?.send({ type: 'explorer.SET_BASE_DIRECTORY', path })
}
</script>
