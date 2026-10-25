<template>
  <section aria-label="Claude Code statistics" class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <button v-for="view in views" :key="view" type="button" :disabled="pending || !stats?.data" :aria-pressed="stats?.view === view" class="rounded-lg px-3 py-2 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40" :class="stats?.view === view ? 'bg-white/10' : ''" @click="emit('action',view)">{{ view }}</button>
      <button type="button" :disabled="pending || !stats?.data || stats.loading" class="ml-auto rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('action','cycleDates')">{{ rangeLabel }} · Change dates</button>
      <button type="button" :disabled="pending || !stats?.data || stats.loading || stats.copyState === 'pending'" class="rounded-lg border border-white/10 px-3 py-2 text-xs text-neutral-300 disabled:opacity-40" @click="emit('action','copy')">Copy stats</button>
    </div>
    <p v-if="stats?.copyState && stats.copyState !== 'idle'" :role="stats.copyState === 'error' ? 'alert' : 'status'" class="text-xs text-neutral-400">{{ stats.copyState === 'pending' ? 'Copying stats…' : stats.copyState === 'saved' ? 'Copied by Claude Code' : 'Claude Code could not copy stats' }}</p>
    <p v-if="stats?.problem" role="alert" class="text-sm text-amber-200">{{ stats.problem }}</p>
    <p v-else-if="!stats?.data" role="status" class="text-sm text-neutral-400">{{ stats?.outcome === 'empty' ? 'No stats available yet. Start using Claude Code.' : 'Claude Code has not provided Stats data.' }}</p>
    <template v-else>
      <p v-if="stats.loading" role="status" class="text-xs text-neutral-400">Updating dates…</p>
      <dl class="grid grid-cols-2 gap-3 text-xs">
        <div class="rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">Total tokens</dt><dd class="mt-2 text-lg text-neutral-200">{{ number(totalTokens) }}</dd></div>
        <div v-if="models.length" class="min-w-0 rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">Favorite model</dt><dd class="mt-2 break-words text-sm text-neutral-200">{{ models[0].name }}</dd></div>
      </dl>
      <template v-if="stats.view === 'Overview'">
        <dl class="grid grid-cols-2 gap-3 text-xs">
          <div v-for="metric in metrics" :key="metric.label" class="rounded-lg border border-white/10 p-3"><dt class="text-neutral-500">{{ metric.label }}</dt><dd class="mt-2 text-lg text-neutral-200">{{ metric.value }}</dd></div>
        </dl>
        <p v-if="stats.insight" class="rounded-lg bg-white/5 p-3 text-sm leading-relaxed text-neutral-300">{{ stats.insight }}</p>
        <details v-if="stats.data.longestSession" class="rounded-lg border border-white/10 p-3 text-xs text-neutral-400">
          <summary class="cursor-pointer text-neutral-300">Longest session details</summary>
          <dl class="mt-3 space-y-2"><div><dt class="text-neutral-500">Session</dt><dd class="break-all">{{ stats.data.longestSession.sessionId }}</dd></div><div><dt class="text-neutral-500">Started</dt><dd>{{ stats.data.longestSession.timestamp }}</dd></div><div><dt class="text-neutral-500">Messages</dt><dd>{{ number(stats.data.longestSession.messageCount) }}</dd></div></dl>
        </details>
        <div v-if="stats.data.allTimeActivity?.length" class="space-y-3">
          <h3 class="text-xs font-medium text-neutral-300">All-time activity</h3>
          <pre v-if="stats.calendar" aria-label="Claude Code activity calendar" tabindex="0" class="overflow-x-auto rounded-lg border border-white/10 p-2 font-mono text-xs leading-[14px] text-orange-300 min-[800px]:p-3 min-[800px]:leading-5">{{ stats.calendar }}</pre>
          <details class="rounded-lg border border-white/10 p-3 text-xs text-neutral-400"><summary class="cursor-pointer text-neutral-300">Activity dates and counts</summary><div class="mt-3 overflow-x-auto"><table class="w-full text-left"><thead><tr><th class="py-2 pr-3">Date</th><th class="pr-3">Sessions</th><th class="pr-3">Messages</th><th>Tools</th></tr></thead><tbody><tr v-for="day in stats.data.allTimeActivity" :key="day.date" class="border-t border-white/5"><th class="py-2 pr-3 font-normal">{{ day.date }}</th><td>{{ number(day.sessionCount) }}</td><td>{{ number(day.messageCount) }}</td><td>{{ number(day.toolCallCount) }}</td></tr></tbody></table></div></details>
        </div>
        <h3 class="text-xs font-medium text-neutral-300">{{ rangeLabel }} activity</h3>
        <div class="overflow-x-auto rounded-lg border border-white/10"><table class="w-full text-left text-xs text-neutral-300"><thead class="bg-white/5 text-neutral-500"><tr><th class="p-3">Date</th><th class="p-3">Sessions</th><th class="p-3">Messages</th><th class="p-3">Tools</th></tr></thead><tbody><tr v-for="day in stats.data.dailyActivity" :key="day.date" class="border-t border-white/5"><th class="p-3 font-normal">{{ day.date }}</th><td class="p-3">{{ number(day.sessionCount) }}</td><td class="p-3">{{ number(day.messageCount) }}</td><td class="p-3">{{ number(day.toolCallCount) }}</td></tr></tbody></table></div>
      </template>
      <template v-else>
        <div v-if="stats.data.dailyModelTokens?.length" class="space-y-3">
          <h3 class="text-xs font-medium text-neutral-300">Tokens per recorded day</h3>
          <ul class="space-y-3 text-xs text-neutral-400"><li v-for="day in stats.data.dailyModelTokens" :key="day.date"><div class="mb-1 flex justify-between gap-2"><span>{{ day.date }}</span><span>{{ number(dayTokens(day.tokensByModel)) }}</span></div><div class="flex h-3 overflow-hidden rounded bg-white/5"><span v-for="(tokens,model) in day.tokensByModel" :key="model" :title="`${model}: ${number(tokens)} tokens`" :aria-label="`${model}: ${number(tokens)} tokens`" :class="modelColor(String(model))" :style="{width:`${tokens / maxDayTokens * 100}%`}" /></div></li></ul>
          <ul aria-label="Model token legend" class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-neutral-400"><li v-for="model in models" :key="model.name" class="flex min-w-0 items-center gap-2"><span class="size-2 shrink-0 rounded-sm" :class="modelColor(model.name)" /><span class="break-all">{{ model.name }}</span></li></ul>
        </div>
        <div class="overflow-x-auto rounded-lg border border-white/10"><table class="w-full text-left text-xs text-neutral-300"><thead class="bg-white/5 text-neutral-500"><tr><th class="p-3">Model</th><th class="p-3">Input</th><th class="p-3">Output</th><th class="p-3">Cache read</th><th class="p-3">Cache write</th><th class="p-3">Cost</th></tr></thead><tbody><tr v-for="model in models" :key="model.name" class="border-t border-white/5"><th class="p-3 font-normal">{{ model.name }}</th><td class="p-3">{{ number(model.usage.inputTokens) }}</td><td class="p-3">{{ number(model.usage.outputTokens) }}</td><td class="p-3">{{ number(model.usage.cacheReadInputTokens) }}</td><td class="p-3">{{ number(model.usage.cacheCreationInputTokens) }}</td><td class="p-3">{{ money(model.usage.costUSD) }}</td></tr></tbody></table></div>
      </template>
      <p v-if="stats.data.firstSessionDate || stats.data.lastSessionDate" class="text-xs text-neutral-500">Recorded sessions: {{ stats.data.firstSessionDate ?? 'Unknown start' }} — {{ stats.data.lastSessionDate ?? 'Unknown end' }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ClaudeSettingsStats, ClaudeSettingsOperation } from '#features/code/common/native-settings.ts'
const props = defineProps<{ stats?: ClaudeSettingsStats; pending: boolean }>()
const emit = defineEmits<{ action: [action: Extract<ClaudeSettingsOperation,{kind:'stats'}>['action']] }>()
const views = ['Overview','Models'] as const
const rangeLabel = computed(() => ({all:'All time','7d':'Last 7 days','30d':'Last 30 days'}[props.stats?.range ?? 'all']))
const models = computed(() => Object.entries(props.stats?.data?.modelUsage ?? {}).map(([name,usage]) => ({name,usage,tokens:usage.inputTokens+usage.outputTokens+usage.cacheReadInputTokens+usage.cacheCreationInputTokens})).sort((a,b)=>b.tokens-a.tokens))
const totalTokens = computed(() => models.value.reduce((sum,model)=>sum+model.tokens,0))
function dayTokens(tokens: Record<string,number>) { return Object.values(tokens).reduce((sum,value)=>sum+value,0) }
const maxDayTokens = computed(() => Math.max(1,...(props.stats?.data?.dailyModelTokens ?? []).map(day=>dayTokens(day.tokensByModel))))
const colors = ['bg-blue-400','bg-emerald-400','bg-violet-400','bg-amber-400','bg-rose-400','bg-cyan-400']
function modelColor(model: string) { return colors[Math.max(0,models.value.findIndex(row=>row.name===model))%colors.length] }
function number(value: number) { return new Intl.NumberFormat().format(value) }
function money(value: number) { return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:4}).format(value) }
const metrics = computed(() => {
  const data=props.stats?.data
  if(!data)return []
  const rows=[{label:'Sessions',value:number(data.totalSessions)},{label:'Messages',value:number(data.totalMessages)},{label:'Active days',value:number(data.activeDays)},{label:'Total days',value:number(data.totalDays)}]
  if(data.streaks)rows.push({label:'Current streak',value:`${number(data.streaks.currentStreak)} ${data.streaks.currentStreak === 1 ? 'day' : 'days'}`},{label:'Longest streak',value:`${number(data.streaks.longestStreak)} ${data.streaks.longestStreak === 1 ? 'day' : 'days'}`})
  if(data.longestSession)rows.push({label:'Longest session',value:`${Math.floor(data.longestSession.duration/60000)}m ${Math.floor(data.longestSession.duration%60000/1000)}s`})
  if(data.peakActivityHour!==undefined&&data.peakActivityHour!==null)rows.push({label:'Peak hour',value:`${data.peakActivityHour}:00–${data.peakActivityHour+1}:00`})
  if(data.peakActivityDay)rows.push({label:'Peak activity day',value:data.peakActivityDay})
  return rows
})
</script>
