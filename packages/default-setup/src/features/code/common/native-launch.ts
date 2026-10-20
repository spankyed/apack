import type { PermissionMode } from '../be/services/claude-code/types.ts'

/** Persisted launch intent; credentials, resolved settings and process capabilities stay backend-only. */
export interface ClaudeNativeLaunch {
  sessionId: string
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  allowedTools?: string[]
  disallowedTools?: string[]
  appendSystemPrompt?: string
  addDir?: string[]
  pluginDir?: string[]
}
