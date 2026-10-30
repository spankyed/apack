import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalLeftArrowRuntime } from '#features/code/be/services/claude-code/terminal-leftarrow-runtime.ts'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
function fixture() {
  function Dr() {}
  class j1 { pending = false; isParkInFlight() { return this.pending } }
  const hash = createHash('sha256').update(String(Dr)).digest('hex')
  const handler = vi.fn(), callback = vi.fn(), props = { value: '', onLeftArrowOnEmpty: callback, focus: true }
  const input = { offset: 0, handleKeyDown: handler }, row = Array(58)
  row[47] = { value: '', onLeftArrowOnEmpty: callback }; row[53] = input; row[54] = { props: { inputState: input, onLeftArrowOnEmpty: callback } }
  const controller = new j1()
  const ownerRow = Array(342); ownerRow[259] = controller; ownerRow[337] = controller; ownerRow[341] = { gesture: controller }
  const root = { return: { updateQueue: { memoCache: { data: [ownerRow] } } }, type: Dr, memoizedProps: props, updateQueue: { memoCache: { data: [row] } } }
  const edit = { box: { text: '', cursor: 0 }, active: undefined as unknown, waiting: [] as unknown[] }, edits = new Map([['client', edit]])
  const facts = { sessionId: 'session', sequence: 1, view: { kind: 'main' } }, clients = new Set(['client']), dialogs: unknown[] = []
  const gate = vi.fn(async () => {}), binding = { toolContext: () => ({ dialogStore: { getState: () => ({ open: dialogs }) } }) }
  const n = { questionOptions: { q: () => 'session' }, runtime: { ey: () => binding }, gate: { _Jo: gate }, themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, nativeKeyEvents: { zDe: class { constructor(value: unknown, metadata?: { soloKeypress?: boolean }) { Object.assign(this, value, metadata) } } } }
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalLeftArrowRuntime) + ';({press:dispatchNativeAgentsGesture,park:nativeAgentsParkState})', { originalContext: binding, AbortController, process: { stdout: undefined }, createHash, composerFunctionHashes: new WeakMap(), nativeFunctionName: (name: string) => name, nativeFunctionHash: (value: string) => value === '0c022fe3a5b853cbf1707808364eaafa917d49195c7f0d253b99b03fff334226' ? createHash('sha256').update(String(j1)).digest('hex') : hash, configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId: 'session' }), clients, clientViewCurrent: () => true, nativeViewFacts: () => ({ ...facts, view: { ...facts.view } }), edits })
  return { runtime, n, root, ownerRow, controller, handler, props, input, row, edit, facts, clients, dialogs, gate, request: (sequence = 1) => ({ client_id: 'client', sequence }) }
}
it('delivers ordered original left keys and refuses a duplicated delivery', async () => {
  const f = fixture(); await expect(f.runtime.press(f.n, f.request())).resolves.toEqual({ handled: true })
  await expect(f.runtime.press(f.n, f.request())).resolves.toEqual({ handled: false })
  await f.runtime.press(f.n, f.request(2)); expect(f.handler).toHaveBeenCalledTimes(2)
  expect(f.handler.mock.calls[0][0]).toMatchObject({ soloKeypress: true, name: 'left', sequence: '\x1b[D', ctrl: false, shift: false, meta: false, super: false, fn: false })
})
it.each(['draft', 'edit', 'waiting', 'dialog', 'offset', 'native-draft'])('does not synthesize admission with %s', async reason => {
  const f = fixture()
  if (reason === 'draft') f.edit.box.text = 'Keep this draft'
  if (reason === 'edit') f.edit.active = new AbortController()
  if (reason === 'waiting') f.edit.waiting.push({})
  if (reason === 'dialog') f.dialogs.push({ kind: 'question' })
  if (reason === 'offset') f.input.offset = 1
  if (reason === 'native-draft') f.props.value = 'Native text'
  await expect(f.runtime.press(f.n, f.request())).resolves.toEqual({ handled: false }); expect(f.handler).not.toHaveBeenCalled()
})
it('keeps native policy refusal and repeats client/view/draft checks after its await', async () => {
  const f = fixture(); f.gate.mockRejectedValueOnce(new Error('Native policy refusal'))
  await expect(f.runtime.press(f.n, f.request())).rejects.toThrow('Native policy refusal'); expect(f.handler).not.toHaveBeenCalled()
  f.gate.mockImplementationOnce(async () => { f.facts.view.kind = 'agent' })
  await expect(f.runtime.press(f.n, f.request(2))).rejects.toThrow('conversation changed'); expect(f.handler).not.toHaveBeenCalled()
})
it('refuses detached clients and input callbacks replaced during admission', async () => {
  const f = fixture(); f.clients.clear(); await expect(f.runtime.press(f.n, f.request())).rejects.toThrow('detached')
  f.clients.add('client'); f.gate.mockImplementationOnce(async () => { f.row[54].props.inputState = {} })
  await expect(f.runtime.press(f.n, f.request(2))).rejects.toThrow('callbacks changed'); expect(f.handler).not.toHaveBeenCalled()
})

it('reads original review/fork progress without inventing a process exit or timeout', async () => {
  const f = fixture(); expect(f.runtime.park(f.n)).toBe(false)
  f.handler.mockImplementationOnce(() => { f.controller.pending = true })
  await f.runtime.press(f.n, f.request()); expect(f.runtime.park(f.n)).toBe(true)
  f.controller.pending = false; expect(f.runtime.park(f.n)).toBe(false)
})

it('requires the original owner cache relationships instead of scanning unrelated hook lists', async () => {
  const f = fixture(); f.ownerRow[341] = { gesture: {} }
  await expect(f.runtime.press(f.n, f.request())).rejects.toThrow('controller unavailable'); expect(f.handler).not.toHaveBeenCalled()
})
