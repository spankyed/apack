import { runInNewContext } from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalMcpFormRuntime } from '#features/code/be/services/claude-code/terminal-mcp-form-runtime.ts'
import { claudeTerminalMcpUrlRuntime } from '#features/code/be/services/claude-code/terminal-mcp-url-runtime.ts'
function fixture(manual = false) {
  function ZCo() {} function e_o() {} function t_o() {} function tke() {} function Panel() {} function Box() {}
  const sessionId = randomUUID(), payload = { serverName: 'research', params: { mode: 'url', message: 'Review', url: 'https://example.invalid/review' } }
  let item = { id: 'original', kind: 'mcp_elicitation', payload }, open = [item], ready = true, phase = 'prompt', selected = manual ? 'open' : 'accept', refused = false, opens = 0
  const url = { type: tke, memoizedProps: { userConfirmsCompletion: manual, waitingState: { actionLabel: 'Skip confirmation' } }, child: {} as any }
  const root = { type: ZCo, memoizedProps: { payload, wouldTakeAnswer: () => ready }, child: url }
  const cancel = vi.fn(() => { open = [] })
  function paint() {
    const choices = phase === 'waiting' ? [['open', ' Reopen URL '], ['continue', ' Skip confirmation']] : manual ? [['open', ' Open in browser '], ['accept', " I'm done, continue "], ['decline', ' Decline']] : [['accept', ' Accept  '], ['decline', ' Decline']]
    const labels = choices.map(([operation, label]) => ({ type: 'text', memoizedProps: { children: label, bold: selected === operation, color: operation === 'decline' ? 'error' : 'success' } }))
    for (let i = 0; i < labels.length - 1; i++) (labels[i] as any).sibling = labels[i + 1]
    url.child = { type: Panel, memoizedProps: { title: phase === 'waiting' ? 'MCP server “research” — waiting for completion' : 'MCP server “research” wants to open a URL', onCancel: cancel }, child: { type: Box, memoizedProps: { onKeyDown: key }, child: labels[0] } }
  }
  const key = vi.fn((event: { key: string }) => {
    const choices = phase === 'waiting' ? ['open', 'continue'] : manual ? ['open', 'accept', 'decline'] : ['accept', 'decline']
    if (event.key === 'right') selected = choices[(choices.indexOf(selected) + 1) % choices.length]
    if (event.key === 'return' && !refused) {
      if (selected === 'open') opens++
      else if (selected === 'accept' && !manual) { opens++; phase = 'waiting'; selected = 'open' }
      else open = []
    }
    paint()
  })
  paint()
  const cache = new WeakMap<Function, string>([[ZCo, '275d086d7b1ac78d0b4b1939853b2a4fe61e3bc9062ab8c6e7fb281589c3c2db'], [e_o, '72bb984b5b6cf53a450e67dd52de7baf2f73defd50f4d9072e90c0699bd692cc'], [t_o, '77f448ae7516bdbfe0eb0551bad38f50cc372347ef95beaf2a87b9d6a8fdcdcc'], [tke, '72edfab66d939fee12559ff708e9fa21a67c9cceb84a7937b7c1b0d994c7a747'], [key, '552e78fe6f71f1e00ff8623b17c2a438cad341a521d8612d80f291b28ac62c2d']])
  const store = { getState: () => ({ open }) }, n = { mcpInputTiming: { AM: 0 }, runtime: { ey: () => ({ surface: 'terminal', toolContext: () => ({ dialogStore: store }) }) }, questionOptions: { q: () => sessionId }, themeRoots: { ai: () => new Map([['stdout', { container: { current: root } }]]) } }
  const api = runInNewContext(claudeTerminalMcpFormRuntime + claudeTerminalMcpUrlRuntime + '\n({dialog:nativeMcpDialog,presentation:nativeMcpUrlPresentation,operate:operateNativeMcpUrl})', { AbortController, originalContext: undefined, readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'config', dialogRevisions: new Map(), createHash, randomUUID, composerFunctionHashes: cache, nativeFunctionName: (name: string) => name, process: { stdout: 'stdout' }, setTimeout })
  const show = () => api.presentation(n, api.dialog(n, 'url'))
  const operate = (operation: string, overrides = {}) => { const view = show(); return api.operate(n, { id: view.id, revision: view.revision, session_id: sessionId, token: view.token, action: { operation }, ...overrides }, new AbortController().signal) }
  return { show, operate, key, cancel, root, cache, tke, get opens() { return opens }, refuse() { refused = true }, setReady(value: boolean) { ready = value }, replace() { item = { ...item }; open = [item] }, waiting() { phase = 'waiting'; selected = 'open'; item.kind = 'mcp_elicitation_waiting'; root.type = e_o; paint() } }
}
it('preserves original accept/open/waiting distinctions instead of manufacturing a completed answer', async () => {
  const f = fixture(); const prompt = f.show(); expect(prompt.phase).toBe('prompt'); expect(prompt.choices.map((row: any) => row.operation)).toEqual(['accept', 'decline'])
  const waiting = await f.operate('accept'); expect(waiting.settled).toBe(false); expect(waiting.url.phase).toBe('waiting'); expect(f.opens).toBe(1)
  await f.operate('open'); expect(f.opens).toBe(2)
  expect((await f.operate('continue')).settled).toBe(true); expect(f.cancel).not.toHaveBeenCalled()
})
it('keeps manual browser opening separate from original explicit user confirmation', async () => {
  const f = fixture(true); expect((await f.operate('open')).settled).toBe(false); expect(f.opens).toBe(1)
  expect((await f.operate('accept')).settled).toBe(true); expect(f.opens).toBe(1)
})
it.each(['decline', 'cancel'])('routes %s through original controls without opening a URL', async operation => {
  const f = fixture(); expect((await f.operate(operation)).settled).toBe(true); expect(f.opens).toBe(0)
  expect(f.cancel).toHaveBeenCalledTimes(operation === 'cancel' ? 1 : 0)
})
it('retains an original refusal and refuses unavailable choices and stale/replaced requests', async () => {
  const f = fixture(); await expect(f.operate('open')).rejects.toThrow('unavailable'); expect(f.key).not.toHaveBeenCalled()
  await expect(f.operate('accept', { token: '0'.repeat(64) })).rejects.toThrow('changed')
  f.refuse(); expect((await f.operate('accept')).settled).toBe(false); expect(f.opens).toBe(0)
  f.key.mockImplementationOnce(() => f.replace()); await expect(f.operate('decline')).rejects.toThrow('expired')
})
it('uses the separately mounted waiting wrapper and preserves its original cancellation', async () => {
  const f = fixture(); f.waiting(); expect(f.show().kind).toBe('mcp_elicitation_waiting'); expect((await f.operate('cancel')).settled).toBe(true); expect(f.cancel).toHaveBeenCalledOnce()
})
it('refuses unready or changed original renderers before any native action', async () => {
  const f = fixture(); f.setReady(false); await expect(f.operate('cancel')).rejects.toThrow('not ready'); f.setReady(true)
  f.cache.set(f.tke, 'changed'); expect(() => f.show()).toThrow('renderer changed'); expect(f.cancel).not.toHaveBeenCalled(); expect(f.opens).toBe(0)
})
