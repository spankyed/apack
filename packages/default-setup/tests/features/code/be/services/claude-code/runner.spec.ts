/**
 * Tests for the child-env scrubber used by `execOnce` and `spawnStream`.
 *
 * The scrub prevents an `ANTHROPIC_API_KEY` in the API server's environment
 * (loaded from `.env` by dotenv) from leaking into the Claude CLI subprocess,
 * where it would override the user's stored `claude auth login` session
 * and fail with "Invalid API key · Fix external API key".
 */

import { cpuBudget } from '@apackdev/testing/vitest'
import { getEventListeners, once } from 'node:events'
import { tmpdir } from 'node:os'
import { buildChildEnv, spawnStream } from '#features/code/be/services/claude-code/runner.ts'

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

describe('spawnStream termination', () => {
  const ignoringChild = `process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}); console.log(JSON.stringify({ready:true})); setInterval(() => {}, 1000)`

  it.each(['abort', 'kill'] as const)('settles a child that ignores SIGTERM after %s', { meta: cpuBudget(5000) }, async source => {
    const controller = new AbortController()
    const handle = await spawnStream(['-e', ignoringChild], { cliPath: process.execPath, cwd: tmpdir(), signal: controller.signal })
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await expect(handle.lines[Symbol.asyncIterator]().next()).resolves.toMatchObject({ value: { ok: true, value: { ready: true } } })
      if (source === 'abort') controller.abort()
      else handle.kill()
      const result = await Promise.race([handle.done(), new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('child did not exit after termination')), 2500)
      })])
      expect(result.signal).toBe('SIGKILL')
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    } finally {
      if (deadline) clearTimeout(deadline)
      handle.child.kill('SIGKILL')
      await handle.done()
    }
  })

  it('removes the abort listener when the child exits normally', async () => {
    const controller = new AbortController()
    const handle = await spawnStream(['-e', 'process.exit(0)'], { cliPath: process.execPath, cwd: tmpdir(), signal: controller.signal })
    expect((await handle.done()).exitCode).toBe(0)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    controller.abort()
  })
})

describe('waitForExitWhileWorking', () => {
  // A real child, because what is under test is whether its own output reaches the wait.
  const silentAfterReady = `console.log(JSON.stringify({ready:true})); setInterval(() => {}, 1000)`
  const chattyChild = `console.log(JSON.stringify({ready:true})); setInterval(() => console.log(JSON.stringify({beat:true})), 20)`

  it('resolves exited when the child ends on its own', async () => {
    const handle = await spawnStream(['-e', 'console.log(JSON.stringify({ready:true}))'], { cliPath: process.execPath, cwd: tmpdir() })
    await expect(handle.waitForExitWhileWorking(5000)).resolves.toEqual({ exited: true })
  })

  it('terminates a child that has gone silent without exiting', { meta: cpuBudget(10_000) }, async () => {
    const handle = await spawnStream(['-e', silentAfterReady], { cliPath: process.execPath, cwd: tmpdir() })
    try {
      await handle.lines[Symbol.asyncIterator]().next()

      await expect(handle.waitForExitWhileWorking(200)).resolves.toEqual({ exited: false })

      expect((await handle.done()).signal).toBeTruthy()
    } finally {
      handle.child.kill('SIGKILL')
      await handle.done()
    }
  })

  it('keeps waiting on a child that is still writing, past the silence window', { meta: cpuBudget(10_000) }, async () => {
    // The distinguishing case: the wait outlives its own window several times over because the child keeps
    // producing. A clocked deadline would have terminated this child at the first crossing.
    const handle = await spawnStream(['-e', chattyChild], { cliPath: process.execPath, cwd: tmpdir() })
    const reader = handle.lines[Symbol.asyncIterator]()
    try {
      const waiting = handle.waitForExitWhileWorking(150)
      for (let beat = 0; beat < 20; beat++) await reader.next()

      expect(await Promise.race([waiting, Promise.resolve('still waiting')])).toBe('still waiting')
    } finally {
      handle.child.kill('SIGKILL')
      await handle.done()
    }
  })
})

describe('spawnStream input failure', () => {
  it('settles a live child after its input pipe fails', { meta: cpuBudget(5000) }, async () => {
    const child = `require('node:fs').closeSync(0); console.log(JSON.stringify({ready:true})); setInterval(() => {}, 1000)`
    const handle = await spawnStream(['-e', child], { cliPath: process.execPath, cwd: tmpdir() })
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await expect(handle.lines[Symbol.asyncIterator]().next()).resolves.toMatchObject({ value: { ok: true, value: { ready: true } } })
      const inputError = once(handle.child.stdin!, 'error')
      const settled = (async () => {
        handle.write({ type: 'fixture' })
        await inputError
        return handle.done()
      })()
      const exit = await Promise.race([settled, new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error('child stayed alive after stdin failed')), 2000)
      })])
      expect(exit.signal).toBe('SIGTERM')
      expect(handle.write({ type: 'late' })).toBe(false)
    } finally {
      if (deadline) clearTimeout(deadline)
      handle.child.kill('SIGKILL')
      await handle.done()
    }
  })
})

 it('retains bounded stderr including final writes before close', async () => {
  const handle = await spawnStream(['-e', "process.stderr.write('x'.repeat(200000)); process.stderr.end('late diagnostic');"], {cliPath: process.execPath, cwd: tmpdir()})
  const result = await handle.done()
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toContain('[stderr truncated:')
  expect(result.stderr.endsWith('late diagnostic')).toBe(true)
  expect(Buffer.byteLength(result.stderr)).toBeLessThan(64 * 1024 + 100)
 })
