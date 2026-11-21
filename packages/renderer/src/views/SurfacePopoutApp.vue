<template>
  <div class="flex flex-col h-screen bg-neutral-950 text-neutral-100">
    <ToastNotification ref="toast" />

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <div
        class="flex min-w-0 flex-1 flex-col overflow-hidden border-b border-neutral-800 bg-neutral-900"
        :style="{ width: canShowPanel && shell.data.panelSizes.inspectionWidth > 0 ? `calc(100% - ${shell.data.panelSizes.inspectionWidth}px)` : '100%' }"
      >
        <PopoutTitlebar
          :breadcrumbs="shell.data.breadcrumbs"
          :menu-items="allMenuItems"
          :header-class="shell.data.activeSurface.options?.headerClass"
          @crumb-click="(target: string, info?: any) => send({ type: 'TRAIL_CLICK', target, info })"
          @menu-action="handleMenuAction"
        />
        <div class="min-h-0 flex-1 overflow-y-auto">
          <SurfacePane :surface="shell.data.activeSurface" area="canvas" :target="shell.data.targetView" />
        </div>
      </div>

      <PanelResizer
        v-if="canShowPanel"
        orientation="horizontal"
        :collapsed="!isPanelOpen"
        @resize="handleInspectionResize"
        @click="send({ type: 'TOGGLE_INSPECTION_PANEL' })"
      />

      <InspectionPanel
        v-if="canShowPanel && shell.data.panelSizes.inspectionWidth > 0"
        :style="{ width: `${shell.data.panelSizes.inspectionWidth}px` }"
        :label="`${shell.data.activeSurface.label} Inspection`"
      >
        <SurfacePane :surface="shell.data.activeSurface" area="panel" />
      </InspectionPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PanelRight } from 'lucide-vue-next'
import { applicationState } from '@/main'
import InspectionPanel from '@/views/layout/InspectionPanel.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import PopoutTitlebar from '@/views/layout/PopoutTitlebar.vue'
import SurfacePane from '@/views/layout/SurfacePane.vue'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import { registerGlobalToast } from '@/adapters/toast'
import { useState, type ContextMenuItem } from '@apackdev/sdk/fe'
import { notifySurfaceActor } from '@apackdev/host/fe'

const send = applicationState.send
const toast = ref<InstanceType<typeof ToastNotification> | null>(null)

onMounted(() => registerGlobalToast(toast.value))
onUnmounted(() => registerGlobalToast(null))

const { state: shell } = useState(applicationState)

const canShowPanel = computed(() => !!shell.value.data.activeSurface.panel)
const isPanelOpen = computed(() => shell.value.data.panelSizes.inspectionWidth > 0)

const allMenuItems = computed<ContextMenuItem[]>(() => [
  ...shell.value.data.contextMenuItems,
  ...(canShowPanel.value ? [{
    label: 'Context Panel',
    icon: PanelRight,
    event: { type: 'APP_TOGGLE_INSPECTION_PANEL' },
    isActive: isPanelOpen.value,
    separator: shell.value.data.contextMenuItems.length > 0,
  }] : []),
])

const handleInspectionResize = (delta: number) => {
  const newWidth = shell.value.data.panelSizes.inspectionWidth - delta
  send({ type: 'RESIZE_PANEL', panel: 'inspection', size: newWidth })
}

const handleMenuAction = (event: ContextMenuItem['event']) => {
  if (event.type === 'APP_TOGGLE_INSPECTION_PANEL') {
    send({ type: 'TOGGLE_INSPECTION_PANEL' })
    return
  }

  // A menu item's event is whatever the surface that raised it put there, so the payload is checked rather than
  // assumed: without this a menu item declaring no `text` would copy the string "undefined".
  if (event.type === 'APP_COPY_TO_CLIPBOARD' && typeof event.text === 'string') {
    navigator.clipboard.writeText(event.text)
    return
  }

  // Through the funnel, as the main window's does. The lookup stays guarded here rather than inside it:
  // whether a missing surface is a bug or a race is the call site's to know.
  const actor = applicationState.system.get(shell.value.data.activeSurface.id)
  if (actor) notifySurfaceActor(actor, shell.value.data.activeSurface.id, event)
}
</script>
