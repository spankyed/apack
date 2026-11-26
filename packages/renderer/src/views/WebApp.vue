<template>
<!-- data-active-surface is the active surface as rendered. Vue writes it in the same flush that swaps the
     canvas below, so a test can wait for a navigation to be on screen rather than sleep after it. -->
<div class="flex flex-col h-screen" :data-active-surface="shell.data.activeSurface.id">
    <ToastNotification ref="toast" />
    <div class="flex flex-grow overflow-hidden">
    <!-- Left Toolbar (hidden during onboarding) -->
    <Toolbar
        v-if="!isOnboarding"
        :surfaces="surfaces"
        :active-surface="shell.data.activeSurface"
        @select-surface="(id: string) => send({ type: 'SELECT_SURFACE', surface: id })"
        @open-surface="(id: string) => send({ type: 'OPEN_SURFACE', surface: id, events: [] })"
    />

    <!-- Main Area -->
    <div class="flex flex-grow overflow-hidden" :style="{ paddingRight: canShowPanel && shell.data.panelSizes.inspectionWidth === 0 ? '2px' : '0' }">
        <div class="flex flex-col flex-grow overflow-hidden" :style="{ minWidth: '350px', width: canShowPanel && shell.data.panelSizes.inspectionWidth > 0 ? `calc(100% - ${shell.data.panelSizes.inspectionWidth}px)` : '100%' }">
            <!-- Canvas Area — always rendered; collapses to just its header when chat is maximized -->
            <!-- Canvas Area — empty draggable header during onboarding, normal otherwise -->
            <CanvasArea
            data-onboarding-id="canvas-area"
            :header-only="isOnboarding || chatMaximized"
            @crumb-click="(target: string, info?: any) => send({ type: 'TRAIL_CLICK', target, info })"
            @canvas-toggle="send({ type: 'DEFAULT_TOGGLE', area: 'canvas' })"
            @menu-action="handleMenuAction"
            :style="isOnboarding || chatMaximized
                ? { flex: '0 0 auto', height: 'auto' }
                : { height: `${shell.data.panelSizes.canvasHeight}%` }"
            :breadcrumbs="isOnboarding ? [] : shell.data.breadcrumbs"
            :menu-items="isOnboarding ? [] : allMenuItems"
            :label="`${canvasSurface.label} Canvas`"
            :header-class="canvasSurface.options?.headerClass">
            <!-- Each surface area renders as part of its surface, which is what useSurface() returns there -->
            <SurfacePane :surface="canvasSurface" area="canvas" :target="shell.data.targetView" />
            </CanvasArea>

            <!-- Vertical Resizer (hidden during onboarding) -->
            <PanelResizer
                v-if="!isOnboarding"
                orientation="vertical"
                :collapsed="chatMaximized || shell.data.panelSizes.canvasHeight >= 93"
                @resize="handleCanvasResize"
                @click="handleCanvasClick"
                @right-click="chatMaximized ? handleChatRestore() : handleChatMaximize()"
            />

            <!-- Chat Area — fills remaining space below the canvas header when maximized -->
            <ChatArea
                data-onboarding-id="chat-area"
                class="relative"
                :style="isOnboarding || chatMaximized
                    ? { flex: '1 1 0%', minHeight: 0 }
                    : { height: `calc(${100 - shell.data.panelSizes.canvasHeight}% - 4px)` }"
            >
                <!-- The chat is the default pack's, so there is none until a pack has claimed the default -->
                <SurfacePane v-if="shell.data.defaultSurface" :surface="shell.data.defaultSurface" area="chat" />
            </ChatArea>
        </div>

        <!-- Horizontal Resizer (hidden during onboarding) -->
        <PanelResizer
            v-if="canShowPanel && !isOnboarding"
            orientation="horizontal"
            :collapsed="!isPanelOpen"
            @resize="handleInspectionResize"
            @click="handleInspectionClick"
        />

        <!-- Context Panel (hidden during onboarding) -->
        <InspectionPanel
            v-if="canShowPanel && shell.data.panelSizes.inspectionWidth > 0 && !isOnboarding"
            data-onboarding-id="inspection-panel"
:style="{ width: `${shell.data.panelSizes.inspectionWidth}px` }"
            :label="`${shell.data.activeSurface.panel ? shell.data.activeSurface.label : fallbackSurface?.label} Inspection`">
            <SurfacePane v-if="shell.data.activeSurface.panel" :surface="shell.data.activeSurface" area="panel" />
            <SurfacePane v-else-if="fallbackShown && fallbackSurface" :surface="fallbackSurface" area="panel" />
        </InspectionPanel>
    </div>
    </div>
</div>
</template>

<script setup lang="ts">
import { computed, onMounted, onScopeDispose, onUnmounted, ref, shallowRef, watch } from 'vue'
import { within } from '@apackdev/state'
import { CircleHelp, Settings as SettingsIcon, ExternalLink, PanelRight, PanelTop, Terminal } from 'lucide-vue-next'
import Toolbar from '@/views/layout/Toolbar.vue'
import { useSurfaceNavigation } from '@/views/layout/surface-navigation';
import CanvasArea from '@/views/layout/CanvasArea.vue'
import ChatArea from '@/views/layout/ChatArea.vue'
import InspectionPanel from '@/views/layout/InspectionPanel.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import { applicationState } from '@/main'
import { HOST, notifySurfaceActor, useHostState } from '@apackdev/host/fe'
import { untypedOpenSurface } from '@apackdev/sdk/fe'
import SurfacePane from '@/views/layout/SurfacePane.vue'
import { useContextualHelp } from '@/views/settings/contextual-help';
const { hasHelp, openFeatureHelp } = useContextualHelp();
import type { ContextMenuItem } from '@apackdev/sdk/fe'
import ToastNotification from '@apackdev/ui/design/ToastNotification'
import { registerGlobalToast } from '@/adapters/toast'

const send = applicationState.send
const toast = ref<InstanceType<typeof ToastNotification> | null>(null)

onMounted(() => registerGlobalToast(toast.value))
onUnmounted(() => registerGlobalToast(null))

const { state: shell } = useHostState('application')
const surfaces = useSurfaceNavigation()
const chatMaximized = computed(() => shell.value.data.panelSizes.chatMaximized ?? false)
const isOnboarding = computed(() => within(shell.value, 'onboarding'))

/** The surface offering its panel for surfaces without one (`fallbackPanel`), which says itself when it shows */
const fallbackSurface = computed(() => shell.value.data.surfaces.find((p) => p.fallbackPanel && p.panel))
const fallbackState = shallowRef<{ readonly at: string; readonly data: unknown } | undefined>(undefined)
const readFallback = () => {
  const surface = fallbackSurface.value
  if (!surface) { fallbackState.value = undefined; return }
  const snap = applicationState.system.read({ ref: surface.id }) as { at?: string; data?: unknown } | undefined
  fallbackState.value = snap ? { at: snap.at ?? '', data: snap.data } : undefined
}
watch(() => fallbackSurface.value?.id, readFallback, { immediate: true, flush: 'sync' })
onScopeDispose(applicationState.system.subscribe((changed) => {
  const id = fallbackSurface.value?.id
  if (id && changed.includes(id)) readFallback()
}))
const fallbackShown = computed(() => !!fallbackState.value && !!fallbackSurface.value?.fallbackPanel?.isShown(fallbackState.value))

// The default pack's canvas when the default toggle is on, and the open surface's otherwise. `defaultSurface`
// is null until a pack claims it, which is every window's first moment, so the open surface is the fallback
const canvasSurface = computed(() =>
  (shell.value.data.defaultToggles.canvas ? shell.value.data.defaultSurface : null) ?? shell.value.data.activeSurface
)

const currentSurfaceId = computed(() => canvasSurface.value.id)

const canShowPanel = computed(() => fallbackShown.value || !!shell.value.data.activeSurface.panel)
const isPanelOpen = computed(() => shell.value.data.panelSizes.inspectionWidth > 0)

const allMenuItems = computed<ContextMenuItem[]>(() => {
  const surfaceItems = shell.value.data.contextMenuItems

  const defaultItems: ContextMenuItem[] = [
    ...(hasHelp(currentSurfaceId.value) ? [{ label: 'Help', icon: CircleHelp, event: { type: 'APP_OPEN_SURFACE_HELP', surfaceId: currentSurfaceId.value } }] : []),
    {
      label: 'Pop Out Surface',
      icon: ExternalLink,
      event: { type: 'APP_POPOUT_SURFACE', surfaceId: currentSurfaceId.value },
      separator: surfaceItems.length > 0,
    },
    {
      label: 'Settings',
      icon: SettingsIcon,
      event: { type: 'APP_OPEN_FEATURE_SETTINGS', featureId: currentSurfaceId.value },
    },
    {
      label: 'Show Canvas',
      icon: PanelTop,
      event: { type: 'APP_TOGGLE_CANVAS' },
      isActive: !chatMaximized.value,
    },
    ...(canShowPanel.value ? [{
      label: 'Context Panel',
      icon: PanelRight,
      event: { type: 'APP_TOGGLE_INSPECTION_PANEL' },
      isActive: isPanelOpen.value,
    }] : []),
    ...(fallbackSurface.value ? [{
      label: fallbackSurface.value.fallbackPanel!.label,
      icon: Terminal,
      event: { type: 'APP_TOGGLE_FALLBACK_PANEL' },
      isActive: fallbackShown.value,
    }] : []),
  ]

  return [...surfaceItems, ...defaultItems]
})

const handleMenuAction = (event: ContextMenuItem['event']) => {
  if (event.type === 'APP_TOGGLE_CANVAS') {
    send({ type: chatMaximized.value ? 'RESTORE_CHAT' : 'MAXIMIZE_CHAT' })
    return
  }

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

  if (event.type === 'APP_TOGGLE_FALLBACK_PANEL') {
    const surface = fallbackSurface.value
    if (surface?.fallbackPanel) applicationState.surface(surface.id)?.send(surface.fallbackPanel.toggle)
    return
  }

  if (event.type === 'APP_OPEN_SURFACE_HELP' && typeof event.surfaceId === 'string') { openFeatureHelp(event.surfaceId); return; }

  if (event.type === 'APP_OPEN_FEATURE_SETTINGS') {
    untypedOpenSurface(HOST.settings, [
      { type: 'TAB.SELECT', tab: 'features' },
      { type: 'FEATURE.SELECT', featureId: event.featureId }
    ])
    return
  }

  if (event.type === 'APP_POPOUT_SURFACE') {
    const surface = surfaces.value.find((item) => item.id === event.surfaceId)
      ?? shell.value.data.activeSurface
    window.electronAPI?.surfaces?.popout(surface.id, surface.label)
    return
  }

  const surfaceId = canvasSurface.value.id
  // Through the funnel, so the surface is named while it handles this and a send it makes can be answered.
  // A menu click is nobody's question, so it carries no asker.
  const target = applicationState.surface(surfaceId)
  if (target) notifySurfaceActor(target, surfaceId, event)
}

const MIN_CHAT_HEIGHT = 180 // px — enough for chat input to remain visible

const getMainAreaHeight = () => window.innerHeight - 50 // Approximate, accounting for toolbar

// Guard so drag-to-restore only fires once per maximized drag
let maxRestored = false

const handleCanvasResize = (delta: number) => {
  if (chatMaximized.value) {
    if (!maxRestored) { maxRestored = true; handleChatRestore(true) }
    return
  }
  maxRestored = false
  const mainAreaHeight = getMainAreaHeight()
  const currentHeightPx = (shell.value.data.panelSizes.canvasHeight / 100) * mainAreaHeight
  const newHeightPx = currentHeightPx + delta
  const maxCanvasPercent = ((mainAreaHeight - MIN_CHAT_HEIGHT) / mainAreaHeight) * 100
  const newHeightPercent = Math.min(maxCanvasPercent, (newHeightPx / mainAreaHeight) * 100)
  send({ type: 'RESIZE_PANEL', panel: 'canvas', size: newHeightPercent })
}

const handleInspectionResize = (delta: number) => {
  const newWidth = shell.value.data.panelSizes.inspectionWidth - delta
  send({ type: 'RESIZE_PANEL', panel: 'inspection', size: newWidth })
}

const handleCanvasClick = () => {
  if (chatMaximized.value) { handleChatRestore(); return }
  const isCollapsed = shell.value.data.panelSizes.canvasHeight >= 93
  send({ type: 'RESIZE_PANEL', panel: 'canvas', size: isCollapsed ? 50 : 95 })
}

const handleChatMaximize = () => send({ type: 'MAXIMIZE_CHAT' })
const handleChatRestore = (maxChat = false) => {
  send({ type: 'RESTORE_CHAT' })
  if (maxChat) {
    const minCanvasPercent = (MIN_CHAT_HEIGHT / getMainAreaHeight()) * 100
    send({ type: 'RESIZE_PANEL', panel: 'canvas', size: minCanvasPercent })
  }
}

const handleInspectionClick = () => {
  // Toggle inspection panel between collapsed and default
  send({ type: 'TOGGLE_INSPECTION_PANEL' });
}
</script>

<style lang="scss" module>
</style>
