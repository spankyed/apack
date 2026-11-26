import { expect, it, vi } from 'vitest'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalMcpPolicyRuntime } from '#features/code/be/services/claude-code/terminal-mcp-policy-runtime.ts'

function fixture() {
  const allowed = { name: 'managed', type: 'connected', config: {} }
  const blocked = { name: 'local', type: 'connected', config: {}, client: {} }
  const pending = { name: 'pending', type: 'pending', config: {} }
  const clients = [allowed, blocked, pending]
  const context = { getAppState: () => ({ mcp: { clients } }), setAppState: vi.fn() }
  const mcpChannelBlocked = vi.fn(() => false)
  const Mc = vi.fn((name: string) => name === 'managed' ? null : 'managed-policy')
  const mark = vi.fn((name: string) => clients.splice(clients.findIndex(client => client.name === name), 1))
  const detach = vi.fn(async () => { expect(clients).not.toContain(blocked) })
  const cache = new Map<string, Promise<unknown>>()
  const dispose = vi.fn((name: string, _config: object, expected: Promise<unknown>) => {
    if (cache.get(name) === expected) cache.delete(name)
  })
  const over = vi.fn(() => ({ get: () => ({ clients }), markReconnectDiscarded: mark }))
  let observer: (connection: unknown) => void = vi.fn()
  const originalObserver = observer
  const wiring = { chn: () => observer, kbt: vi.fn((next: typeof observer) => { observer = next }) }
  const load = vi.fn(async (name: string) => {
    if (name === 'chunk-hdxpvbx1.js') return wiring
    if (name === 'chunk-z0mpv66t.js') return { knt: { over } }
    if (name === 'chunk-kkq7q3vx.js') return { Jn: (serverName: string) => serverName }
    return { mcpClientModule: () => ({
      detachAndCloseConnection: detach,
      connectToServer: { cache },
      peekSettledConnection: (name: string) => Promise.race([cache.get(name), Promise.resolve(undefined)]),
      disposeServerConnectionDetached: dispose,
    }) }
  })
  const retire = new Function('importClaudeNativeModule', rewriteClaudeNativePlatformSelectors(claudeTerminalMcpPolicyRuntime)
    + '\nreturn retireNativePolicyBlockedMcpConnections')(load)
  return { allowed, blocked, pending, clients, context, Mc, mark, detach, cache, dispose, over, load, wiring, originalObserver, mcpChannelBlocked,
    run: (isCurrent = () => true) => retire({ runtime: { Mc }, mcpChannelBlocked }, context, isCurrent) }
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

it('disposes the exact cached dial so native policy restoration can reconnect', async () => {
  const f = fixture()
  const cached = Promise.resolve({ ...f.blocked })
  f.cache.set(f.blocked.name, cached)
  await f.run()
  expect(f.dispose).toHaveBeenCalledExactlyOnceWith(f.blocked.name, f.blocked.config, cached)
  expect(f.cache.has(f.blocked.name)).toBe(false)
  expect(f.detach).not.toHaveBeenCalled()
})

it('leaves a concurrently replaced cached dial alone', async () => {
  const f = fixture()
  const replacement = Promise.resolve({ ...f.blocked, client: {} })
  const cached = Promise.resolve(f.blocked)
  const get = f.cache.get.bind(f.cache)
  vi.spyOn(f.cache, 'get').mockImplementationOnce(name => {
    queueMicrotask(() => { f.cache.set(f.blocked.name, replacement) })
    return get(name)
  })
  f.cache.set(f.blocked.name, cached)
  await f.run()
  expect(f.cache.get(f.blocked.name)).toBe(replacement)
  expect(f.dispose).not.toHaveBeenCalled()
  expect(f.detach).toHaveBeenCalledExactlyOnceWith(f.blocked)
})

it('does not wait for an unrelated unfinished dial to close the refused live client', async () => {
  const f = fixture()
  const pending = new Promise(() => {})
  f.cache.set(f.blocked.name, pending)
  await f.run()
  expect(f.cache.get(f.blocked.name)).toBe(pending)
  expect(f.dispose).not.toHaveBeenCalled()
  expect(f.detach).toHaveBeenCalledExactlyOnceWith(f.blocked)
})

it('skips untouched policy and rechecks owner and policy before changing native state', async () => {
  const f = fixture()
  f.Mc.mockReturnValue(null)
  await f.run()
  expect(f.load.mock.calls.map(([name]) => name)).toEqual(['chunk-hdxpvbx1.js'])

  f.Mc.mockReturnValue('managed-policy')
  await f.run(() => false)
  expect(f.over).not.toHaveBeenCalled()

  const load = f.load.getMockImplementation()!
  f.load.mockImplementation(async name => {
    if (name === 'chunk-z0mpv66t.js') f.Mc.mockReturnValue(null)
    return load(name)
  })
  await f.run()
  expect(f.mark).not.toHaveBeenCalled()
  expect(f.detach).not.toHaveBeenCalled()
})

it.each(['legacy', 'modern'])('cancels a revoked client before close while preserving %s calls on eligible peers', async dialect => {
  const f = fixture()
  f.Mc.mockReturnValue(null)
  await f.run()

  const pending = (options: { signal: AbortSignal }) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  })
  const addPeer = (name: string) => {
    const callTool = vi.fn((...args: any[]) => pending(args.at(-1)))
    const connection = { name, type: 'connected', config: { type: 'http' }, client: { callTool } }
    f.wiring.chn()(connection)
    f.clients.push(connection)
    return { connection, callTool }
  }
  const revoked = addPeer('revoked')
  const allowed = addPeer('eligible')
  const caller = new AbortController()
  const originalOptions = { signal: caller.signal, timeout: 100 }
  const args = dialect === 'legacy'
    ? [{ name: 'echo' }, { schema: true }, originalOptions]
    : [{ name: 'echo' }, originalOptions]
  const revokedOutcome = revoked.connection.client.callTool(...args)
    .catch(reason => reason)
  const allowedOutcome = allowed.connection.client.callTool(...args)
    .catch(reason => reason)
  f.Mc.mockImplementation(name => name === 'revoked' ? 'managed-policy' : null)
  f.detach.mockImplementation(async () => {
    expect(revoked.callTool.mock.calls[0]!.at(-1).signal.aborted).toBe(true)
    expect(allowed.callTool.mock.calls[0]!.at(-1).signal.aborted).toBe(false)
  })
  await f.run()
  expect(await revokedOutcome).toMatchObject({ message: expect.stringContaining('revoked by managed policy') })
  expect(f.originalObserver).toHaveBeenCalledWith(revoked.connection)
  expect(f.originalObserver).toHaveBeenCalledWith(allowed.connection)
  expect(f.wiring.kbt).toHaveBeenCalledTimes(1)
  expect(revoked.callTool.mock.calls[0]!.at(-1).timeout).toBe(100)
  expect(originalOptions.signal.aborted).toBe(false)
  caller.abort(Error('Caller cancelled'))
  expect(await allowedOutcome).toMatchObject({ message: 'Caller cancelled' })
})

it('applies current original channel policy to installed and re-registered native callbacks', async () => {
  const f = fixture()
  f.Mc.mockReturnValue(null)
  const ingress = 'notifications/claude/channel'
  const relay = 'notifications/claude/channel/permission'
  const unrelated = 'notifications/tools/list_changed'
  const inbound = vi.fn(), priorRelay = vi.fn(), nextRelay = vi.fn(), unrelatedHandler = vi.fn()
  const handlers = new Map([[ingress, inbound], [relay, priorRelay], [unrelated, unrelatedHandler]])
  const client = {
    _notificationHandlers: handlers,
    setNotificationHandler(method: string, callback: typeof priorRelay) {
      this._notificationHandlers.set(method, callback)
    },
  }
  const connection = { name: 'channel', type: 'connected', config: {}, client,
    capabilities: { experimental: { 'claude/channel': {}, 'claude/channel/permission': {} } } }
  f.clients.push(connection)
  await f.run()
  handlers.get(ingress)!('original')
  expect(inbound).toHaveBeenCalledExactlyOnceWith('original')

  // The policy reader is called at delivery without another owner snapshot.
  f.mcpChannelBlocked.mockReturnValue(true)
  handlers.get(ingress)!('restricted')
  handlers.get(relay)!('restricted')
  client.setNotificationHandler(relay, nextRelay)
  handlers.get(relay)!('still restricted')
  handlers.get(unrelated)!('unrelated')
  expect(inbound).toHaveBeenCalledTimes(1)
  expect(priorRelay).not.toHaveBeenCalled()
  expect(nextRelay).not.toHaveBeenCalled()
  expect(unrelatedHandler).toHaveBeenCalledExactlyOnceWith('unrelated')

  f.mcpChannelBlocked.mockReturnValue(false)
  handlers.get(relay)!('restored')
  expect(nextRelay).toHaveBeenCalledExactlyOnceWith('restored')
})
