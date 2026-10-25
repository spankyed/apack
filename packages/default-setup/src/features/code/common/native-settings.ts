import { z } from 'zod'

export const claudeSettingValue = z.union([z.boolean(), z.string().max(16384), z.number().finite(), z.null()])
export const claudeSettingsTab = z.enum(['Status', 'Config', 'Usage', 'Stats'])
const nativeReading = z.number().finite()
export const claudeSettingsStats = z.object({
  view: z.enum(['Overview', 'Models']).optional(), range: z.enum(['all', '7d', '30d']).optional(), loading: z.boolean(),
  outcome: z.enum(['success', 'empty', 'error', 'loading']), problem: z.string().max(16384).optional(),
  data: z.object({
    totalSessions: nativeReading, totalMessages: nativeReading, totalDays: nativeReading, activeDays: nativeReading,
    modelUsage: z.record(z.string().max(1024), z.object({inputTokens:nativeReading,outputTokens:nativeReading,cacheReadInputTokens:nativeReading,cacheCreationInputTokens:nativeReading,costUSD:nativeReading}).strict()),
    dailyActivity: z.array(z.object({date:z.string().max(64),messageCount:nativeReading,sessionCount:nativeReading,toolCallCount:nativeReading}).strict()).max(10000),
  }).strict().optional(),
}).strict()
export const claudeSettingsFrame = z.object({
  selectedTab: claudeSettingsTab,
  tabs: z.array(claudeSettingsTab).length(4),
  hidden: z.boolean(),
  usage: z.object({startedAt:nativeReading,context:z.object({window:nativeReading,tokens:nativeReading.optional(),percent:nativeReading.optional()}).strict(),cost:z.object({usd:nativeReading}).strict().optional(),rateLimits:z.array(z.object({kind:z.string().max(1024),percentUsed:nativeReading,resetsAt:z.string().max(128).optional()}).strict()).max(128)}).strict().optional(),
  stats: claudeSettingsStats.optional(),
  status: z.array(z.array(z.object({ label: z.string().max(16384), value: z.string().max(65536) }).strict()).max(128)).max(16).optional(),
}).strict()
export const claudeSettingsSnapshot = z.object({
  frame: claudeSettingsFrame.optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  rows: z.array(z.object({
    key: z.string().min(1).max(4096), label: z.string().max(16384), description: z.string().max(16384).optional(),
    kind: z.enum(['boolean', 'choice', 'text', 'number']), value: claudeSettingValue,
    options: z.array(z.string().max(16384)).max(256).optional(),
    isLocked: z.boolean(), lockReason: z.string().max(16384).optional(),
  }).strict()).max(256),
}).strict()
export type ClaudeSettingsSnapshot = z.infer<typeof claudeSettingsSnapshot>
export type ClaudeSettingValue = z.infer<typeof claudeSettingValue>
export type ClaudeSettingsOperation = { kind: 'read' } | { kind: 'stats'; revision: string; action: 'Overview' | 'Models' | 'cycleDates' } | { kind: 'tab'; revision: string; tab: z.infer<typeof claudeSettingsTab> } | { kind: 'write'; revision: string; key: string; value: ClaudeSettingValue }
export type ClaudeSettingsView = { requestId: string; status: 'pending' | 'ready' | 'error'; snapshot?: ClaudeSettingsSnapshot; problem?: string; savedKey?: string }
