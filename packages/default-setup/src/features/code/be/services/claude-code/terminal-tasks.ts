import { z } from 'zod'
export const ClaudeNativeTaskResultSchema = z.object({
  sent: z.boolean().optional(),
  stopped: z.boolean().optional(),
  details: z.object({ taskId: z.string().max(256), name: z.string(), status: z.string(), canMessage: z.boolean(), metadata: z.object({ prompt: z.string().max(16384).optional(), promptTruncated: z.boolean(), model: z.string().optional(), effort: z.string().optional(), elapsedMs: z.number().finite().nonnegative().optional(), tokenCount: z.number().finite().nonnegative().optional(), toolUseCount: z.number().finite().nonnegative().optional(), error: z.string().max(16384).optional(), errorTruncated: z.boolean() }).optional(), messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(131072) })).max(100), truncated: z.boolean() }).optional(),
})
