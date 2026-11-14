import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

// Execute only our observer loop against authored doubles, never recovered Claude source.
function fixture(options: { unchanged?: boolean; snapshotChanged?: boolean; refused?: boolean } = {}) {
  const oldSession = '11111111-1111-4111-8111-111111111111', nextSession = '22222222-2222-4222-8222-222222222222'
  let configured = oldSession, tick!: () => Promise<void>
  const calls: string[] = [], gate = { sessionId: options.unchanged ? oldSession : nextSession, view: { kind: 'main' }, sequence: 2 }
  const snapshot = { ...gate, sessionId: options.snapshotChanged ? '33333333-3333-4333-8333-333333333333' : gate.sessionId, taskFacts: [], busy: false, turn: null }
  const control = vi.fn(async (request: any) => { calls.push(request.policy_only ? 'gate' : 'snapshot'); return request.policy_only ? gate : snapshot })
  const post = vi.fn(async (path: string, body: any) => {
    calls.push(path)
    if (path === '/poll') { if (options.refused) throw Error('refused'); configured = body.sessionId; return {} }
    if (path === '/native-view') { if (body.sessionId !== configured) throw Error('wrong session'); throw Error('stop after view boundary') }
    return {}
  })
  const start = claudeTerminalUiRuntime.indexOf('let ownerReading=false'), end = claudeTerminalUiRuntime.indexOf('ownerTimer.unref();', start) + 'ownerTimer.unref();'.length
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  new Function('readFileSync', 'configUrl', 'control', 'ownerPost', 'ownerAgents', 'setInterval', 'AbortController', 'process', claudeTerminalUiRuntime.slice(start, end))(
    () => JSON.stringify({ sessionId: configured }), 'observer.json', control, post, () => [], (callback: () => Promise<void>) => { tick = callback; return { unref() {} } }, AbortController, { pid: 123 },
  )
  return { tick: () => tick(), calls, post, control, configured: () => configured, oldSession, nextSession }
}
it('admits the original new session before publishing its view', async () => {
  const f = fixture(); await f.tick()
  expect(f.calls).toEqual(['gate', 'snapshot', '/poll', '/native-view'])
  expect(f.configured()).toBe(f.nextSession)
  expect(f.post.mock.calls[0]).toEqual(['/poll', expect.objectContaining({ sessionId: f.nextSession, directOwner: true, agents: [], busy: false, turn: null })])
})
it('keeps unchanged plugin-owned sessions on their existing publication path', async () => {
  const f = fixture({ unchanged: true }); await f.tick()
  expect(f.calls).toEqual(['gate', '/native-view']); expect(f.configured()).toBe(f.oldSession)
})
it('does not publish or admit a second session change during the handoff read', async () => {
  const f = fixture({ snapshotChanged: true }); await f.tick()
  expect(f.calls).toEqual(['gate', 'snapshot']); expect(f.configured()).toBe(f.oldSession)
})
it('does not publish the new view when its broker handoff is refused', async () => {
  const f = fixture({ refused: true }); await f.tick()
  expect(f.calls).toEqual(['gate', 'snapshot', '/poll']); expect(f.configured()).toBe(f.oldSession)
})
