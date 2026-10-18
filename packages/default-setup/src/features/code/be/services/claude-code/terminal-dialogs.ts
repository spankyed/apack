import { z } from 'zod'

/** A one-time Read decision; native retains policy, input and dialog lifecycle ownership. */
export const ClaudeNativeReadDialogSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  requestId: z.string().min(1).max(256), toolName: z.literal('Read'),
  title: z.string().max(1000), question: z.string().max(4000),
  reason: z.string().max(16000).optional(),
  input: z.record(z.string(), z.unknown()),
})
export const ClaudeNativeReadDialogsSchema = z.array(ClaudeNativeReadDialogSchema).max(1)
export type ClaudeNativeReadDialog = z.infer<typeof ClaudeNativeReadDialogSchema>
export interface ClaudeNativeReadDialogResponse {
  id: string
  revision: string
  sessionId: string
  decision: 'allow' | 'deny'
  feedback?: string
}
