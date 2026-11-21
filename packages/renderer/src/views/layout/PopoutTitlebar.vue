<template>
  <header
    class="popout-titlebar flex h-header w-full items-center border-b border-neutral-800 bg-neutral-900 px-3"
    :class="headerClass"
    @wheel.prevent="($event.currentTarget as HTMLElement).scrollLeft += $event.deltaY"
  >
    <div class="no-drag mr-3 flex h-full items-center border-r border-neutral-800 pr-3">
      <div v-if="isMac" class="mac-native-controls-spacer" aria-hidden="true" />
      <WindowControls v-else />
    </div>

    <nav
      v-if="breadcrumbs?.length"
      aria-label="Breadcrumb"
      class="no-drag flex min-w-0 items-center gap-1 py-2 text-sm text-neutral-500 whitespace-nowrap"
      @contextmenu.prevent="menuItems.length > 0 && (menuOpen = true)"
    >
      <DropdownMenuRoot v-model:open="menuOpen">
        <DropdownMenuTrigger v-if="menuItems.length > 0" as-child>
          <button
            class="mr-1 rounded p-0.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
            title="Surface menu"
          >
            <EllipsisVertical :size="14" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent
            class="z-50 min-w-[180px] rounded-md border border-neutral-700 bg-neutral-800 p-1 shadow-lg"
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

      <div v-for="(crumb, idx) in breadcrumbs" :key="idx" class="flex min-w-0 items-center">
        <span
          class="cursor-pointer text-xs font-semibold uppercase transition-colors hover:text-white"
          @click="$emit('crumb-click', crumb.target || '', crumb.info)"
        >
          {{ crumb.label }}
        </span>
        <ChevronRight
          v-if="idx < breadcrumbs.length - 1"
          :size="12"
          class="mx-1 flex-shrink-0 text-neutral-600"
        />
      </div>
    </nav>
  </header>
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
import WindowControls from '@/views/layout/WindowControls.vue'
import SurfaceMenuItems from '@/views/layout/SurfaceMenuItems.vue'
import { useTrackedMenuOpen } from '@apackdev/sdk/fe'
import type { ContextMenuItem } from '@apackdev/sdk/fe'
import type { BreadcrumbItem } from '@apackdev/host/fe'

withDefaults(defineProps<{
  breadcrumbs?: readonly BreadcrumbItem[]
  menuItems?: ContextMenuItem[]
  headerClass?: string
}>(), {
  breadcrumbs: () => [],
  menuItems: () => [],
})

defineEmits<{
  (e: 'crumb-click', target: string, info?: unknown): void
  (e: 'menu-action', event: ContextMenuItem['event']): void
}>()

const menuOpen = ref(false)
useTrackedMenuOpen(menuOpen)

const isMac = computed(() => navigator.platform.toLowerCase().includes('mac'))
</script>

<style scoped>
.popout-titlebar {
  -webkit-app-region: drag;
  overflow: hidden;
  user-select: none;
}

.no-drag,
.popout-titlebar button,
.popout-titlebar a {
  -webkit-app-region: no-drag;
}

.mac-native-controls-spacer {
  width: 68px;
  height: 1px;
}
</style>
