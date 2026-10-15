/**
 * Tests for the child-env scrubber used by `execOnce` and `spawnStream`.
 *
 * The scrub prevents an `ANTHROPIC_API_KEY` in the API server's environment
 * (loaded from `.env` by dotenv) from leaking into the Claude CLI subprocess,
 * where it would override the user's stored `claude auth login` session
 * and fail with "Invalid API key · Fix external API key".
 */

import { buildChildEnv } from '#features/code/be/services/claude-code/runner.ts'

describe('buildChildEnv', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-dev-placeholder'
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('strips ANTHROPIC_API_KEY from the default (inherited) env', () => {
    const env = buildChildEnv()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    // Other env vars pass through untouched.
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('merges caller overrides into the default env', () => {
    const override = { ANTHROPIC_API_KEY: 'sk-ant-explicit', PATH: '/fake' }
    const env = buildChildEnv(override)
    // Overrides are merged but ANTHROPIC_API_KEY is still stripped.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.PATH).toBe('/fake')
  })

  it('does not mutate the live process.env', () => {
    buildChildEnv()
    // The helper spreads process.env into a fresh object before deleting,
    // so the parent's own env must stay intact (llm.ts still needs the key).
    expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-dev-placeholder')
  })

  it('preserves the native default instead of forcing tool search off', () => {
    const env = buildChildEnv({ ENABLE_TOOL_SEARCH: undefined })
    expect(env.ENABLE_TOOL_SEARCH).toBeUndefined()
  })

  it.each(['true', '0', 'auto:10'])('honors explicit native tool-search configuration %s', setting => {
    expect(buildChildEnv({ ENABLE_TOOL_SEARCH: setting }).ENABLE_TOOL_SEARCH).toBe(setting)
  })
})
