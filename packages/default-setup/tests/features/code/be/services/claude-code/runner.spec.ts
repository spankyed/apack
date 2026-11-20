/**
 * Tests for the child-env scrubber used by `execOnce` and `spawnStream`, and for how
 * `execOnce` reports each way its child can fail.
 *
 * The scrub prevents an `ANTHROPIC_API_KEY` in the API server's environment
 * (loaded from `.env` by dotenv) from leaking into the Claude CLI subprocess,
 * where it would override the user's stored `claude auth login` session
 * and fail with "Invalid API key · Fix external API key".
 */

import { ClaudeExitError, ClaudeTimeoutError } from '#features/code/be/services/claude-code/errors.ts'
import { buildChildEnv, execOnce } from '#features/code/be/services/claude-code/runner.ts'

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

  it('sets ENABLE_TOOL_SEARCH=0 so deferred tools (ExitPlanMode, …) are always in Claude\'s initial tools list', () => {
    // Regression guard for the plan-mode UX breakage: Claude Code's
    // tool-search mode defaults to enabled, which hides every tool
    // tagged `shouldDefer: true` (including ExitPlanMode) from Claude
    // on the first turn. Without this env var, plan-mode sessions
    // never fire our ExitPlanMode approval flow because Claude can't
    // actually call the tool. See the leaked-source comment in
    // runner.ts's `buildChildEnv` for the full chain.
    const env = buildChildEnv()
    expect(env.ENABLE_TOOL_SEARCH).toBe('0')
  })

  it('sets ENABLE_TOOL_SEARCH=0 even when caller passes an override', () => {
    const override = { FOO: 'bar' }
    const env = buildChildEnv(override)
    expect(env.FOO).toBe('bar')
    expect(env.ENABLE_TOOL_SEARCH).toBe('0')
  })
})

describe('execOnce', () => {
  /** Node stands in for the CLI: what is under test is how each way a child can fail reaches the caller */
  const cli = { cliPath: process.execPath }

  it('answers with what the child wrote', async () => {
    const result = await execOnce(['-e', "process.stdout.write('1.2.3')"], cli)
    expect(result).toEqual({ stdout: '1.2.3', stderr: '', exitCode: 0 })
  })

  it('throws a ClaudeExitError carrying the exit code and stderr', async () => {
    const failed = execOnce(['-e', "process.stderr.write('not signed in'); process.exitCode = 2"], cli)
    await expect(failed).rejects.toMatchObject({ code: 'EXIT_NONZERO', exitCode: 2, stderr: 'not signed in' })
    await expect(failed).rejects.toBeInstanceOf(ClaudeExitError)
  })

  it('throws a ClaudeCliNotFoundError naming the path it tried', async () => {
    await expect(execOnce(['--version'], { cliPath: '/no/such/claude' }))
      .rejects.toMatchObject({ code: 'CLI_NOT_FOUND', attemptedPath: '/no/such/claude' })
  })

  // Each waiting child ends itself, so one that was not stopped is gone soon after its case
  const waits = ['-e', 'setTimeout(() => {}, 60_000)']

  it('throws a ClaudeTimeoutError when the child outlives its timeout', async () => {
    await expect(execOnce(waits, { ...cli, timeoutMs: 200 })).rejects.toBeInstanceOf(ClaudeTimeoutError)
  })

  it("throws a ClaudeAbortError carrying the caller's reason when the caller stops it", async () => {
    const stopping = new AbortController()
    const run = execOnce(waits, { ...cli, signal: stopping.signal })
    const reason = new Error('the user closed the panel')
    stopping.abort(reason)
    await expect(run).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
  })
})
