<template>
  <section role="dialog" aria-label="Claude Code settings" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown.esc.stop.prevent="emit('close')">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div><h2 class="text-sm font-medium text-neutral-200">Claude Code settings</h2><p class="mt-1 text-xs text-neutral-500">Changes are validated and saved by Claude Code.</p></div>
      <button type="button" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400" @click="emit('close')">Close settings</button>
    </header>
    <div class="shrink-0 border-b border-white/5 px-4 py-3">
      <input ref="searchInput" v-model="search" aria-label="Search Claude Code settings" placeholder="Search settings…" class="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-400" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" aria-label="Claude Code settings list" tabindex="0">
      <p v-if="!state?.snapshot && state?.status !== 'error'" role="status" class="py-6 text-sm text-neutral-400">Loading settings…</p>
      <p v-else-if="!rows.length" class="py-6 text-sm text-neutral-500">No matching settings.</p>
      <div v-for="row in rows" :key="row.key" class="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-3" :data-native-setting="row.key">
        <label :for="controlId(row.key)" class="min-w-0 flex-1 basis-40">
          <span class="text-sm text-neutral-200">{{ row.label }}</span>
          <span v-if="row.description" class="mt-1 block text-xs leading-relaxed text-neutral-500">{{ row.description }}</span>
          <span v-if="row.isLocked" class="mt-1 block text-xs text-amber-200/80">{{ row.lockReason || 'Managed by Claude Code policy' }}</span>
        </label>
        <input v-if="row.kind === 'boolean'" :id="controlId(row.key)" type="checkbox" :checked="row.value === true" :disabled="pending || row.isLocked" class="size-4 shrink-0 accent-blue-500 disabled:opacity-40" @change="changeBoolean(row.key, row.value, $event)" />
        <select v-else-if="row.kind === 'choice' && row.options?.length" :id="controlId(row.key)" :value="row.value" :disabled="pending || row.isLocked" class="max-w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 disabled:opacity-40" @change="changeChoice(row.key, row.value, $event)">
          <option v-if="row.value === null" value="" disabled>Select a value</option>
          <option v-for="option in row.options" :key="option" :value="option">{{ option }}</option>
        </select>
        <form v-else class="flex max-w-full items-center gap-2" @submit.prevent="save(row.key, row.kind === 'number' ? Number(drafts[row.key] ?? row.value) : drafts[row.key] ?? String(row.value ?? ''))">
          <input :id="controlId(row.key)" :type="row.kind === 'number' ? 'number' : 'text'" :value="drafts[row.key] ?? row.value ?? ''" :disabled="pending || row.isLocked" class="min-w-0 w-40 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 disabled:opacity-40" @input="drafts[row.key] = ($event.target as HTMLInputElement).value" />
          <button type="submit" :disabled="pending || row.isLocked || drafts[row.key] === undefined" class="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-40">Save</button>
        </form>
      </div>
    </div>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-xs">
      <p v-if="state?.problem" role="alert" class="min-w-0 flex-1 break-words text-amber-200">{{ state.problem }}</p>
      <p v-else role="status" class="text-neutral-400">{{ pending ? 'Waiting for Claude Code…' : state?.savedKey ? 'Saved by Claude Code' : `${rows.length} settings` }}</p>
      <button type="button" :disabled="pending" class="rounded-lg px-3 py-2 text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="emit('operate', { kind: 'read' })">Refresh</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ClaudeSettingsOperation, ClaudeSettingsView, ClaudeSettingValue } from '#features/code/common/native-settings.ts'
const props = defineProps<{ state?: ClaudeSettingsView }>()
const emit = defineEmits<{ operate: [action: ClaudeSettingsOperation]; close: [] }>()
const search = ref(''), searchInput = ref<HTMLInputElement>(), drafts = ref<Record<string, string>>({})
const pending = computed(() => props.state?.status === 'pending')
const rows = computed(() => (props.state?.snapshot?.rows ?? []).filter(row => `${row.label} ${row.description ?? ''} ${row.key}`.toLowerCase().includes(search.value.toLowerCase())))
function controlId(key: string) { return 'claude-setting-' + encodeURIComponent(key) }
function changeBoolean(key: string, previous: ClaudeSettingValue, event: Event) {
  const control = event.target as HTMLInputElement, value = control.checked
  control.checked = previous === true; save(key, value)
}
function changeChoice(key: string, previous: ClaudeSettingValue, event: Event) {
  const control = event.target as HTMLSelectElement, value = control.value
  control.value = String(previous ?? ''); save(key, value)
}
function save(key: string, value: ClaudeSettingValue) {
  if (!pending.value && props.state?.snapshot) emit('operate', {kind:'write',revision:props.state.snapshot.revision,key,value})
}
watch(() => props.state?.savedKey, key => { if (key) delete drafts.value[key] })
onMounted(() => { searchInput.value?.focus(); emit('operate', {kind:'read'}) })
</script>
