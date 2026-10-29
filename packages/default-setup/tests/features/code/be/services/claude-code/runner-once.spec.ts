import { ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// This primitive test owns its CLI path and exercises real pipes/child processes.
vi.mock('#features/code/be/utils/resolve-cli.ts', () => ({ resolveForService: () => { throw new Error('explicit cliPath required by test') } }))
vi.mock('@apackdev/sdk/logger', () => ({ createLogger: () => ({ warn() {}, error() {} }) }))

import { execOnce, spawnStream } from '#features/code/be/services/claude-code/runner.ts'

describe('Claude process input and abort lifecycle', () => {
  it('rejects a failed input write and terminates its owned child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-once-input-'))
    const ready = join(root, 'ready')
    let pid: number | undefined
    const script = `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); require('node:fs').closeSync(0); setInterval(() => {}, 1000)`
    try {
      await expect(execOnce(['-e', script, ready], {
        cliPath: process.execPath,
        cwd: root,
        input: 'x'.repeat(2 * 1024 * 1024),
        timeoutMs: 1500,
      })).rejects.toMatchObject({ code: 'INPUT_FAILED', cause: { code: 'EPIPE' } })
      pid = Number(await readFile(ready, 'utf8'))
      await vi.waitFor(() => { expect(() => process.kill(pid!, 0)).toThrow() }, { timeout: 1000, interval: 25 })
    } finally {
      if (pid === undefined) { try { pid = Number(await readFile(ready, 'utf8')) } catch { /* child did not become ready */ } }
      if (pid !== undefined && Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL') } catch { /* owned child already exited */ } }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('handles a late spawn error after an already-aborted signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-once-missing-'))
    try {
      await expect(execOnce([], { cliPath: join(root, 'missing'), signal: AbortSignal.abort('test') })).rejects.toMatchObject({ code: 'ABORTED' })
      await new Promise<void>(resolve => setImmediate(resolve))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not signal a PID-less failed streaming spawn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-stream-missing-'))
    const attemptedPids: (number | undefined)[] = []
    const originalKill = ChildProcess.prototype.kill
    const spy = vi.spyOn(ChildProcess.prototype, 'kill').mockImplementation(function (this: ChildProcess, signal) {
      attemptedPids.push(this.pid)
      // Observe the invalid attempt without issuing an OS signal for it.
      if (this.pid === undefined) return false
      return originalKill.call(this, signal)
    })
    try {
      const handle = await spawnStream([], { cliPath: join(root, 'missing'), cwd: root, signal: AbortSignal.abort('test') })
      await expect(handle.done()).rejects.toMatchObject({ code: 'CLI_NOT_FOUND' })
      expect(attemptedPids).not.toContain(undefined)
    } finally {
      spy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('eventually kills an aborted child that ignores SIGTERM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-once-abort-'))
    const ready = join(root, 'ready')
    const controller = new AbortController()
    let pid: number | undefined
    const script = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)`
    const result = execOnce(['-e', script, ready], {
      cliPath: process.execPath,
      cwd: root,
      signal: controller.signal,
      timeoutMs: 5000,
    })
    const rejected = expect(result).rejects.toMatchObject({ code: 'ABORTED' })
    try {
      await vi.waitFor(async () => { pid = Number(await readFile(ready, 'utf8')); expect(pid).toBeGreaterThan(0) }, { timeout: 2000 })
      controller.abort()
      await rejected
      await vi.waitFor(() => { expect(() => process.kill(pid!, 0)).toThrow() }, { timeout: 2000, interval: 25 })
    } finally {
      controller.abort()
      if (pid !== undefined && Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 'SIGKILL') } catch { /* owned child already exited */ } }
      await result.catch(() => {})
      await rm(root, { recursive: true, force: true })
    }
  }, 7000)
})
