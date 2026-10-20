<template>
  <div class="flex flex-col h-screen bg-neutral-950 text-neutral-100">
    <ToastNotification ref="toast" />

    <div class="flex flex-1 min-h-0 overflow-hidden">
      <div
        class="flex min-w-0 flex-1 flex-col overflow-hidden border-b border-neutral-800 bg-neutral-900"
        :style="{ width: canShowPanel && panelSizes.inspectionWidth > 0 ? `calc(100% - ${panelSizes.inspectionWidth}px)` : '100%' }"
      >
        <PopoutTitlebar
          :breadcrumbs="breadcrumbs"
          :menu-items="allMenuItems"
          :header-class="activeSurface.options?.headerClass"
          @crumb-click="(target: string, info?: any) => send({ type: 'TRAIL_CLICK', target, info })"
          @menu-action="handleMenuAction"
        />
        <div ref="content" class="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            v-show="!canShowChat || canvasShare > 0"
            class="min-h-0 overflow-y-auto"
            :style="{ flex: canShowChat ? `${canvasShare} 1 0%` : '1 1 0%' }"
          >
            <SurfacePane :surface="activeSurface" area="canvas" :target="targetView" />
          </div>
          <PanelResizer
            v-if="canShowChat"
            orientation="vertical"
            :collapsed="canvasShare === 0"
            @resize="handleCanvasResize"
            @click="canvasShare = canvasShare === 0 ? 35 : 0"
          />
          <ChatArea
            v-if="canShowChat"
            data-onboarding-id="chat-area"
            class="relative"
            :style="{ flex: `${100 - canvasShare} 1 0%`, height: 'auto', minHeight: 'auto', maxHeight: '100%' }"
          >
            <SurfacePane :surface="activeSurface" area="chat" />
          </ChatArea>
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
        v-if="canShowPanel && panelSizes.inspectionWidth > 0"
        :style="{ width: `${panelSizes.inspectionWidth}px` }"
        :label="`${activeSurface.label} Inspection`"
      >
        <SurfacePane :surface="activeSurface" area="panel" />
      </InspectionPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSelector } from '@xstate/vue'
import { PanelRight } from 'lucide-vue-next'
import { applicationState } from '@/main'
import ChatArea from '@/views/layout/ChatArea.vue'
import InspectionPanel from '@/views/layout/InspectionPanel.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import PopoutTitlebar from '@/views/layout/PopoutTitlebar.vue'
import SurfacePane from '@/views/layout/SurfacePane.vue'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import { registerGlobalToast } from '@/adapters/toast'
import { type ContextMenuItem } from '@apackdev/sdk/fe'
import { notifySurfaceActor } from '@apackdev/host/fe'

const send = applicationState.send
const toast = ref<InstanceType<typeof ToastNotification> | null>(null)

onMounted(() => registerGlobalToast(toast.value))
onUnmounted(() => registerGlobalToast(null))

const activeSurface = useSelector(applicationState, (state) => state.context.activeSurface)
const breadcrumbs = useSelector(applicationState, (state) => state.context.breadcrumbs)
const contextMenuItems = useSelector(applicationState, (state) => state.context.contextMenuItems)
const targetView = useSelector(applicationState, (state) => state.context.targetView)
const panelSizes = useSelector(applicationState, (state) => state.context.panelSizes)

const content = ref<HTMLElement>()
// Each popout keeps its own split; resizing it must not move the main window's canvas.
const canvasShare = ref(35)
const canShowChat = computed(() => !!activeSurface.value.chat)
const handleCanvasResize = (delta: number) => {
  const height = content.value?.clientHeight
  if (!height) return
  const maximum = Math.max(0, (height - 180) / height * 100)
  canvasShare.value = Math.max(0, Math.min(maximum, canvasShare.value + delta / height * 100))
}

const canShowPanel = computed(() => !!activeSurface.value.panel)
const isPanelOpen = computed(() => panelSizes.value.inspectionWidth > 0)

const allMenuItems = computed<ContextMenuItem[]>(() => [
  ...contextMenuItems.value,
  ...(canShowPanel.value ? [{
    label: 'Context Panel',
    icon: PanelRight,
    event: { type: 'APP_TOGGLE_INSPECTION_PANEL' },
    isActive: isPanelOpen.value,
    separator: contextMenuItems.value.length > 0,
  }] : []),
])

const handleInspectionResize = (delta: number) => {
  const newWidth = panelSizes.value.inspectionWidth - delta
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
  const actor = applicationState.system.get(activeSurface.value.id)
  if (actor) notifySurfaceActor(actor, activeSurface.value.id, event)
}
</script>
