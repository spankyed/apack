/** Presence matters: an explicit default config path selects a different native Keychain namespace. */
export interface ClaudeNativeProfile {
  configDir?: string
  secureStorageConfigDir?: string
}

export function snapshotClaudeProfile(env: NodeJS.ProcessEnv): ClaudeNativeProfile {
  const profile: ClaudeNativeProfile = {}
  if (env.CLAUDE_CONFIG_DIR !== undefined) profile.configDir = env.CLAUDE_CONFIG_DIR
  if (env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined) profile.secureStorageConfigDir = env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  return profile
}

/** Persist profile choices, never arbitrary environment variables or credentials. */
export function claudeProfileOptions(state: {profile?: ClaudeNativeProfile} | undefined): {env?: NodeJS.ProcessEnv} {
  return state?.profile ? {env: {CLAUDE_CONFIG_DIR: state.profile.configDir, CLAUDE_SECURESTORAGE_CONFIG_DIR: state.profile.secureStorageConfigDir}} : {}
}

export function sameClaudeProfile(a: ClaudeNativeProfile, b: ClaudeNativeProfile): boolean {
  return a.configDir === b.configDir && a.secureStorageConfigDir === b.secureStorageConfigDir
}
