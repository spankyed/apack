<template>
  <div
    class="relative flex flex-col flex-grow border-b bg-neutral-900 border-neutral-800"
    :class="$style.component"
  >
    <!-- HEADER ROW -->
    <div
      class="flex items-center w-full h-header px-3 border-b border-neutral-800 overflow-x-auto overflow-y-hidden scrollbar-none"
      :class="[headerClass, menuOpen ? '' : 'canvas-header']"
      :style="headerStyle"
      @wheel.prevent="($event.currentTarget as HTMLElement).scrollLeft += $event.deltaY"
    >
      <!-- ▸ Breadcrumbs with inline ⋮ menu trigger.
           Keep the breadcrumb strip no-drag so wheel events work, while the
           surrounding header remains draggable for window movement. -->
      <nav
        v-if="breadcrumbs?.length"
        aria-label="Breadcrumb"
        class="no-drag flex items-center gap-1 ml-2 py-2 text-sm text-neutral-500 whitespace-nowrap min-w-max"
        @contextmenu.prevent="menuItems.length > 0 && (menuOpen = true)"
      >
        <DropdownMenuRoot v-model:open="menuOpen">
          <!-- ⋮ icon as part of the breadcrumb row -->
          <DropdownMenuTrigger v-if="menuItems.length > 0" as-child>
            <button
              class="p-0.5 -ml-0.5 mr-1 rounded text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
              title="Surface menu"
            >
              <EllipsisVertical :size="14" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              class="min-w-[180px] bg-neutral-800 border border-neutral-700 rounded-md shadow-lg p-1 z-50"
              :side="'bottom'"
              :side-offset="8"
              :align="'start'"
            >
              <SurfaceMenuItems
                :items="menuItems"
                :ItemComponent="DropdownMenuItem"
                :SeparatorComponent="DropdownMenuSeparator"
                @action="(ev) => $emit('menu-action', ev)"
              />
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <div v-for="(crumb, idx) in breadcrumbs" :key="idx" class="flex items-center">
          <span
            class="text-xs font-semibold tracking-wider uppercase transition-colors cursor-pointer hover:text-white"
            @click="$emit('crumb-click', crumb.target || '', crumb.info)"
          >
            {{ crumb.label }}
          </span>
          <!-- separator, skip after last -->
          <ChevronRight
            v-if="idx < breadcrumbs?.length - 1"
            :size="12"
            class="mx-1 text-neutral-600"
          />
        </div>
      </nav>
    </div>

    <!-- MAIN SCROLL AREA (hidden when headerOnly — chat-maximized mode) -->
    <div v-if="!headerOnly" class="flex-1 w-full overflow-y-auto">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, EllipsisVertical } from 'lucide-vue-next'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
} from 'reka-ui'
import SurfaceMenuItems from './SurfaceMenuItems.vue'
import { useTrackedMenuOpen } from '@apackdev/sdk/fe'
import type { ContextMenuItem as ContextMenuItemType } from '@apackdev/sdk/fe'
import type { BreadcrumbItem } from '@apackdev/host/fe'

const menuOpen = ref(false)
useTrackedMenuOpen(menuOpen)

interface Props {
  label: string
  breadcrumbs?: readonly BreadcrumbItem[]
  menuItems?: ContextMenuItemType[]
  headerClass?: string
  headerOnly?: boolean
  headerInsetLeft?: number
  headerInsetRight?: number
}
const props = withDefaults(defineProps<Props>(), {
  menuItems: () => [],
  headerOnly: false,
  headerInsetLeft: 0,
  headerInsetRight: 0,
})

const headerStyle = computed(() => ({
  paddingLeft: props.headerInsetLeft ? `${props.headerInsetLeft}px` : undefined,
  paddingRight: props.headerInsetRight ? `${props.headerInsetRight}px` : undefined,
}))
defineEmits<{
  (e: 'canvas-toggle'): void
  (e: 'crumb-click', target: string, info?: unknown): void
  (e: 'menu-action', event: ContextMenuItemType['event']): void
}>()
</script>

<style lang="scss" module>
.component {
  height: 100%;
}
</style>

<style lang="scss">
/* Make header draggable for window movement */
.canvas-header {
  -webkit-app-region: drag;
  user-select: none;
}

/* Ensure interactive elements remain clickable */
.canvas-header .no-drag,
.canvas-header button,
.canvas-header a,
.canvas-header span[class*="cursor-pointer"] {
  -webkit-app-region: no-drag;
}
</style>
