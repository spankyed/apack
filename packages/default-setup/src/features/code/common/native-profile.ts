/** A session pins its config root; environment variables and credentials are never persisted. */
export function claudeProfileOptions(state: { configDir?: string } | undefined): { env?: NodeJS.ProcessEnv } {
  return state?.configDir ? { env: { CLAUDE_CONFIG_DIR: state.configDir } } : {}
}
