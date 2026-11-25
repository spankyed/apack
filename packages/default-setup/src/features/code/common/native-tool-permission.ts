import { z } from 'zod'
import { ClaudeFileApprovalPresentationSchema } from './native-file-approval.ts'

/** Native-rendered preview and original choices; the host never constructs permission updates. */
export const ClaudeToolPermissionApprovalSchema = ClaudeFileApprovalPresentationSchema.extend({
  title: z.string().min(1).max(4000),
  details: z.array(z.object({ label: z.string().max(128), value: z.string().max(200000), ansi: z.string().max(200000).optional() })).max(4),
}) satisfies z.ZodType<ClaudeToolPermissionApproval>
/** Shared card presentation, including original focus and choice explanations when available. */
export const ClaudeGenericToolPermissionApprovalSchema = ClaudeToolPermissionApprovalSchema.extend({
  choices: z.array(ClaudeToolPermissionApprovalSchema.shape.choices.element.extend({ prefix: z.string().max(4000).optional() })).max(16),
  defaultFocusValue: z.string().max(128).optional(),
  canCancel: z.boolean(),
  choiceDescriptions: z.record(z.string().max(128), z.string().max(4000)).refine(value => Object.keys(value).length <= 16),
}) satisfies z.ZodType<ClaudeGenericToolPermissionApproval>
export type ClaudeGenericToolPermissionApproval = {
  token: string
  ready: boolean
  title: string
  details: {
    label: string
    value: string
    ansi?: string
  }[]
  choices: {
    value: string
    label: string
    decision: 'deny' | 'allow'
    feedback: boolean
    prefix?: string
  }[]
  canCancel: boolean
  choiceDescriptions: Record<string, string>
  defaultFocusValue?: string
}

export type ClaudeToolPermissionApproval = {
  token: string
  ready: boolean
  choices: {
    value: string
    label: string
    decision: 'deny' | 'allow'
    feedback: boolean
  }[]
  title: string
  details: {
    label: string
    value: string
    ansi?: string
  }[]
}
