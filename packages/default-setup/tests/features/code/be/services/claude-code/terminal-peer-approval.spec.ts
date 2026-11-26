import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalPeerApprovalRuntime } from '#features/code/be/services/claude-code/terminal-peer-approval-runtime.ts'
import { ClaudeNativeNoticeSchema } from '#features/code/common/native-notice.ts'

function fixture() {
  const sessionId = randomUUID()
  const payload = { holdCause: 'mode-mismatch', preview: 'Line 1\n<span>Line 2</span>\x1b[0m' }
  const item = { id: randomUUID(), kind: 'peer_inbound_approval', payload }
  const open = [item]
  const wCe = () => {}, Select = () => {}
  const onChange = vi.fn((_decision: string) => { open.shift() })
  const onCancel = vi.fn(() => { open.shift() })
  const control = {
    onChange, onCancel, refuseInput: vi.fn(() => false), defaultFocusValue: 'deny',
    options: [{ value: 'deny', label: 'Deny' }, { value: 'approve', label: 'Deliver this message to Claude' }],
  }
  const row = Array(37).fill(undefined)
  row[8] = 'From uds:sender [verified pid 17] (peer claims name: Name)'
  row[12] = 'The sending session’s permission mode class does not match.'
  row[14] = 'Message body'
  row[29] = { type: Select, props: control }
  row[36] = { props: { title: 'Held message from another session' } }
  const child = { type: Select, memoizedProps: control }
  const root = { type: wCe, memoizedProps: { payload }, updateQueue: { memoCache: { data: [row] } }, child }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: root } }]]) }, questionOptions: { q: () => sessionId } }
  const source = rewriteClaudeNativePlatformSelectors(claudeTerminalPeerApprovalRuntime)
  const runtime = vm.runInNewContext(source + ';({read:nativePeerApproval,project:projectNativePeerApproval,answer:answerNativePeerApproval})', {
    originalContext: { surface: 'terminal', toolContext: () => ({ dialogStore: { getState: () => ({ open }) } }) },
    AbortController, process: { stdout: undefined }, composerFunctionHashes: new WeakMap(), createHash,
    nativeFunctionName: (name: string) => name === 'nCe' ? 'wCe' : name,
    nativeFunctionHash: () => createHash('sha256').update(wCe.toString()).digest('hex'),
    configUrl: 'private', readFileSync: () => JSON.stringify({ sessionId }), randomUUID, dialogRevisions: new Map(),
    nativeGenericPermissionText: async (_n: unknown, text: string) => text,
    stripVTControlCharacters,
  })
  const request = (decision: string) => ({ id: item.id, revision: runtime.read(n).revision, session_id: sessionId, decision })
  return { runtime, n, open, item, child, control, request, onChange, onCancel }
}

it.each([
  ['peer_deny', 'deny'], ['peer_deliver', 'approve'], ['peer_cancel', undefined],
])('dispatches %s exactly once to the live original Select', async (decision, expected) => {
  const f = fixture()
  f.open.push({ ...f.item, id: randomUUID(), payload: { ...f.item.payload } })
  const notice = ClaudeNativeNoticeSchema.parse(await f.runtime.project(f.n, f.runtime.read(f.n)))
  expect(notice).toMatchObject({ message: 'Line 1\n<span>Line 2</span>', paragraphs: [expect.stringContaining('[verified pid 17]'), expect.any(String), 'Message body'] })
  const request = f.request(decision)
  f.runtime.answer(f.n, request)
  if (expected) expect(f.onChange).toHaveBeenCalledExactlyOnceWith(expected)
  else expect(f.onCancel).toHaveBeenCalledExactlyOnceWith()
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.onChange.mock.calls.length + f.onCancel.mock.calls.length).toBe(1)
})

it('keeps refusal grace and refuses a control or session that has retired', () => {
  const f = fixture(), request = f.request('peer_deliver')
  f.control.refuseInput.mockReturnValue(true)
  expect(() => f.runtime.answer(f.n, request)).toThrow('temporarily refused')
  f.control.refuseInput.mockReturnValue(false)
  expect(() => f.runtime.answer(f.n, { ...request, session_id: randomUUID() })).toThrow('expired')
  f.child.memoizedProps = { ...f.control }
  expect(() => f.runtime.answer(f.n, request)).toThrow('expired')
  expect(f.onChange).not.toHaveBeenCalled()
})
