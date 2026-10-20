<template>
  <div class="w-full max-w-2xl">
    <div class="overflow-hidden rounded-xl border border-white/[0.06] bg-transparent animate-fade-in">
      <!-- Header -->
      <div class="flex items-center gap-2.5 px-4 py-3">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-neutral-400"><Wrench :size="15" class="text-neutral-400" /></span>
        <h3 class="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200" title="Claude Code session">Claude Code</h3>
        <button
          v-if="content.sessionId"
          @click="openConversation"
          class="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
          title="Open conversation"
        >
          <MessageSquare :size="12" />
        </button>

        <span class="flex shrink-0 items-center gap-1.5 px-1 py-0.5">
          <span class="relative inline-block w-2 h-2" :title="content.chatState">
            <span
              :class="[
                'block w-2 h-2 rounded-full transition-colors duration-300',
                stateConfig?.busy ? 'mosaic-dot' : ''
              ]"
              :style="!stateConfig?.busy ? { backgroundColor: stateConfig?.color ?? '#6B7280' } : undefined"
            />
            <span
              v-if="stateConfig?.busy"
              class="absolute inset-0 rounded-full scale-[2] mosaic-glow"
            />
          </span>
          <span class="text-xs text-neutral-400 capitalize">{{ stateConfig?.label ?? content.chatState }}</span>
        </span>
      </div>

      <!-- Session error banner -->
      <div
        v-if="content.sessionError"
        class="px-3 py-2 bg-red-950/40 border-b border-red-900/50 text-xs text-red-300"
      >
        {{ content.sessionError }}
      </div>

      <!-- Goal status -->
      <div
        v-if="content.goal"
        class="flex items-center gap-2 px-3 py-2 border-b border-neutral-800"
      >
        <span class="relative inline-block w-2 h-2">
          <span
            :class="[
              'block w-2 h-2 rounded-full transition-colors duration-300',
              content.goal.status === 'active' ? 'mosaic-dot' : '',
            ]"
            :style="
              content.goal.status === 'met' ? { backgroundColor: '#22c55e' } :
              content.goal.status === 'failed' ? { backgroundColor: '#ef4444' } :
              content.goal.status === 'active' ? undefined : { backgroundColor: '#6B7280' }
            "
          />
          <span
            v-if="content.goal.status === 'active'"
            class="absolute inset-0 rounded-full scale-[2] mosaic-glow"
          />
        </span>
        <span class="text-xs text-neutral-300 truncate flex-1" :title="content.goal.condition">
          {{ content.goal.condition }}
        </span>
        <span class="text-[10px] text-neutral-500 tabular-nums">
          {{ content.goal.iterations }}/20
        </span>
        <button
          v-if="content.goal.status === 'active'"
          @click="clearGoal"
          class="text-neutral-500 hover:text-neutral-300 transition-colors text-xs"
        >Clear</button>
      </div>

      <!-- Keep diagnostics available without dominating the conversation. -->
      <details class="group border-t border-white/[0.06] text-xs">
        <summary class="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-neutral-400 transition-colors hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-blue-400 [&::-webkit-details-marker]:hidden">
          <span class="min-w-0 flex-1 truncate font-medium text-neutral-300">{{ content.model || 'Model unavailable' }}</span>
          <span class="tabular-nums">{{ content.turns ?? 0 }} turns</span>
          <span class="tabular-nums">${{ (content.totalCostUsd ?? 0).toFixed(3) }}</span>
          <span class="text-neutral-500 group-open:text-neutral-300">Details <span aria-hidden="true" class="inline-block transition-transform group-open:rotate-180">⌄</span></span>
        </summary>
      <div class="px-4 pb-4 pt-2 space-y-4 text-xs">
        <div class="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
          <span class="text-neutral-500">Model</span>
          <span class="text-neutral-100 font-medium truncate">{{ content.model || '—' }}</span>

          <span class="text-neutral-500">Session</span>
          <div class="flex items-center gap-2">
            <span class="text-neutral-200 font-mono truncate flex-1">
              {{ truncatedSessionId || '—' }}
            </span>
            <button
              v-if="content.sessionId"
              @click="copySessionId"
              class="text-neutral-500 hover:text-neutral-300 transition-colors"
              :title="copied ? 'Copied!' : 'Copy session id'"
            >
              <Check v-if="copied" :size="12" class="text-green-500" />
              <Copy v-else :size="12" />
            </button>
          </div>

          <span class="text-neutral-500">Workspace</span>
          <span class="text-neutral-200 font-mono truncate" :title="content.cwd">
            {{ shortenCwd(content.cwd) || '—' }}
          </span>

          <template v-if="content.additionalDirs?.length">
            <span class="text-neutral-500">Dirs</span>
            <details class="text-neutral-200 min-w-0">
              <summary class="cursor-pointer text-neutral-300 hover:text-neutral-200 select-none">
                {{ content.additionalDirs.length }} additional
              </summary>
              <div
                v-for="dir in content.additionalDirs"
                :key="dir"
                class="font-mono truncate text-neutral-400 mt-0.5"
                :title="dir"
              >
                {{ shortenCwd(dir) }}
              </div>
            </details>
          </template>

          <span class="text-neutral-500">Turns</span>
          <span class="text-neutral-200 tabular-nums">{{ content.turns ?? 0 }}</span>

          <span class="text-neutral-500">Tools</span>
          <span class="text-neutral-200 tabular-nums">{{ content.toolCallCount ?? 0 }}</span>

          <span class="text-neutral-500">Cost</span>
          <span class="text-neutral-200 tabular-nums">${{ (content.totalCostUsd ?? 0).toFixed(3) }}</span>
        </div>

        <!-- Context usage breakdown (from CLI /context query) -->
        <details v-if="ctx" class="pt-4 mt-4 border-t border-white/[0.06] text-neutral-400">
          <summary class="text-[10px] uppercase tracking-wide cursor-pointer select-none hover:text-neutral-400 [&::marker]:mr-1">
            &nbsp;Context
            <span class="float-right text-xs tabular-nums normal-case tracking-normal" :class="ctx.percentage >= 90 ? 'text-red-400' : ctx.percentage >= 75 ? 'text-yellow-400' : 'text-neutral-400'">{{ ctx.percentage }}%</span>
          </summary>
          <div class="mt-2 px-3">
            <div class="flex items-baseline justify-between mb-1.5">
              <span class="text-xs text-neutral-500 font-mono">{{ ctx.model || '—' }}</span>
            </div>

            <!-- Stacked progress bar -->
            <div class="h-2 bg-neutral-800 rounded-full overflow-hidden flex">
              <div
                v-for="cat in visibleCategories"
                :key="'bar-' + cat.name"
                class="h-full first:rounded-l-full last:rounded-r-full transition-all duration-300"
                :class="getCategoryColor(cat.name)"
                :style="{ width: `${cat.percentage}%` }"
              />
            </div>
            <div class="flex justify-between mt-1.5 text-[11px] tabular-nums text-neutral-500">
              <span>{{ fmt(ctx.totalTokens) }} used</span>
              <span>{{ fmt(ctx.maxTokens) }} limit</span>
            </div>

            <!-- Category breakdown -->
            <div class="mt-3 space-y-2">
              <p class="text-[10px] uppercase tracking-wide text-neutral-500">Breakdown</p>
              <div
                v-for="cat in visibleCategories"
                :key="cat.name"
                class="space-y-0.5"
              >
                <div class="flex items-baseline justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-sm shrink-0" :class="getCategoryColor(cat.name)" />
                    <span class="text-xs text-neutral-300">{{ cat.name }}</span>
                  </div>
                  <div class="flex items-baseline gap-3">
                    <span class="text-xs tabular-nums text-neutral-400">{{ fmt(cat.tokens) }}</span>
                    <span class="text-[11px] tabular-nums text-neutral-600 w-10 text-right">{{ cat.percentage.toFixed(1) }}%</span>
                  </div>
                </div>
                <div class="h-1 bg-neutral-800 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    :class="getCategoryColor(cat.name)"
                    :style="{ width: barWidth(cat.percentage) }"
                  />
                </div>
              </div>
            </div>
          </div>
        </details>

        <!-- Recent tools (last 3, collapsible) -->
        <details v-if="recentTools.length" class="pt-4 mt-4 border-t border-white/[0.06] text-neutral-400">
          <summary class="text-[10px] uppercase tracking-wide cursor-pointer select-none hover:text-neutral-400 [&::marker]:mr-1">&nbsp;Recent</summary>
          <div class="mt-1 px-3">
            <div
              v-for="(tool, i) in recentTools"
              :key="i"
              class="text-neutral-300 truncate mt-0.5"
            >
              <span class="font-mono text-xs">{{ tool.name }}</span>
              <span v-if="tool.summary" class="text-neutral-500 text-xs"> · {{ tool.summary }}</span>
              <span class="text-neutral-600 text-[10px]"> · {{ relativeTime(tool.at) }}</span>
            </div>
          </div>
        </details>

        <!-- Selection follows the acknowledged native mode. -->
        <div class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Permission</span>
            <span class="text-[10px] text-neutral-600">{{ permissionDescription }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              v-for="opt in permissionOptions"
              :key="opt.value"
              type="button"
              @click="selectPermissionMode(opt.value)"
              :disabled="!!permissionChange?.call"
              :aria-pressed="permissionMode === opt.value"
              :title="opt.tooltip"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700 last:border-r-0 disabled:opacity-50 disabled:cursor-wait',
                permissionMode === opt.value
                  ? (opt.value === 'bypassPermissions'
                    ? 'bg-yellow-600 text-yellow-50'
                    : 'bg-neutral-700 text-neutral-100')
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >
              {{ opt.label }}
            </button>
          </div>
          <p v-if="permissionChange?.call" role="status" class="mt-1.5 text-xs text-neutral-400">Waiting for Claude…</p>
          <p v-else-if="permissionChange?.reason" role="alert" class="mt-1.5 text-xs text-amber-300 break-words">{{ permissionChange.reason }}</p>
        </div>

        <!-- Worktree toggle -->
        <div class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Worktree</span>
            <span class="text-[10px] text-neutral-600">{{ useWorktree ? 'Isolated file mutations' : 'Direct edits' }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              v-for="opt in [{ value: false, label: 'Off' }, { value: true, label: 'On' }]"
              :key="String(opt.value)"
              type="button"
              @click="selectWorktree(opt.value)"
              :title="opt.value ? 'Run in a git worktree (isolated)' : 'Edit files directly'"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700 last:border-r-0',
                useWorktree === opt.value
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
      </div>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Wrench, Copy, Check, MessageSquare } from 'lucide-vue-next'
import type { ArtifactItem } from '@apackdev/sdk/artifacts'
import { useSurfaceState } from '#generated/fe.ts'
import { openSurface } from '#generated/fe.ts'
import { sendToSystem, sendToSurface } from '#generated/events.ts'


type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'auto'

interface ContextCategory {
  name: string
  tokens: number
  percentage: number
}

interface ContextUsageData {
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  categories: ContextCategory[]
  memoryFiles?: Array<{ type: string; path: string; tokens: number }>
  skills?: Array<{ name: string; source: string; tokens: number }>
}

interface SessionContent {
  sessionId: string
  model: string
  cwd: string
  startedAt: number
  lastTurnAt: number
  turns: number
  totalCostUsd: number
  chatState: 'idle' | 'working' | 'paused' | 'error'
  toolCallCount: number
  recentTools?: Array<{ name: string; summary: string; at: number }>
  permissionMode?: PermissionMode
  useWorktree?: boolean
  sessionError?: string
  contextUsage?: ContextUsageData
  additionalDirs?: string[]
  goal?: {
    condition: string
    setAt: number
    status: 'active' | 'met' | 'failed'
    iterations: number
    prevPermissionMode?: PermissionMode
  }
}

const props = defineProps<{
  artifact: ArtifactItem<SessionContent>
}>()

const currentThread = useSurfaceState('threads', (s) => s.currentThread)
const currentThreadId = computed(() => currentThread.value?.id as string | undefined)

// The thread context is the source of truth for session data.
const content = computed<SessionContent>(() =>
  (currentThread.value?.context?.claudeCode ?? {}) as SessionContent
)

const recentTools = computed(() => content.value?.recentTools ?? [])

// Context usage — prefer full contextUsage data from CLI /context query
const ctx = computed(() => content.value?.contextUsage ?? null)

const visibleCategories = computed(() =>
  ctx.value?.categories.filter((c: ContextCategory) => c.name !== 'Free space' && c.name !== 'Autocompact buffer') ?? []
)


const CATEGORY_COLORS: Record<string, string> = {
  'System prompt': 'bg-neutral-500',
  'System tools': 'bg-blue-500',
  'MCP tools': 'bg-cyan-500',
  'Memory files': 'bg-orange-500',
  'Skills': 'bg-yellow-500',
  'Messages': 'bg-purple-500',
  'Custom Agents': 'bg-emerald-500',
}

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS[name] ?? 'bg-neutral-500'
}

function barWidth(pct: number): string {
  if (pct <= 0) return '0%'
  return `${Math.max(pct, 0.5)}%`
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const settings = useSurfaceState('threads', (s) => s.settings)
const overrides = useSurfaceState('threads', (s) => s.chatStateOverrides)
const stateConfig = computed(() => {
  const configs = settings.value?.chatStates;
  const threadId = currentThreadId.value ?? '';
  const override = overrides.value?.[threadId];
  const activeId = (override && override.expiresAt > Date.now()) ? override.id : content.value.chatState;
  return configs?.find((c: any) => c.id === activeId);
});

const truncatedSessionId = computed(() => {
  const id = content.value.sessionId
  if (!id) return ''
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}…${id.slice(-6)}`
})

function shortenCwd(cwd: string): string {
  if (!cwd) return ''
  // Show at most the last 3 path segments so the card stays compact.
  const segments = cwd.split('/').filter(Boolean)
  if (segments.length <= 3) return cwd
  return `…/${segments.slice(-3).join('/')}`
}

function relativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs
  if (delta < 5_000) return 'just now'
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

const copied = ref(false)
async function copySessionId() {
  try {
    await navigator.clipboard.writeText(content.value.sessionId)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* clipboard denied */ }
}

function openConversation() {
  const threadId = currentThreadId.value
  if (threadId) openSurface('threads', { type: 'OPEN_THREAD_CHAT', threadId })
}

// ─── Permission mode segmented control ─────────────────────────────────
// The three modes surfaced in the UI (other PermissionMode variants exist
// but aren't useful for interactive work-mode chats). Takes effect on the
// NEXT turn — chat.ts reads content.permissionMode at action entry.
const permissionOptions: Array<{
  value: PermissionMode
  label: string
  tooltip: string
  description: string
}> = [
  {
    value: 'default',
    label: 'Ask',
    tooltip: 'Approve every edit (safe default)',
    description: 'Approves each edit individually',
  },
  {
    value: 'acceptEdits',
    label: 'Auto',
    tooltip: 'Auto-accept file edits; still prompt for Bash',
    description: 'Auto-accepts file edits',
  },
  {
    value: 'bypassPermissions',
    label: 'Bypass',
    tooltip: 'Skip all permission prompts (edits + bash)',
    description: 'Bypasses all permissions',
  },
]

const permissionMode = computed<PermissionMode>(
  () => content.value?.permissionMode ?? 'default',
)

const permissionDescription = computed(
  () => permissionOptions.find(o => o.value === permissionMode.value)?.description ?? '',
)

const permissionChanges = usePluginState('threads', s => s.permissionModeChanges)
const permissionChange = computed(() => permissionChanges.value[currentThreadId.value ?? ''])

function selectPermissionMode(mode: PermissionMode) {
  if (mode === permissionMode.value) return
  const threadId = currentThreadId.value
  if (!threadId) {
    console.warn('[claude-session-artifact] no current thread; cannot update permission mode')
    return
  }
  sendToPlugin('threads', { type: 'SET_CLAUDE_PERMISSION_MODE', threadId, mode })
}

function clearGoal() {
  const threadId = currentThreadId.value
  if (!threadId) return
  sendToSystem('threads', {
    type: 'FORWARD_BRAIN_EVENT',
    eventType: 'user.goal.clear',
    payload: { threadId },
  })
}

const useWorktree = computed(() => content.value?.useWorktree ?? false)

function selectWorktree(value: boolean) {
  if (value === useWorktree.value) return
  const threadId = currentThreadId.value
  if (!threadId) return
  sendToSystem('threads', {
    type: 'FORWARD_BRAIN_EVENT',
    eventType: 'user.update.worktree',
    payload: { threadId, useWorktree: value },
  })
}
</script>
