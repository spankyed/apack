import { z } from 'zod'
const operation = z.enum(['open', 'accept', 'decline', 'continue', 'cancel'])
export const ClaudeNativeMcpUrlSchema = z.object({
  id: z.string().min(1).max(256), revision: z.string().uuid(), sessionId: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/), ready: z.boolean(),
  kind: z.enum(['mcp_elicitation', 'mcp_url_elicitation', 'mcp_elicitation_waiting']),
  serverName: z.string().max(4000), message: z.string().max(65536), url: z.string().max(65536),
  title: z.string().max(8000), phase: z.enum(['prompt', 'waiting']),
  userConfirmsCompletion: z.boolean(),
  choices: z.array(z.object({ operation, label: z.string().max(4000), selected: z.boolean() })).max(3),
  warnings: z.array(z.string().max(8000)).max(8),
}) satisfies z.ZodType<ClaudeNativeMcpUrl>
export type ClaudeNativeMcpUrl = {
  id: string
  revision: string
  sessionId: string
  token: string
  ready: boolean
  kind: 'mcp_elicitation' | 'mcp_url_elicitation' | 'mcp_elicitation_waiting'
  serverName: string
  message: string
  url: string
  title: string
  phase: 'prompt' | 'waiting'
  userConfirmsCompletion: boolean
  choices: {
    operation: 'cancel' | 'open' | 'accept' | 'decline' | 'continue'
    label: string
    selected: boolean
  }[]
  warnings: string[]
}
export const ClaudeNativeMcpUrlOperationSchema = z.object({ operation }).strict() satisfies z.ZodType<ClaudeNativeMcpUrlOperation>
export type ClaudeNativeMcpUrlOperation = {
  operation: 'cancel' | 'open' | 'accept' | 'decline' | 'continue'
}
export interface ClaudeNativeMcpUrlRequest { id: string; revision: string; sessionId: string; token: string; action: ClaudeNativeMcpUrlOperation }
