import { z } from 'zod'

/** Task families whose original manager owns their distinct details and confirmation flows. */
export const ClaudeNativeManagedTaskTypeSchema = z.enum([
  'remote_agent', 'dream', 'auto_mode_scan', 'local_memory_import', 'monitor_mcp', 'monitor_ws',
])
export type ClaudeNativeManagedTaskType = z.infer<typeof ClaudeNativeManagedTaskTypeSchema>
export const claudeNativeManagedTaskLabels: Record<ClaudeNativeManagedTaskType, string> = {
  remote_agent: 'Remote Agent', dream: 'Memory consolidation', auto_mode_scan: 'Auto mode scan',
  local_memory_import: 'Memory import', monitor_mcp: 'MCP monitor', monitor_ws: 'WebSocket monitor',
}
