import { z } from 'zod'
import { ClaudeFileApprovalPresentationSchema } from './native-file-approval.ts'

/** Native-rendered preview and original choices; the host never constructs permission updates. */
export const ClaudeToolPermissionApprovalSchema = ClaudeFileApprovalPresentationSchema.extend({
  title: z.string().min(1).max(4000),
  details: z.array(z.object({ label: z.string().max(128), value: z.string().max(200000), ansi: z.string().max(200000).optional() })).max(4),
})
/** Exact original generic permission_prompt, including native choice explanations. */
export const ClaudeGenericToolPermissionApprovalSchema = ClaudeToolPermissionApprovalSchema.extend({
  defaultFocusValue: z.string().max(128).optional(),
  canCancel: z.boolean(),
  choiceDescriptions: z.record(z.string().max(128), z.string().max(4000)).refine(value => Object.keys(value).length <= 16),
})
export type ClaudeGenericToolPermissionApproval = z.infer<typeof ClaudeGenericToolPermissionApprovalSchema>

export type ClaudeToolPermissionApproval = z.infer<typeof ClaudeToolPermissionApprovalSchema>
