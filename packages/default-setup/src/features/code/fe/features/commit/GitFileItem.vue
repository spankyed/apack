<template>
  <TrackedContextMenuRoot>
    <ContextMenuTrigger as-child>
      <div
        @click="$emit('select', file)"
        :title="file.status === 'renamed' && file.originalPath ? `${file.originalPath} → ${file.path}` : file.path"
        :class="[
          'group flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors',
          isSelected ? 'bg-neutral-800' : 'hover:bg-neutral-800/50'
        ]"
      >
        <div class="flex-1 min-w-0 flex items-center gap-1.5">
          <slot name="prefix" />
          <span class="text-sm font-medium text-neutral-200 truncate min-w-0">{{ fileDisplay.filename }}</span>
          <span v-if="file.nameNotText" data-testid="name-not-text" class="flex-shrink-0 text-[10px] text-amber-400" title="Its name is not valid text, so git cannot be asked about it by name here: it is left out of Stage all, Unstage all and Discard all">name not text</span>
          <span v-if="fileDisplay.directory" dir="rtl" class="text-xs text-neutral-500 truncate min-w-0 shrink-[9999]">
            {{ fileDisplay.directory }}
          </span>
        </div>
        <slot name="statusBadge">
          <span v-if="count && !count.binary && (count.added || count.removed)" class="flex-shrink-0 text-[10px] tabular-nums space-x-0.5" data-testid="line-count">
            <span v-if="count.added" class="text-green-500/80">+{{ count.added }}</span>
            <span v-if="count.removed" class="text-red-500/80">-{{ count.removed }}</span>
          </span>
          <span :class="getStatusColor(file.status)" class="flex-shrink-0 w-4 text-xs font-medium">
            {{ getStatusIcon(file.status) }}
          </span>
        </slot>
        <button
          v-if="file.status !== 'deleted' && !file.isDirectory"
          @click.stop="$emit('openFile', file)"
          class="p-0.5 hover:bg-neutral-700 rounded"
          title="Open file"
        >
          <File class="w-3 h-3 text-neutral-400" />
        </button>
        <slot name="actions" />
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent :class="MENU_CONTENT_CLASS">
        <ContextMenuItem v-if="file.status !== 'deleted' && !file.isDirectory" @select="$emit('openFile', file)" :class="MENU_ITEM_CLASS">
          <File class="w-4 h-4" /> Open File
        </ContextMenuItem>
        <ContextMenuItem @select="copyPath(file.path)" :class="MENU_ITEM_CLASS">
          <Copy class="w-4 h-4" /> Copy Path
        </ContextMenuItem>
        <ContextMenuItem @select="copyRelativePath(file.path)" :class="MENU_ITEM_CLASS">
          <Copy class="w-4 h-4" /> Copy Relative Path
        </ContextMenuItem>
        <ContextMenuSeparator :class="MENU_SEPARATOR_CLASS" />
        <slot name="menuItems" />
      </ContextMenuContent>
    </ContextMenuPortal>
  </TrackedContextMenuRoot>
</template>

<script setup lang="ts">
import { useSurface } from '@apackdev/sdk/fe'

import { computed } from 'vue'
import { useSelector } from '@xstate/vue'
import type { CodeState } from '#features/code/fe/state.ts'
import type { GitStatusFile } from '#features/code/fe/features/commit/state.ts'
import { File, Copy } from 'lucide-vue-next'
import { ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuSeparator } from 'reka-ui'
import TrackedContextMenuRoot from '@apackdev/ui/design/TrackedContextMenuRoot'
import { MENU_ITEM_CLASS, MENU_CONTENT_CLASS, MENU_SEPARATOR_CLASS } from '#features/code/fe/features/explorer/constants.ts'

const props = defineProps<{
  file: GitStatusFile
  isSelected: boolean
  /** How many lines the file adds and removes, as git counts them, when it is counted */
  count?: { added: number; removed: number; binary: boolean }
}>()

defineEmits<{
  select: [file: GitStatusFile]
  openFile: [file: GitStatusFile]
}>()

const codeActor: CodeState = useSurface()
const baseDirectory = useSelector(codeActor, (state) => state.context.baseDirectory)

const fileDisplay = computed(() => {
  // A folder's row is named by the folder, with the `/` git ends it with
  const filePath = props.file.isDirectory ? props.file.path.slice(0, -1) : props.file.path
  const lastSlashIndex = filePath.lastIndexOf('/')
  const filename = lastSlashIndex === -1 ? filePath : filePath.substring(lastSlashIndex + 1)
  const directory = lastSlashIndex === -1 ? '' : filePath.substring(0, lastSlashIndex)

  if (props.file.status === 'renamed' && props.file.originalPath) {
    const origLastSlash = props.file.originalPath.lastIndexOf('/')
    const origFilename = origLastSlash === -1 ? props.file.originalPath : props.file.originalPath.substring(origLastSlash + 1)
    return { filename: `${origFilename} → ${filename}`, directory }
  }

  return { filename: props.file.isDirectory ? `${filename}/` : filename, directory }
})

const getStatusIcon = (status: GitStatusFile['status']) => {
  switch (status) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'untracked': return 'U'
    case 'copied': return 'C'
    case 'typechange': return 'T'
    case 'unmerged': return 'U'
    default: return '?'
  }
}

const getStatusColor = (status: GitStatusFile['status']) => {
  switch (status) {
    case 'modified': return 'text-yellow-500'
    case 'added': return 'text-green-500'
    case 'deleted': return 'text-red-500'
    case 'renamed': return 'text-blue-500'
    case 'untracked': return 'text-neutral-500'
    case 'copied': return 'text-purple-500'
    case 'typechange': return 'text-orange-500'
    case 'unmerged': return 'text-red-600'
    default: return 'text-neutral-400'
  }
}

const copyPath = async (path: string) => {
  try { await navigator.clipboard.writeText(path) } catch (err) { console.error('Failed to copy path:', err) }
}

const copyRelativePath = async (path: string) => {
  try {
    const base = baseDirectory.value
    let rel = path
    if (base && rel.startsWith(base)) {
      rel = rel.slice(base.length)
      if (rel.startsWith('/')) rel = rel.slice(1)
    }
    await navigator.clipboard.writeText(rel)
  } catch (err) { console.error('Failed to copy path:', err) }
}
</script>
