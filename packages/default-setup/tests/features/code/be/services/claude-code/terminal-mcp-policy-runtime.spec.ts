import { expect, it, vi } from 'vitest'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalMcpPolicyRuntime } from '#features/code/be/services/claude-code/terminal-mcp-policy-runtime.ts'

function fixture() {
  const allowed = { name: 'managed', type: 'connected', config: {} }
  const blocked = { name: 'local', type: 'connected', config: {} }
  const pending = { name: 'pending', type: 'pending', config: {} }
  const clients = [allowed, blocked, pending]
  const context = { getAppState: () => ({ mcp: { clients } }), setAppState: vi.fn() }
  const Mc = vi.fn((name: string) => name === 'managed' ? null : 'managed-policy')
  const mark = vi.fn((name: string) => clients.splice(clients.findIndex(client => client.name === name), 1))
  const detach = vi.fn(async () => { expect(clients).not.toContain(blocked) })
  const over = vi.fn(() => ({ get: () => ({ clients }), markReconnectDiscarded: mark }))
  const load = vi.fn(async (name: string) => name === 'chunk-z0mpv66t.js'
    ? { knt: { over } }
    : { mcpClientModule: () => ({ detachAndCloseConnection: detach }) })
  const retire = new Function('importClaudeNativeModule', rewriteClaudeNativePlatformSelectors(claudeTerminalMcpPolicyRuntime)
    + '\nreturn retireNativePolicyBlockedMcpConnections')(load)
  return { allowed, blocked, pending, clients, context, Mc, mark, detach, over, load,
    run: (isCurrent = () => true) => retire({ runtime: { Mc } }, context, isCurrent) }
}

it('lets original policy retire only refused live connections and detaches after withdrawal', async () => {
  const f = fixture()
  await f.run()
  await f.run()
  expect(f.clients).toEqual([f.allowed, f.pending])
  expect(f.over).toHaveBeenCalledWith({ getState: f.context.getAppState, setState: f.context.setAppState })
  expect(f.mark).toHaveBeenCalledExactlyOnceWith(f.blocked.name, f.blocked.config)
  expect(f.detach).toHaveBeenCalledExactlyOnceWith(f.blocked)
})

it('skips untouched policy and rechecks owner and policy before changing native state', async () => {
  const f = fixture()
  f.Mc.mockReturnValue(null)
  await f.run()
  expect(f.load).not.toHaveBeenCalled()

  f.Mc.mockReturnValue('managed-policy')
  await f.run(() => false)
  expect(f.over).not.toHaveBeenCalled()

  f.load.mockImplementationOnce(async () => {
    f.Mc.mockReturnValue(null)
    return { knt: { over: f.over } }
  })
  await f.run()
  expect(f.mark).not.toHaveBeenCalled()
  expect(f.detach).not.toHaveBeenCalled()
})
