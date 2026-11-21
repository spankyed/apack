<template>
  <div class="max-w-2xl">
    <div class="rounded-md bg-neutral-850 border border-neutral-800 animate-fade-in">
      <div class="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
        <Bot :size="14" class="text-neutral-400" />
        <h3 class="text-sm font-medium text-neutral-200">Codex session</h3>
        <button
          v-if="content.threadId"
          @click="openTerminalTab"
          class="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
          title="Open in terminal"
        >
          <Terminal :size="12" />
        </button>
        <span class="flex-1" />
        <span class="flex items-center gap-1.5">
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
          <span class="text-xs text-neutral-400 capitalize">{{ stateConfig?.label ?? content.chatState ?? 'idle' }}</span>
        </span>
      </div>

      <div
        v-if="content.sessionError"
        class="px-3 py-2 bg-red-950/40 border-b border-red-900/50 text-xs text-red-300"
      >
        {{ content.sessionError }}
      </div>

      <div class="px-3 py-3 space-y-2 text-xs">
        <div class="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2">
          <span class="text-neutral-500">Model</span>
          <span class="text-neutral-200 font-mono truncate">{{ content.model || '-' }}</span>

          <span class="text-neutral-500">Thread</span>
          <div class="flex items-center gap-2">
            <span
              class="text-neutral-200 font-mono truncate flex-1"
              :class="content.threadId ? 'cursor-pointer hover:text-neutral-100' : ''"
              :title="copied ? 'Copied!' : content.threadId ? 'Click to copy' : ''"
              @click="copyThreadId"
            >
              {{ truncatedThreadId || '-' }}
            </span>
            <button
              v-if="content.threadId"
              @click="copyThreadId"
              class="text-neutral-500 hover:text-neutral-300 transition-colors"
              :title="copied ? 'Copied!' : 'Copy thread id'"
            >
              <Check v-if="copied" :size="12" class="text-green-500" />
              <Copy v-else :size="12" />
            </button>
          </div>

          <span class="text-neutral-500">Turn</span>
          <span class="text-neutral-200 font-mono truncate">{{ truncatedTurnId || '-' }}</span>

          <span class="text-neutral-500">CWD</span>
          <span class="text-neutral-200 font-mono truncate" :title="content.cwd">
            {{ shortenCwd(content.cwd) || '-' }}
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

          <span class="text-neutral-500">Tokens</span>
          <span class="text-neutral-200 tabular-nums">{{ tokenSummary }}</span>

          <span class="text-neutral-500">Approval</span>
          <span class="text-neutral-200">{{ approvalDescription }}</span>

          <span class="text-neutral-500">Sandbox</span>
          <span class="text-neutral-200">{{ sandboxDescription }}</span>

          <template v-if="sandbox === 'workspace-write'">
            <span class="text-neutral-500">Network</span>
            <span class="text-neutral-200">{{ networkAccess ? 'Enabled' : 'Disabled' }}</span>
          </template>

          <span class="text-neutral-500">Web Search</span>
          <span class="text-neutral-200">{{ webSearch === 'live' ? 'Live' : webSearch === 'disabled' ? 'Disabled' : 'Cached' }}</span>
        </div>

        <details v-if="content.totalTokens" class="pt-2 mt-2 border-t border-neutral-800 text-neutral-500 ml-1">
          <summary class="text-[10px] uppercase tracking-wide cursor-pointer select-none hover:text-neutral-400 [&::marker]:mr-1">
            &nbsp;Context
            <span class="float-right text-xs tabular-nums normal-case tracking-normal text-neutral-400">{{ tokenSummary }}</span>
          </summary>
          <div class="mt-2 px-3 space-y-2">
            <div
              v-for="item in tokenRows"
              :key="item.label"
              class="space-y-0.5"
            >
              <div class="flex items-baseline justify-between">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-sm shrink-0" :class="item.color" />
                  <span class="text-xs text-neutral-300">{{ item.label }}</span>
                </div>
                <span class="text-xs tabular-nums text-neutral-400">{{ fmt(item.value) }}</span>
              </div>
              <div class="h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="item.color"
                  :style="{ width: tokenBarWidth(item.value) }"
                />
              </div>
            </div>
          </div>
        </details>

        <details v-if="recentTools.length" class="pt-2 mt-2 border-t border-neutral-800 text-neutral-500 ml-1">
          <summary class="text-[10px] uppercase tracking-wide cursor-pointer select-none hover:text-neutral-400 [&::marker]:mr-1">&nbsp;Recent</summary>
          <div class="mt-1 px-3">
            <div
              v-for="(tool, i) in recentTools"
              :key="i"
              class="text-neutral-300 truncate mt-0.5"
            >
              <span class="font-mono text-xs">{{ tool.name }}</span>
              <span v-if="tool.summary" class="text-neutral-500 text-xs"> - {{ tool.summary }}</span>
              <span class="text-neutral-600 text-[10px]"> - {{ relativeTime(tool.at) }}</span>
            </div>
          </div>
        </details>

        <div class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Approval</span>
            <span class="text-[10px] text-neutral-600">{{ approvalDescription }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              v-for="opt in approvalOptions"
              :key="opt.value"
              type="button"
              @click="selectApprovalMode(opt.value)"
              :title="opt.tooltip"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700 last:border-r-0',
                approvalMode === opt.value
                  ? (opt.value === 'auto_review'
                    ? 'bg-yellow-600 text-yellow-50'
                    : 'bg-neutral-700 text-neutral-100')
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Sandbox</span>
            <span class="text-[10px] text-neutral-600">{{ sandboxDescription }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              v-for="opt in sandboxOptions"
              :key="opt.value"
              type="button"
              @click="selectSandbox(opt.value)"
              :title="opt.tooltip"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700 last:border-r-0',
                sandbox === opt.value
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <div v-if="sandbox === 'workspace-write'" class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Network</span>
            <span class="text-[10px] text-neutral-600">{{ networkAccess ? 'Enabled' : 'Disabled' }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              type="button"
              @click="toggleNetworkAccess"
              title="Disable network access"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700',
                !networkAccess
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >Off</button>
            <button
              type="button"
              @click="toggleNetworkAccess"
              title="Enable network access in sandbox"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors',
                networkAccess
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >On</button>
          </div>
        </div>

        <div class="pt-2 mt-2 border-t border-neutral-800">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-[10px] uppercase tracking-wide text-neutral-500">Web Search</span>
            <span class="text-[10px] text-neutral-600">{{ webSearch === 'live' ? 'Live' : webSearch === 'disabled' ? 'Disabled' : 'Cached' }}</span>
          </div>
          <div class="flex rounded-md border border-neutral-700 overflow-hidden">
            <button
              v-for="opt in webSearchOptions"
              :key="opt.value"
              type="button"
              @click="selectWebSearch(opt.value)"
              :title="opt.tooltip"
              :class="[
                'flex-1 px-2 py-1 text-xs font-medium transition-colors border-r border-neutral-700 last:border-r-0',
                webSearch === opt.value
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'bg-neutral-900/40 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200',
              ]"
            >{{ opt.label }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bot, Check, Copy, Terminal } from 'lucide-vue-next'
import type { ArtifactItem } from '@apackdev/sdk/artifacts'
import { useSurfaceState } from '#generated/fe.ts'
import { openSurface } from '#generated/fe.ts'
import { tell } from '#generated/events.ts'


type ApprovalMode = 'user' | 'auto_review'
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

interface CodexThreadState {
  threadId?: string
  turnId?: string
  lastTurnAt?: number
  cwd?: string
  model?: string
  approvalMode?: ApprovalMode
  sandbox?: SandboxMode
  networkAccess?: boolean
  webSearch?: 'live' | 'cached' | 'disabled'
  startedAt?: number
  turns?: number
  totalTokens?: { input?: number; output?: number; reasoning?: number }
  chatState?: 'idle' | 'working' | 'paused' | 'error' | 'success'
  toolCallCount?: number
  recentTools?: Array<{ name: string; summary?: string; at: number }>
  sessionError?: string
  pendingApproval?: { method?: string; summary?: string; reason?: string }
  isRunning?: boolean
  additionalDirs?: string[]
}

defineProps<{
  artifact: ArtifactItem<CodexThreadState>
}>()

const currentThread = useSurfaceState('threads', (s) => s.currentThread)

const content = computed<CodexThreadState>(() =>
  currentThread.value?.context?.codex ?? ({} as CodexThreadState)
)

const settings = useSurfaceState('threads', (s) => s.settings)
const overrides = useSurfaceState('threads', (s) => s.chatStateOverrides)
const stateConfig = computed(() => {
  const configs = settings.value?.chatStates
  const threadId = currentThread.value?.id ?? ''
  const override = overrides.value?.[threadId]
  const activeId = (override && override.expiresAt > Date.now()) ? override.id : content.value.chatState
  return configs?.find((c: any) => c.id === activeId)
})

const recentTools = computed(() => content.value.recentTools ?? [])

const truncatedThreadId = computed(() => truncateId(content.value.threadId))
const truncatedTurnId = computed(() => truncateId(content.value.turnId))

const tokenTotal = computed(() => {
  const tokens = content.value.totalTokens
  return (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0)
})

const tokenSummary = computed(() => tokenTotal.value > 0 ? fmt(tokenTotal.value) : '-')

const tokenRows = computed(() => [
  { label: 'Input', value: content.value.totalTokens?.input ?? 0, color: 'bg-blue-500' },
  { label: 'Output', value: content.value.totalTokens?.output ?? 0, color: 'bg-purple-500' },
  { label: 'Reasoning', value: content.value.totalTokens?.reasoning ?? 0, color: 'bg-yellow-500' },
].filter(row => row.value > 0))

const approvalOptions: Array<{
  value: ApprovalMode
  label: string
  tooltip: string
  description: string
}> = [
  {
    value: 'user',
    label: 'Ask',
    tooltip: 'Ask before Codex runs actions that require approval',
    description: 'Prompts for approvals',
  },
  {
    value: 'auto_review',
    label: 'Auto',
    tooltip: 'Let Codex app-server auto-review approval requests',
    description: 'Auto-reviews approvals',
  },
]

const sandboxOptions: Array<{
  value: SandboxMode
  label: string
  tooltip: string
  description: string
}> = [
  {
    value: 'read-only',
    label: 'Read',
    tooltip: 'Read-only sandbox',
    description: 'Read-only',
  },
  {
    value: 'workspace-write',
    label: 'Write',
    tooltip: 'Allow writes in the workspace',
    description: 'Workspace write',
  },
  {
    value: 'danger-full-access',
    label: 'Full',
    tooltip: 'No filesystem sandbox',
    description: 'Full access',
  },
]

const approvalMode = computed<ApprovalMode>(() => content.value.approvalMode ?? 'user')

const approvalDescription = computed(() => {
  if (content.value.pendingApproval) return 'Waiting for approval'
  return approvalOptions.find(o => o.value === approvalMode.value)?.description ?? ''
})

const sandbox = computed<SandboxMode>(() => content.value.sandbox ?? 'workspace-write')
const sandboxDescription = computed(() => sandboxOptions.find(o => o.value === sandbox.value)?.description ?? '')

const networkAccess = computed(() => content.value.networkAccess ?? false)
const webSearch = computed<'live' | 'cached' | 'disabled'>(() => content.value.webSearch ?? 'cached')

const webSearchOptions: Array<{ value: 'live' | 'cached' | 'disabled'; label: string; tooltip: string }> = [
  { value: 'live', label: 'Live', tooltip: 'Allow live web fetching' },
  { value: 'cached', label: 'Cached', tooltip: 'Use cached search results (default)' },
  { value: 'disabled', label: 'Off', tooltip: 'Disable web search entirely' },
]

function truncateId(id?: string): string {
  if (!id) return ''
  if (id.length <= 18) return id
  return `${id.slice(0, 8)}...${id.slice(-6)}`
}

function shortenCwd(cwd?: string): string {
  if (!cwd) return ''
  const segments = cwd.split('/').filter(Boolean)
  if (segments.length <= 3) return cwd
  return `.../${segments.slice(-3).join('/')}`
}

function relativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs
  if (delta < 5_000) return 'just now'
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function tokenBarWidth(value: number): string {
  if (tokenTotal.value <= 0 || value <= 0) return '0%'
  return `${Math.max((value / tokenTotal.value) * 100, 0.5)}%`
}

const copied = ref(false)
async function copyThreadId() {
  if (!content.value.threadId) return
  try {
    await navigator.clipboard.writeText(content.value.threadId)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* clipboard denied */ }
}

function openTerminalTab() {
  // The code surface routes a terminal.* event to its terminals
  openSurface('code', {
    type: 'terminal.CREATE',
    target: 'tab',
    command: `codex resume ${content.value.threadId}`,
    cwd: content.value.cwd || undefined,
  })
}

function updateSessionSettings(payload: { approvalMode?: ApprovalMode; sandbox?: SandboxMode; networkAccess?: boolean; webSearch?: 'live' | 'cached' | 'disabled' }) {
  const threadId = currentThread.value?.id
  if (!threadId) return
  tell('threads', {
    type: 'FORWARD_BRAIN_EVENT',
    eventType: 'user.update.codexSessionSettings',
    payload: { threadId, ...payload },
  })
}

function selectApprovalMode(value: ApprovalMode) {
  if (value === approvalMode.value) return
  updateSessionSettings({ approvalMode: value })
}

function selectSandbox(value: SandboxMode) {
  if (value === sandbox.value) return
  updateSessionSettings({ sandbox: value })
}

function toggleNetworkAccess() {
  updateSessionSettings({ networkAccess: !networkAccess.value })
}

function selectWebSearch(value: 'live' | 'cached' | 'disabled') {
  if (value === webSearch.value) return
  updateSessionSettings({ webSearch: value })
}
</script>
