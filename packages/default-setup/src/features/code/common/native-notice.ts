import { z } from 'zod'

/** Original classifier-billing notice; native owns acknowledgement and interruption. */
export const ClaudeNativeNoticeSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  kind: z.literal('auto_mode_server_fallback'), title: z.string().max(16000),
  paragraphs: z.array(z.string().max(16000)).max(32), helpUrl: z.string().max(4000),
})
export type ClaudeNativeNotice = z.infer<typeof ClaudeNativeNoticeSchema>
export type ClaudeNativeNoticeResponse = Pick<ClaudeNativeNotice, 'id' | 'revision' | 'sessionId'> & { decision: 'continue' | 'interrupt' }
