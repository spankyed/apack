<template>
  <section role="dialog" aria-label="Claude Code settings" class="mx-4 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#191919]" @keydown.esc.stop.prevent="emit('close')">
    <header class="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div class="min-w-0"><p v-if="ownerLabel" class="mb-1 break-words text-xs text-neutral-400">{{ ownerLabel }}</p><h2 class="text-sm font-medium text-neutral-200">Claude Code settings</h2><p class="mt-1 text-xs text-neutral-500">Changes are validated and saved by Claude Code.</p></div>
      <button type="button" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 focus-visible:outline focus-visible:outline-blue-400" @click="emit('close')">Close settings</button>
    </header>
    <nav v-if="frame && !frame.hidden" aria-label="Claude Code settings tabs" class="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
      <button v-for="tab in frame.tabs" :key="tab" type="button" :aria-current="activeTab === tab ? 'page' : undefined" :disabled="pending" class="rounded-lg px-3 py-2 text-xs text-neutral-400 hover:bg-white/5 disabled:opacity-40" :class="activeTab === tab ? 'bg-white/10 text-white' : ''" @click="operate({kind:'tab',tab})">{{ tab }}</button>
    </nav>
    <template v-if="activeTab === 'Config'">
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
    </template>
    <div v-else class="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" :aria-label="`Claude Code ${activeTab}`" tabindex="0">
      <template v-if="activeTab === 'Status'">
        <dl v-for="(group, index) in frame?.status" :key="index" class="mb-4 divide-y divide-white/5 rounded-lg border border-white/10 px-3">
          <div v-for="(row, rowIndex) in group" :key="rowIndex" class="grid grid-cols-[minmax(100px,1fr)_minmax(0,2fr)] gap-3 py-3 text-xs">
            <dt class="text-neutral-500">{{ row.label }}</dt><dd class="whitespace-pre-wrap break-words text-neutral-200">{{ row.value }}</dd>
          </div>
        </dl>
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
      <template v-else-if="activeTab === 'Stats'">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <button v-for="view in statsViews" :key="view" type="button" :disabled="pending || !frame?.stats?.data" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" :class="frame?.stats?.view === view ? 'bg-white/10' : ''" @click="operate({kind:'stats',action:view})">{{ view }}</button>
          <button type="button" :disabled="pending || !frame?.stats?.data || frame.stats.loading" class="ml-auto rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="operate({kind:'stats',action:'cycleDates'})">{{ rangeLabel }} · Change dates</button>
        </div>
        <p v-if="frame?.stats?.problem" role="alert" class="text-sm text-amber-200">{{ frame.stats.problem }}</p>
        <p v-else-if="!frame?.stats?.data" role="status" class="text-sm text-neutral-400">{{ frame?.stats?.outcome === 'empty' ? 'No stats available yet. Start using Claude Code.' : 'Claude Code has not provided Stats data.' }}</p>
        <template v-else>
          <p v-if="frame.stats.loading" role="status" class="mb-3 text-xs text-neutral-400">Updating dates…</p>
          <dl v-if="frame.stats.view === 'Overview'" class="mb-4 grid grid-cols-2 gap-3 text-xs">
            <div v-for="metric in statsMetrics" :key="metric.label" class="rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">{{ metric.label }}</dt><dd class="mt-2 text-lg text-neutral-200">{{ number(metric.value) }}</dd></div>
          </dl>
          <div class="overflow-x-auto rounded-lg border border-white/10">
            <table v-if="frame.stats.view === 'Models'" class="w-full text-left text-xs text-neutral-300"><thead class="bg-white/5 text-neutral-500"><tr><th class="p-3">Model</th><th class="p-3">Input</th><th class="p-3">Output</th><th class="p-3">Cache read</th><th class="p-3">Cache write</th><th class="p-3">Cost</th></tr></thead><tbody><tr v-for="(usage, model) in frame.stats.data.modelUsage" :key="model" class="border-t border-white/5"><th class="p-3 font-normal">{{ model }}</th><td class="p-3">{{ number(usage.inputTokens) }}</td><td class="p-3">{{ number(usage.outputTokens) }}</td><td class="p-3">{{ number(usage.cacheReadInputTokens) }}</td><td class="p-3">{{ number(usage.cacheCreationInputTokens) }}</td><td class="p-3">{{ money(usage.costUSD) }}</td></tr></tbody></table>
            <table v-else class="w-full text-left text-xs text-neutral-300"><thead class="bg-white/5 text-neutral-500"><tr><th class="p-3">Date</th><th class="p-3">Sessions</th><th class="p-3">Messages</th><th class="p-3">Tools</th></tr></thead><tbody><tr v-for="day in frame.stats.data.dailyActivity" :key="day.date" class="border-t border-white/5"><th class="p-3 font-normal">{{ day.date }}</th><td class="p-3">{{ number(day.sessionCount) }}</td><td class="p-3">{{ number(day.messageCount) }}</td><td class="p-3">{{ number(day.toolCallCount) }}</td></tr></tbody></table>
          </div>
        </template>
      </template>
    </div>
    <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-xs">
      <p v-if="state?.problem" role="alert" class="min-w-0 flex-1 break-words text-amber-200">{{ state.problem }}</p>
      <p v-else role="status" class="text-neutral-400">{{ pending ? 'Waiting for Claude Code…' : state?.savedKey ? 'Saved by Claude Code' : activeTab === 'Config' ? `${rows.length} settings` : activeTab }}</p>
      <button type="button" :disabled="pending" class="rounded-lg px-3 py-2 text-neutral-300 hover:bg-white/5 disabled:opacity-40" @click="emit('operate', { kind: 'read' })">Refresh</button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ClaudeSettingsOperation, ClaudeSettingsView, ClaudeSettingValue } from '#features/code/common/native-settings.ts'
const props = defineProps<{ state?: ClaudeSettingsView; ownerLabel?: string }>()
const emit = defineEmits<{ operate: [action: ClaudeSettingsOperation]; close: [] }>()
const search = ref(''), searchInput = ref<HTMLInputElement>(), drafts = ref<Record<string, string>>({})
const frame = computed(() => props.state?.snapshot?.frame)
const activeTab = computed(() => frame.value?.selectedTab ?? 'Config')
const statsViews = ['Overview', 'Models'] as const
const rangeLabel = computed(() => ({all:'All time','7d':'Last 7 days','30d':'Last 30 days'}[frame.value?.stats?.range ?? 'all']))
const statsMetrics = computed(() => { const data = frame.value?.stats?.data; return data ? [{label:'Sessions',value:data.totalSessions},{label:'Messages',value:data.totalMessages},{label:'Active days',value:data.activeDays},{label:'Total days',value:data.totalDays}] : [] })
function number(value: number) { return new Intl.NumberFormat().format(value) }
function money(value: number) { return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value) }
function operate(action: {kind:'tab';tab:'Status'|'Config'|'Usage'|'Stats'} | {kind:'stats';action:'Overview'|'Models'|'cycleDates'}) {
  if (!pending.value && props.state?.snapshot) emit('operate', {...action,revision:props.state.snapshot.revision})
}
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
let refreshTimer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.state?.status,frame.value?.stats?.loading] as const, ([status,loading]) => {
  clearTimeout(refreshTimer)
  if (status === 'ready' && loading) refreshTimer = setTimeout(() => emit('operate',{kind:'read'}),250)
})
onUnmounted(() => clearTimeout(refreshTimer))
watch(() => props.state?.savedKey, key => { if (key) delete drafts.value[key] })
onMounted(() => { searchInput.value?.focus(); emit('operate', {kind:'read'}) })
</script>
