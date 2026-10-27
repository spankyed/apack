<template>
  <section role="dialog" :aria-label="panelTitle" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown="handleKeydown">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 break-words text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">{{ subject === 'model' ? state?.snapshot?.editor?.title || panelTitle : panelTitle }}</h2><p v-if="subject !== 'model'" class="mt-1 text-xs text-neutral-500">Changes are validated and saved by Claude Code.</p></div>
      <button type="button" :disabled="state?.snapshot?.dismissible === false" class="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-40" @click="closePanel">{{ closeLabel }}</button>
    </header>
    <nav v-if="frame && !frame.hidden" aria-label="Claude Code settings tabs" class="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
      <button v-for="tab in frame.tabs" :key="tab" type="button" :aria-current="activeTab === tab ? 'page' : undefined" :disabled="pending" class="rounded-lg px-3 py-2 text-xs text-neutral-400 hover:bg-white/5 disabled:opacity-40" :class="activeTab === tab ? 'bg-white/10 text-white' : ''" @click="operate({kind:'tab',tab})">{{ tab }}</button>
    </nav>
    <NativeSettingsEditor v-if="state?.snapshot?.editor" :editor="state.snapshot.editor" :pending="editorPending" :reset-epoch="liveForm.resetEpoch.value" :submit-disabled="!!(state.snapshot.editor.kind === 'form' && state.snapshot.editor.live) && !liveForm.canSubmit.value" :preview-problem="state.status === 'error'" :preview-pending="liveForm.busy.value" :hide-header="subject === 'model'" :cancel-label="subject === 'model' && state.snapshot.refreshPending ? 'Cancel model change' : undefined" @set-group="(key, value) => editorCommand({action:'setGroup',key,value})" @select="editorCommand({action:'select',value:$event})" @focus-model="editorCommand({action:'focusModel',value:$event})" @adjust-effort="editorCommand({action:'adjustEffort',direction:$event})" @preview="editorCommand({action:'preview',value:$event})" @toggle-syntax="editorCommand({action:'toggleSyntax'})" @change="(formId,key,value) => editorCommand({action:'change',formId,key,value})" @save="editorCommand({action:'save',values:$event})" @cancel="editorCommand({action:'cancel'})" />
    <p v-else-if="subject === 'model'" role="status" class="min-h-0 flex-1 overflow-auto p-4 text-sm text-neutral-400">Loading model controls…</p>
    <template v-else-if="activeTab === 'Config'">
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
        <span v-if="row.key === 'autoUpdatesChannel'" class="text-xs text-neutral-400">{{ row.value }}</span>
        <span v-if="row.key === 'showExternalIncludesDialog'" class="text-xs text-neutral-400">{{ row.value === 'true' ? 'Allowed' : 'Not allowed' }}</span>
        <span v-if="row.key === 'remoteHomeSettings' && row.editorAvailable" class="text-xs text-neutral-400">Not forwarding</span>
        <button v-if="row.editorAvailable" type="button" :disabled="pending || row.isLocked" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-200 disabled:opacity-40" @click="openEditor(row.key)">{{ row.key === 'remoteHomeSettings' ? 'Review cloud settings…' : row.key === 'showExternalIncludesDialog' ? row.value === 'true' ? 'Disable external imports' : 'Review external imports…' : 'Change…' }}</button>
        <input v-else-if="row.kind === 'boolean'" :id="controlId(row.key)" type="checkbox" :checked="row.value === true" :disabled="pending || row.isLocked" class="size-4 shrink-0 accent-blue-500 disabled:opacity-40" @change="changeBoolean(row.key, row.value, $event)" />
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
    </template>
    <div v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" :aria-label="`Claude Code ${activeTab}`" tabindex="0">
      <template v-if="activeTab === 'Status'">
        <dl v-for="(group, index) in frame?.status" :key="index" class="mb-4 divide-y divide-white/5 rounded-lg border border-white/10 px-3">
          <div v-for="(row, rowIndex) in group" :key="rowIndex" class="grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-3 py-3 text-xs">
            <dt :class="row.label ? 'text-neutral-500' : 'sr-only'">{{ row.label || 'Additional information' }}</dt><dd class="whitespace-pre-wrap break-words text-neutral-200" :class="!row.label ? 'col-span-2' : ''">{{ row.value }}</dd>
          </div>
        </dl>
        <section v-if="frame?.diagnostics?.length" aria-label="System diagnostics" class="space-y-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <h3 class="text-sm font-medium text-neutral-200">System diagnostics</h3>
          <ul class="space-y-3 text-xs text-amber-200"><li v-for="(warning, index) in frame.diagnostics" :key="index" class="whitespace-pre-wrap break-words">{{ warning }}</li></ul>
        </section>
        <p v-if="!frame?.status" role="status" class="text-sm text-neutral-400">Waiting for Claude Code Status…</p>
      </template>
      <template v-else-if="activeTab === 'Usage'">
        <div v-if="frame?.usage" class="space-y-4">
          <dl class="grid grid-cols-2 gap-3 text-xs">
            <div v-if="frame.usage.cost" class="rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">Session cost</dt><dd class="mt-2 text-lg text-neutral-200">{{ money(frame.usage.cost.usd) }}</dd></div>
            <div class="rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">Context window</dt><dd class="mt-2 text-lg text-neutral-200">{{ number(frame.usage.context.window) }}</dd><p v-if="frame.usage.context.tokens !== undefined" class="mt-1 text-neutral-400">{{ number(frame.usage.context.tokens) }} tokens used<span v-if="frame.usage.context.percent !== undefined"> · {{ frame.usage.context.percent }}%</span></p></div>
          </dl>
          <div v-for="(limit, index) in frame.usage.rateLimits" :key="index" class="rounded-lg border border-white/10 p-3 text-xs text-neutral-300"><p>{{ limit.kind }} · {{ limit.percentUsed }}% used</p><p v-if="limit.resetsAt" class="mt-1 text-neutral-500">Resets {{ limit.resetsAt }}</p></div>
          <p v-if="!frame.usage.rateLimits.length" class="text-xs text-neutral-500">Claude Code has no rate-limit reading for this session.</p>
        </div>
        <p v-else role="status" class="text-sm text-neutral-400">Waiting for Claude Code Usage…</p>
      </template>
      <NativeSettingsStats v-else-if="activeTab === 'Stats'" :stats="frame?.stats" :pending="pending" @action="action => operate({kind:'stats',action})" />
    </div>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-xs">
      <p v-if="state?.problem" role="alert" class="min-w-0 flex-1 break-words text-amber-200">{{ state.problem }}</p>
      <p v-else role="status" class="text-neutral-400">{{ pending ? 'Waiting for Claude Code…' : state?.savedKey ? 'Saved by Claude Code' : subject === 'model' ? 'Choose a model' : activeTab === 'Config' ? `${rows.length} settings` : activeTab }}</p>
      <button type="button" :disabled="pending" class="rounded-lg px-3 py-2 text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="emit('operate', { kind: 'read' })">Refresh</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import NativeSettingsStats from './NativeSettingsStats.vue'
import NativeSettingsEditor from './NativeSettingsEditor.vue'
import { useNativeSettingsForm } from './native-settings-form.ts'
import type { ClaudeSettingsOperation, ClaudeSettingsView, ClaudeSettingValue } from '#features/code/common/native-settings.ts'
const props = withDefaults(defineProps<{ state?: ClaudeSettingsView; ownerLabel?: string; subject?: 'settings' | 'model' }>(), {subject:'settings'})
const panelTitle = computed(() => props.subject === 'model' ? 'Claude Code model' : 'Claude Code settings')
const closeLabel = computed(() => {
  if(props.subject!=='model')return 'Close settings'
  const snapshot=props.state?.snapshot,editor=snapshot?.editor
  if(snapshot?.dismissible===false)return 'Close'
  if(snapshot?.refreshPending)return 'Cancel model change'
  if(editor?.kind==='form'||editor?.kind==='choice'&&editor.consent)return editor.consent?.cancelLabel||'Cancel'
  return 'Close model selection'
})
const emit = defineEmits<{ operate: [action: ClaudeSettingsOperation]; close: [] }>()
const search = ref(''), searchInput = ref<HTMLInputElement>(), drafts = ref<Record<string, string>>({})
const frame = computed(() => props.state?.snapshot?.frame)
const activeTab = computed(() => frame.value?.selectedTab ?? 'Config')
function number(value: number) { return new Intl.NumberFormat().format(value) }
function money(value: number) { return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value) }
function operate(action: {kind:'tab';tab:'Status'|'Config'|'Usage'|'Stats'} | {kind:'stats';action:'Overview'|'Models'|'cycleDates'|'copy'}) {
  if (!pending.value && props.state?.snapshot) emit('operate', {...action,revision:props.state.snapshot.revision})
}
const liveForm=useNativeSettingsForm(()=>props.state,action=>emit('operate',action))
const pending = computed(() => props.state?.status === 'pending' || props.state?.snapshot?.commitPending === true || liveForm.busy.value)
const editorPending=computed(()=>pending.value&&!liveForm.editing.value)
const rows = computed(() => (props.state?.snapshot?.rows ?? []).filter(row => `${row.label} ${row.description ?? ''} ${row.key}`.toLowerCase().includes(search.value.toLowerCase())))
function openEditor(key: string) {
  if (!pending.value && props.state?.snapshot) emit('operate',{kind:'open',revision:props.state.snapshot.revision,key})
}
function editorCommand(command: Extract<ClaudeSettingsOperation,{kind:'editor'}>['command']) {
  if(liveForm.handle(command))return
  const snapshot=props.state?.snapshot
  if (snapshot?.editor && (!pending.value || command.action === 'cancel')) emit('operate',{kind:'editor',revision:snapshot.revision,editorRevision:snapshot.editor.revision,command})
}
function closePanel() {
  if(props.state?.snapshot?.dismissible===false)return
  if (props.subject === 'model' && props.state?.snapshot?.editor) editorCommand({action:'cancel'})
  else emit('close')
}
function handleKeydown(event: KeyboardEvent) {
  if(event.key!=='Escape'||event.isComposing||event.keyCode===229)return
  event.preventDefault();event.stopPropagation()
  if(props.state?.snapshot?.dismissible===false)return
  if(props.state?.snapshot?.editor)editorCommand({action:'cancel'})
  else emit('close')
}
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
let refreshTimer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.state?.status,activeTab.value,frame.value?.stats?.loading,frame.value?.stats?.copyState,props.state?.snapshot?.commitPending,props.state?.snapshot?.refreshPending,liveForm.busy.value] as const, ([status,tab,loading,copyState,commitPending,refreshPending,liveBusy]) => {
  clearTimeout(refreshTimer)
  if (!liveBusy && status === 'ready' && (refreshPending || commitPending || tab === 'Stats' && (loading || copyState && copyState !== 'idle'))) refreshTimer = setTimeout(() => emit('operate',{kind:'read'}),250)
}, { immediate: true })
onUnmounted(() => clearTimeout(refreshTimer))
watch(() => props.state?.savedKey, key => { if (key) delete drafts.value[key] })
onMounted(() => { searchInput.value?.focus(); emit('operate', {kind:'read'}) })
</script>
