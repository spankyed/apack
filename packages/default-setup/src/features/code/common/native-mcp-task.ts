import { z } from 'zod'

/** Observed original MCP task fields; server task identity is separate from the native registry id. */
export const ClaudeNativeMcpTaskInfoSchema = z.object({
  truncated: z.boolean(),
  serverName: z.string().max(512).optional(),
  toolName: z.string().max(512).optional(),
  serverTaskId: z.string().max(512).optional(),
  status: z.string().min(1).max(64),
  statusMessage: z.string().max(4096).optional(),
  parked: z.literal(true).optional(),
  pollIntervalMs: z.number().finite().nonnegative().optional(),
  startTime: z.number().finite().nonnegative(),
  endTime: z.number().finite().nonnegative().optional(),
  protocol: z.string().max(64).optional(),
}) satisfies z.ZodType<ClaudeNativeMcpTaskInfo>
export type ClaudeNativeMcpTaskInfo = {
  truncated: boolean
  status: string
  startTime: number
  serverName?: string
  toolName?: string
  serverTaskId?: string
  statusMessage?: string
  parked?: true
  pollIntervalMs?: number
  endTime?: number
  protocol?: string
}

export function claudeMcpTaskStatusLabel(info: ClaudeNativeMcpTaskInfo | undefined, status: string): string {
  if (status === 'killed') return 'Stopped'
  if (info?.parked) return 'Outcome unknown'
  return info?.status.replaceAll('_', ' ') ?? status
}
