<template>
  <div class="flex flex-col h-full">
    <!-- Panel Content -->
    <div class="flex-1 overflow-hidden">
      <ExplorerPanel
        v-if="code.data.selectedPanel === 'explorer'"
      />

      <SearchPanel
        v-else-if="code.data.selectedPanel === 'search'"
      />

      <CommitPanel
        v-else-if="code.data.selectedPanel === 'commit'"
      />

      <PullRequestPanel
        v-else-if="code.data.selectedPanel === 'pr'"
      />

      <ActionsPanel
        v-else-if="code.data.selectedPanel === 'actions'"
      />

      <PromptsPanel
        v-else-if="code.data.selectedPanel === 'prompts'"
      />
    </div>

    <!-- Resize handle between panel content and terminal -->
    <PanelResizer
      v-if="code.data.panelTerminalExpanded"
      orientation="vertical"
      subtle
      @resize="onTerminalResize"
      @click="send({ type: 'TOGGLE_PANEL_TERMINAL' })"
    />

    <!-- Terminal section — always visible at bottom -->
    <PanelTerminalSection :height="terminalHeight" />
  </div>
</template>

<script setup lang="ts">
import { useState, useSurface } from '@apackdev/sdk/fe'

import { ref } from 'vue'
import type { CodeState } from '#features/code/fe/state.ts'
import ExplorerPanel from '#features/code/fe/features/explorer/ExplorerPanel.vue'
import SearchPanel from '#features/code/fe/features/search/SearchPanel.vue'
import CommitPanel from '#features/code/fe/features/commit/CommitPanel.vue'
import PullRequestPanel from '#features/code/fe/features/pull-request/PullRequestPanel.vue'
import ActionsPanel from '#features/code/fe/features/actions/ActionsPanel.vue'
import PromptsPanel from '#features/code/fe/features/prompts/PromptsPanel.vue'
import PanelTerminalSection from '#features/code/fe/features/terminal/PanelTerminalSection.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'

const actor: CodeState = useSurface()
const { state: code, send } = useState(actor)

const MIN_TERMINAL_HEIGHT = 100
const MAX_TERMINAL_HEIGHT = 600
const terminalHeight = ref(256)

const onTerminalResize = (delta: number) => {
  // Negative delta = dragging up = taller terminal
  terminalHeight.value = Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, terminalHeight.value - delta))
}
</script>
