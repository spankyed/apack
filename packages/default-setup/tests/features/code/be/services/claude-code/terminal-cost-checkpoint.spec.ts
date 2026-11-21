import vm from 'node:vm'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'
function fixture() {
  const start = claudeTerminalUiRuntime.indexOf('let costCheckpoint=')
  const end = claudeTerminalUiRuntime.indexOf('async function control(', start)
  return vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};checkpointNativeCost`) as (native: unknown, session: string) => Promise<unknown>
}
it('flushes original complete snapshots in order and deduplicates unchanged accounting', async () => {
  const checkpoint = fixture(), state = { sessionId: 'session', totalCostUSD: 0.42, modelUsage: { original: { costUSD: 0.42, inputTokens: 7 } }, totalDuration: 100 }
  let flush!: () => void
  const kfo = vi.fn(async () => {}), Ou = vi.fn(() => new Promise<void>(yes => { flush = yes })), runtime = { adt: () => structuredClone(state), kfo, Ou }
  let settled = false
  const first = checkpoint({ runtime }, 'session').then(value => { settled = true; return value })
  await vi.waitFor(() => expect(Ou).toHaveBeenCalledOnce())
  expect(settled).toBe(false);expect(kfo).toHaveBeenCalledWith(state)
  flush();await expect(first).resolves.toEqual({sessionId:'session',totalCostUsd:0.42})
  state.totalDuration = 150;await checkpoint({ runtime }, 'session');expect(kfo).toHaveBeenCalledOnce()
  expect(() => checkpoint({ runtime }, 'foreign')).toThrow('unavailable')
})
it('retries a failed flush rather than acknowledging or caching undurable accounting', async () => {
  const checkpoint = fixture(), state = { sessionId: 'session', totalCostUSD: 0.42, modelUsage: {} }
  const kfo = vi.fn(async () => {}), Ou = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined), native = { runtime: { adt: () => state, kfo, Ou } }
  await expect(checkpoint(native, 'session')).rejects.toThrow('disk full')
  await expect(checkpoint(native, 'session')).resolves.toEqual({sessionId:'session',totalCostUsd:0.42})
  expect(kfo).toHaveBeenCalledTimes(2)
})
