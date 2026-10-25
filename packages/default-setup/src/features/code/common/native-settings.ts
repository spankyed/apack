import { z } from 'zod'

export const claudeSettingValue = z.union([z.boolean(), z.string().max(16384), z.number().finite(), z.null()])
export const claudeSettingsTab = z.enum(['Status', 'Config', 'Usage', 'Stats'])
export const claudeSettingsFrame = z.object({
  selectedTab: claudeSettingsTab,
  tabs: z.array(claudeSettingsTab).length(4),
  hidden: z.boolean(),
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
export type ClaudeSettingsOperation = { kind: 'read' } | { kind: 'tab'; revision: string; tab: z.infer<typeof claudeSettingsTab> } | { kind: 'write'; revision: string; key: string; value: ClaudeSettingValue }
export type ClaudeSettingsView = { requestId: string; status: 'pending' | 'ready' | 'error'; snapshot?: ClaudeSettingsSnapshot; problem?: string; savedKey?: string }
