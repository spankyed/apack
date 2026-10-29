<template>
<!-- data-active-surface is the active surface as rendered. Vue writes it in the same flush that swaps the
     canvas below, so a test can wait for a navigation to be on screen rather than sleep after it. -->
<div class="flex flex-col h-screen" :data-active-surface="activeSurface.id">
    <ToastNotification ref="toast" />
    <div class="flex flex-grow overflow-hidden">
    <!-- Left Toolbar (hidden during onboarding) -->
    <Toolbar
        v-if="!isOnboarding"
        :surfaces="surfaces"
        :active-surface="activeSurface"
        @select-surface="(id: string) => send({ type: 'SELECT_SURFACE', surface: id })"
        @open-surface="(id: string) => send({ type: 'OPEN_SURFACE', surface: id, events: [] })"
    />

    <!-- Main Area -->
    <div class="flex flex-grow overflow-hidden" :style="{ paddingRight: canShowPanel && panelSizes.inspectionWidth === 0 ? '2px' : '0' }">
        <div class="flex flex-col flex-grow overflow-hidden" :style="{ minWidth: '350px', width: canShowPanel && panelSizes.inspectionWidth > 0 ? `calc(100% - ${panelSizes.inspectionWidth}px)` : '100%' }">
            <!-- Intrinsic chat minimums constrain the split without rewriting its saved proportions. -->
            <!-- Canvas Area — always rendered; collapses to just its header when chat is maximized -->
            <!-- Canvas Area — empty draggable header during onboarding, normal otherwise -->
            <CanvasArea
            ref="canvasArea"
            data-onboarding-id="canvas-area"
            :header-only="isOnboarding || chatMaximized"
            @crumb-click="(target: string, info?: any) => send({ type: 'TRAIL_CLICK', target, info })"
            @canvas-toggle="send({ type: 'DEFAULT_TOGGLE', area: 'canvas' })"
            @menu-action="handleMenuAction"
            :style="isOnboarding || chatMaximized
                ? { flex: '0 0 auto', height: 'auto' }
                : { flex: `${panelSizes.canvasHeight} 1 0%`, height: 'auto', minHeight: '40px' }"
            :breadcrumbs="isOnboarding ? [] : breadcrumbs"
            :menu-items="isOnboarding ? [] : allMenuItems"
            :label="`${canvasSurface.label} Canvas`"
            :header-class="canvasSurface.options?.headerClass">
            <!-- Each surface area renders as part of its surface, which is what useSurface() returns there -->
            <SurfacePane :surface="canvasSurface" area="canvas" :target="targetView" />
            </CanvasArea>

            <!-- Vertical Resizer (hidden during onboarding) -->
            <PanelResizer
                v-if="!isOnboarding"
                orientation="vertical"
                :collapsed="chatMaximized || panelSizes.canvasHeight >= 93"
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
                    : { flex: `${100 - panelSizes.canvasHeight} 1 0%`, height: 'auto', minHeight: panelSizes.canvasHeight >= 93 ? 0 : 'auto', maxHeight: 'calc(100% - 46px)', overflow: panelSizes.canvasHeight >= 93 ? 'hidden' : 'visible' }"
            >
                <!-- The chat is the default pack's, so there is none until a pack has claimed the default -->
                <SurfacePane v-if="defaultSurface" :surface="defaultSurface" area="chat" />
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
            v-if="canShowPanel && panelSizes.inspectionWidth > 0 && !isOnboarding"
            data-onboarding-id="inspection-panel"
:style="{ width: `${panelSizes.inspectionWidth}px` }"
            :label="`${activeSurface.panel ? activeSurface.label : fallbackSurface?.label} Inspection`">
            <SurfacePane v-if="activeSurface.panel" :surface="activeSurface" area="panel" />
            <SurfacePane v-else-if="fallbackShown && fallbackSurface" :surface="fallbackSurface" area="panel" />
        </InspectionPanel>
    </div>
    </div>
</div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSelector } from '@xstate/vue'
import type { ActorRefFrom, AnyStateMachine } from 'xstate'
import { CircleHelp, Settings as SettingsIcon, ExternalLink, PanelRight, PanelTop, Terminal } from 'lucide-vue-next'
import Toolbar from '@/views/layout/Toolbar.vue'
import { useSurfaceNavigation } from '@/views/layout/surface-navigation';
import CanvasArea from '@/views/layout/CanvasArea.vue'
import ChatArea from '@/views/layout/ChatArea.vue'
import InspectionPanel from '@/views/layout/InspectionPanel.vue'
import PanelResizer from '@apackdev/ui/layout/panel-resizer'
import { applicationState } from '@/main'
import { HOST, notifySurfaceActor } from '@apackdev/host/fe'
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

const activeSurface = useSelector(applicationState, (state) => state.context.activeSurface)
const defaultSurface = useSelector(applicationState, (state) => state.context.defaultSurface)
const toggles = useSelector(applicationState, (state) => state.context.defaultToggles)
const surfaces = useSurfaceNavigation()
const breadcrumbs = useSelector(applicationState, (state) => state.context.breadcrumbs)
const contextMenuItems = useSelector(applicationState, (state) => state.context.contextMenuItems)
const targetView = useSelector(applicationState, (state) => state.context.targetView)
const panelSizes = useSelector(applicationState, (state) => state.context.panelSizes)
const chatMaximized = useSelector(applicationState, (state) => state.context.panelSizes.chatMaximized ?? false)
const isOnboarding = useSelector(applicationState, (s) => s.hasTag('onboarding'))

const allSurfaces = useSelector(applicationState, (state) => state.context.surfaces)
/** The surface offering its panel for surfaces without one (`fallbackPanel`), which says itself when it shows */
const fallbackSurface = computed(() => allSurfaces.value.find((p) => p.fallbackPanel && p.panel))
const fallbackActor = computed(() => fallbackSurface.value && applicationState.system.get(fallbackSurface.value.id) as ActorRefFrom<AnyStateMachine> | undefined)
const fallbackShown = useSelector(fallbackActor, (snapshot) =>
  !!snapshot && !!fallbackSurface.value?.fallbackPanel?.isShown(snapshot))

// The default pack's canvas when the default toggle is on, and the open surface's otherwise. `defaultSurface`
// is null until a pack claims it, which is every window's first moment, so the open surface is the fallback
const canvasSurface = computed(() =>
  (toggles.value.canvas ? defaultSurface.value : null) ?? activeSurface.value
)

const currentSurfaceId = computed(() => canvasSurface.value.id)

const canShowPanel = computed(() => fallbackShown.value || !!activeSurface.value.panel)
const isPanelOpen = computed(() => panelSizes.value.inspectionWidth > 0)

const allMenuItems = computed<ContextMenuItem[]>(() => {
  const surfaceItems = contextMenuItems.value

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
    if (surface?.fallbackPanel) fallbackActor.value?.send(surface.fallbackPanel.toggle)
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
      ?? activeSurface.value
    window.electronAPI?.surfaces?.popout(surface.id, surface.label)
    return
  }

  const surfaceId = canvasSurface.value.id
  // Through the funnel, so the surface is named while it handles this and a send it makes can be answered.
  // A menu click is nobody's question, so it carries no asker.
  notifySurfaceActor(applicationState.system.get(surfaceId), surfaceId, event)
}

const canvasArea = ref<InstanceType<typeof CanvasArea>>()
const MIN_CHAT_HEIGHT = 180 // px — enough for chat input to remain visible

const getMainAreaHeight = () => (canvasArea.value?.$el as HTMLElement | undefined)?.parentElement?.clientHeight ?? window.innerHeight

// Guard so drag-to-restore only fires once per maximized drag
let maxRestored = false

const handleCanvasResize = (delta: number) => {
  if (chatMaximized.value) {
    if (!maxRestored) { maxRestored = true; handleChatRestore(true) }
    return
  }
  maxRestored = false
  const mainAreaHeight = getMainAreaHeight()
  // A chat minimum can make the visible canvas smaller than its saved proportion.
  const currentHeightPx = (canvasArea.value?.$el as HTMLElement | undefined)?.getBoundingClientRect().height ?? (panelSizes.value.canvasHeight / 100) * mainAreaHeight
  const newHeightPx = currentHeightPx + delta
  const maxCanvasPercent = ((mainAreaHeight - MIN_CHAT_HEIGHT) / mainAreaHeight) * 100
  const newHeightPercent = Math.min(maxCanvasPercent, (newHeightPx / mainAreaHeight) * 100)
  send({ type: 'RESIZE_PANEL', panel: 'canvas', size: newHeightPercent })
}

const handleInspectionResize = (delta: number) => {
  const newWidth = panelSizes.value.inspectionWidth - delta
  send({ type: 'RESIZE_PANEL', panel: 'inspection', size: newWidth })
}

const handleCanvasClick = () => {
  if (chatMaximized.value) { handleChatRestore(); return }
  const isCollapsed = panelSizes.value.canvasHeight >= 93
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
