import { runInNewContext } from 'node:vm'
import { createClaudeTerminalPlugin } from '#features/code/be/services/claude-code/terminal-plugin.ts'
import type { ApackNativePluginConfig } from '#features/code/be/services/claude-code/native-plugin/program.ts'
import type { ClaudeHookRegistrar } from '#features/code/be/services/claude-code/native-plugin/claude-plugin-api.ts'

/** The CLI loads one module instance; each fixture gets that same recorded program in its own realm. */
export function createPluginFixture(config: ApackNativePluginConfig): (on: ClaudeHookRegistrar) => void {
  const program = createClaudeTerminalPlugin(config.socketPath, config.token, config.background)
  return runInNewContext(program.replace(/^export\s*\{[^}]*\};?$/m, '') + ';register', { URL, JSON, Object, Number, Date, setTimeout })
}
