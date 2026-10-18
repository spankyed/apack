import { z } from 'zod'
export const ClaudeNativeTaskResultSchema = z.object({
  stopped: z.boolean().optional(),
  details: z.object({ taskId: z.string().max(256), name: z.string(), status: z.string(), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(131072) })).max(100), truncated: z.boolean() }).optional(),
})
