<template>
  <div>
    <div class="flex items-center justify-between h-header pl-4 pr-2 border-b border-neutral-800 panel-header" :class="{ 'panel-drag': !isAnyMenuOpen }">
      <div class="flex items-center gap-2 min-w-0">
        <component :is="icon" :size="16" class="text-neutral-400 shrink-0" />
        <div class="flex items-center gap-1.5 text-sm min-w-0">
          <span
            class="font-medium transition-colors whitespace-nowrap truncate"
            :class="clickable ? 'text-neutral-400 hover:text-neutral-200 cursor-pointer' : 'text-neutral-200'"
            @click="clickable ? $emit('title-click') : null"
          >
            {{ title }}
          </span>
          <slot name="title-extra" />
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <BaseDirectoryMenu
          v-if="baseDirectory && showDirectoryMenu"
          :base-directory="baseDirectory"
          @open-directory="handleDirectorySelect"
          @open-terminal="terminalActor?.send({ type: 'terminal.CREATE', cwd: baseDirectory })"
          @open-project-directory="handleProjectDirectorySelect"
          @refresh="explorerActor?.send({ type: 'explorer.REFRESH_TREE' })"
        />
        <div class="header-actions flex items-center gap-1 ml-auto">
          <slot name="actions" />
        </div>
      </div>
    </div>

    <!-- Toolbar row: optional left content + toggle buttons -->
    <div class="flex items-center border-b border-neutral-800">
      <div class="flex-1 min-w-0">
        <slot name="toolbar" />
      </div>
      <div class="flex items-center gap-1 px-2 py-1.5 flex-shrink-0">
        <button
          v-for="panel in codePanels"
          :key="panel.id"
          @click="selectPanel(panel.id)"
          :class="[
            'relative p-1.5 rounded transition-colors',
            selectedPanel === panel.id
              ? 'bg-primary-700 text-neutral-100'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
          ]"
          :title="panel.label"
        >
          <component :is="panel.icon" class="w-4 h-4" />
          <span
            v-if="panel.id === 'commit' && changeCount > 0"
            class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-3.5 px-[2px] text-[9px] font-bold leading-none text-white bg-blue-600 rounded-full"
          >{{ changeCount }}</span>
        </button>

        <div class="h-5 w-px bg-neutral-700 mx-1"></div>

        <button
          v-for="panel in internalsPanels"
          :key="panel.id"
          @click="selectPanel(panel.id)"
          :class="[
            'p-1.5 rounded transition-colors',
            selectedPanel === panel.id
              ? 'bg-primary-700 text-neutral-100'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
          ]"
          :title="panel.label"
        >
          <component :is="panel.icon" class="w-4 h-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

import type { Component } from 'vue'
import { computed } from 'vue'
import { useSelector } from '@xstate/vue'
import { type CodeState } from '#features/code/fe/state.ts'
import { isAnyMenuOpen, useSurface } from '@apackdev/sdk/fe'
import BaseDirectoryMenu from '#features/code/fe/features/explorer/components/BaseDirectoryMenu.vue'
import { panelChild } from './children.ts';
import {
  FolderOpen,
  Search,
  GitCommitVertical,
  GitPullRequest,
  Play,
  Sparkle,
} from 'lucide-vue-next'

defineProps<{
  icon: Component
  title: string
  clickable?: boolean
}>()

defineEmits<{
  'title-click': []
}>()

const actor: CodeState = useSurface()
const explorerActor = panelChild(actor, 'explorer')!
const terminalActor = panelChild(actor, 'terminal')!
const commitActor = panelChild(actor, 'commit')!

const changeCount = useSelector(commitActor, (state) => state.context.gitStatus?.length ?? 0)

const selectedPanel = useSelector(actor, (state) => state.context.selectedPanel)
const baseDirectory = useSelector(actor, (state) => state.context.baseDirectory)

const directoryMenuPanels = ['explorer', 'commit', 'pr', 'search'] as const
const showDirectoryMenu = computed(() =>
  directoryMenuPanels.includes(selectedPanel.value as any)
)

const handleDirectorySelect = async () => {
  if (!window.electronAPI?.fileUtils.selectDirectory) {
    console.error('Directory selection API not available')
    return
  }
  try {
    const directoryPath = await window.electronAPI.fileUtils.selectDirectory()
    if (directoryPath && directoryPath !== baseDirectory.value) {
      explorerActor?.send({ type: 'explorer.SET_BASE_DIRECTORY', path: directoryPath })
    }
  } catch (error) {
    console.error('Error selecting directory:', error)
  }
}

const handleProjectDirectorySelect = (path: string) => {
  explorerActor?.send({ type: 'explorer.SET_BASE_DIRECTORY', path })
}

const codePanels = [
  { id: 'explorer', label: 'Explorer', icon: FolderOpen },
  { id: 'commit', label: 'Commit Changes', icon: GitCommitVertical },
  { id: 'pr', label: 'Pull Request', icon: GitPullRequest },
  { id: 'search', label: 'Search', icon: Search },
] as const

const internalsPanels = [
  { id: 'actions', label: 'Actions', icon: Play },
  { id: 'prompts', label: 'Prompts', icon: Sparkle }
] as const

const selectPanel = (panel: 'explorer' | 'search' | 'commit' | 'pr' | 'actions' | 'prompts') => {
  actor.send({
    type: 'SELECT_PANEL',
    panel
  })
}
</script>

<style scoped>
.panel-drag {
  -webkit-app-region: drag;
  user-select: none;
}
.panel-drag > * {
  -webkit-app-region: no-drag;
}
.header-actions :deep(button) {
  padding: 0.375rem; /* p-1.5 */
}
</style>
