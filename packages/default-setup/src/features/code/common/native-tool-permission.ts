import { z } from 'zod'
import { ClaudeFileApprovalPresentationSchema } from './native-file-approval.ts'

/** Native-rendered preview and original choices; the host never constructs permission updates. */
export const ClaudeToolPermissionApprovalSchema = ClaudeFileApprovalPresentationSchema.extend({
  title: z.string().min(1).max(4000),
  details: z.array(z.object({ label: z.string().max(128), value: z.string().max(200000) })).max(4),
})
export type ClaudeToolPermissionApproval = z.infer<typeof ClaudeToolPermissionApprovalSchema>
