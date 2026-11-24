<template>
  <DialogRoot :open="true" @update:open="open => { if (!open) emit('close', true) }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[100] bg-black/60" />
      <DialogContent class="fixed inset-0 z-[101] mx-auto my-auto flex h-fit max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-neutral-900 text-neutral-100 shadow-2xl" @close-auto-focus="event => event.preventDefault()">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <DialogTitle class="text-base font-semibold">Claude memory</DialogTitle>
            <DialogDescription class="mt-1 text-xs text-neutral-400">Instruction files and Auto-memory for this conversation.</DialogDescription>
          </div>
          <DialogClose aria-label="Close Claude memory" class="rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-blue-400"><X :size="17" /></DialogClose>
        </header>
        <div class="min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
          <p v-if="problem" role="alert" class="pt-4 text-sm text-amber-200">{{ problem }}</p>
          <p v-if="pending && !dialog" role="status" class="py-5 text-sm text-neutral-400">Loading Claude memory…</p>
          <template v-if="dialog">
            <div class="flex items-center justify-between gap-3 border-b border-white/10 py-4">
              <div>
                <h3 class="text-sm font-medium">Auto-memory</h3>
                <p role="status" class="mt-1 text-xs text-neutral-400">{{ dialog.auto_memory.status }}</p>
              </div>
              <button type="button" :aria-label="dialog.auto_memory.enabled ? 'Turn Auto-memory off' : 'Turn Auto-memory on'" :disabled="pending || !dialog.auto_memory.toggleable || busy || managedSettingsStale || !!problem" class="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" @click="load(!dialog.auto_memory.enabled)">
                {{ pendingAction === 'setAutoMemory' ? 'Saving…' : dialog.auto_memory.enabled ? 'Turn off' : 'Turn on' }}
              </button>
            </div>
            <p v-if="dialog.auto_dream.shown" class="border-b border-white/10 py-3 text-sm">Auto-dream <span class="text-neutral-400">{{ dialog.auto_dream.status }}</span></p>
            <h3 class="mb-1 mt-4 text-xs font-medium text-neutral-300">Instruction files</h3>
            <p v-if="!dialog.files.length" class="py-2 text-sm text-neutral-400">No instruction files reported.</p>
            <ul class="divide-y divide-white/10">
              <li v-for="file in dialog.files" :key="file.path" class="flex items-center justify-between gap-3 py-2.5">
                <div class="min-w-0">
                  <p class="break-words text-sm">{{ file.label }}</p>
                  <p :title="file.path" class="truncate font-mono text-xs text-neutral-400">{{ file.path }}</p>
                </div>
                <button v-if="file.exists" type="button" :aria-label="'Edit ' + file.label" class="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-blue-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400" @click="editFile(file.path)">Edit file</button>
                <button v-else-if="file.kind === 'user' || file.kind === 'project'" type="button" :aria-label="'Create ' + file.label" :disabled="pending" class="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-blue-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" @click="operate({kind: 'createInstruction', path: file.path})">Create file</button>
                <span v-else class="shrink-0 pr-2.5 text-xs text-neutral-500">Missing</span>
              </li>
            </ul>
            <template v-if="dialog.folders.length">
              <h3 class="mb-1 mt-4 text-xs font-medium text-neutral-300">Memory folders</h3>
              <ul class="divide-y divide-white/10">
                <li v-for="folder in dialog.folders" :key="folder.path" class="flex items-center justify-between gap-3 py-2.5">
                  <p :title="folder.path" class="min-w-0 truncate font-mono text-xs text-neutral-400">{{ folder.path }}</p>
                  <button type="button" :aria-label="folder.label" :disabled="pending" class="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-blue-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" @click="operate({kind: 'openFolder', path: folder.path})">{{ folder.label }}</button>
                </li>
              </ul>
            </template>
            <template v-if="dialog.memories?.length">
              <h3 class="mb-1 mt-4 text-xs font-medium text-neutral-300">Saved memories</h3>
              <ul class="divide-y divide-white/10">
                <li v-for="item in dialog.memories" :key="item.path" class="flex items-center justify-between gap-3 py-2.5">
                  <div class="min-w-0">
                    <p class="break-words text-sm">{{ item.name }}</p>
                    <p :title="item.path" class="truncate font-mono text-xs text-neutral-400">{{ item.path }}</p>
                  </div>
                  <button type="button" :aria-label="'Edit ' + item.name" class="shrink-0 rounded-md px-2.5 py-1.5 text-xs text-blue-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400" @click="editFile(item.path)">Edit file</button>
                </li>
              </ul>
            </template>
          </template>
        </div>
        <footer class="flex shrink-0 justify-end border-t border-white/10 px-5 py-3">
          <button type="button" :disabled="pending" class="rounded-md px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/10 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" @click="load()">Refresh</button>
          <DialogClose class="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium hover:bg-white/15 focus-visible:outline focus-visible:outline-blue-400">Done</DialogClose>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { X } from 'lucide-vue-next'
import { openSurface } from '#generated/fe.ts'
import { ask } from '#generated/events.ts'
import type { ClaudeMemoryRequest } from '../../be/types.ts'
import type { ClaudeMemoryDialog } from '#features/code/be/services/claude-code/host-controls.ts'

const props = defineProps<{ target: Omit<ClaudeMemoryRequest, 'action'>; busy?: boolean; managedSettingsRevision?: number }>()
const emit = defineEmits<{ close: [restoreFocus: boolean] }>()
const dialog = shallowRef<ClaudeMemoryDialog>()
const problem = ref<string>()
const pendingAction = ref<ClaudeMemoryRequest['action']['kind']>()
const pending = computed(() => pendingAction.value !== undefined)
const lifetime = new AbortController()
const readPolicyRevision = ref(props.managedSettingsRevision)
const managedSettingsStale = computed(() => readPolicyRevision.value !== props.managedSettingsRevision)
watch([managedSettingsStale, pending], ([stale, inFlight]) => {
  if (stale && !inFlight) void load()
}, { flush: 'post' })
onMounted(() => { void load() })
onBeforeUnmount(() => lifetime.abort())

function load(enabled?: boolean) {
  return operate(enabled === undefined ? { kind: 'read' } : { kind: 'setAutoMemory', enabled })
}

async function operate(action: ClaudeMemoryRequest['action']) {
  if (pending.value || lifetime.signal.aborted || (action.kind === 'setAutoMemory' && managedSettingsStale.value)) return
  if (action.kind === 'read') readPolicyRevision.value = props.managedSettingsRevision
  pendingAction.value = action.kind
  problem.value = undefined
  try {
    const outcome = await ask('threads', { type: 'CLAUDE_MEMORY', ...props.target, action }, { signal: lifetime.signal })
    if (lifetime.signal.aborted || (action.kind === 'read' && managedSettingsStale.value)) return
    if (!outcome.ok) { problem.value = outcome.failure.message; return }
    if (outcome.value.path) {
      if (action.kind === 'createInstruction') editFile(outcome.value.path)
      if (action.kind === 'openFolder') {
        const shell = window.electronAPI?.shell
        if (!shell) throw new Error('Opening a memory folder requires the desktop app')
        await shell.openPath(outcome.value.path)
      }
      return
    }
    dialog.value = outcome.value.dialog
    if (!dialog.value) problem.value = 'Preference saved. Refresh to read the effective status.'
  } catch (error) {
    if (!lifetime.signal.aborted) problem.value = error instanceof Error ? error.message : 'Claude memory could not load'
  } finally { pendingAction.value = undefined }
}
function editFile(path: string) {
  emit('close', false)
  openSurface('code', { type: 'explorer.OPEN_FILE', path })
}
</script>
