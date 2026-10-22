import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalGenericPermissionRuntime } from '#features/code/be/services/claude-code/terminal-generic-permission-runtime.ts'

/** Mock native contracts prove adapter guards, never original CLI or app acceptance. */
function fixture(card = false) {
  function ozr() {} function qJ() {} function Box() {} function Dialog() {}
  const payload = { toolName: 'mcp__research__echo', isMcp: true }
  const item = { id: 'original', kind: 'permission_prompt', payload }, open = [item]
  const dialog = { item, payload, revision: randomUUID(), sessionId: randomUUID(), store: { getState: () => ({ open }) } }
  let current = dialog, ready = true, refuse = false
  const select = vi.fn(() => { if (refuse) return false; open.splice(0); return true })
  const options = [
    { value: 'yes', label: 'Yes', feedbackConfig: { type: 'accept' } },
    { value: 'yes-dont-ask-again', label: 'Original standing grant' },
    { value: 'yes-enable-auto-mode', label: 'Original auto mode', description: 'Original native mode explanation' },
    { value: 'no', label: 'No', feedbackConfig: { type: 'reject' } },
  ]
  const control = { options, onSelect: select }, cache = new Array(155)
  cache[65] = 'Original full description\nwith a second line'
  cache[123] = 'echo Tool: (MCP)'
  cache[129] = 'message: "Release notes"'
  cache[151] = { props: { title: 'Tool use' } }
  cache[154] = { type: Box, props: {} }
  cache[107] = { type: Dialog, props: { title: 'Original permission card?' } }
  cache[90] = 'Original native card rows'
  const root = card ? cache[107] : cache[154]
  const fiber = { type: ozr, memoizedProps: { payload, wouldTakeAnswer: () => ready }, updateQueue: { memoCache: { data: [cache] } }, child: { type: root.type, memoizedProps: root.props, child: { type: qJ, memoizedProps: control } } }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: fiber } }]]) } }
  const hash = (text: string) => createHash('sha256').update(text).digest('hex')
  const fingerprints = new Map([
    ['063b997d50194fb47258b9acc04548bd0e708eab1fec57435264219335afdc73', hash(ozr.toString())],
    ['5602da1d16eb7bb040b568afe7012d87d13436e6ffeef266609a9ae1d127b51b', hash(qJ.toString())],
  ])
  const runtime = vm.runInNewContext(rewriteClaudeNativePlatformSelectors(claudeTerminalGenericPermissionRuntime) + ';({choices:nativeGenericPermissionChoices,answer:answerNativeGenericPermissionChoice})', {
    process: { stdout: undefined }, createHash, stripVTControlCharacters, composerFunctionHashes: new WeakMap(), setTimeout,
    nativeFunctionName: (name: string) => name,
    nativeFunctionHash: (key: string) => { const value = fingerprints.get(key); if (!value) throw Error('Unreviewed native producer fingerprint'); return value },
    nativeDialog: () => current,
  })
  return { n, runtime, dialog, cache, fiber, options, select, open, setReady(value: boolean) { ready = value }, refuse() { refuse = true }, replace() { current = { ...dialog, item: { ...item }, revision: randomUUID() } } }
}
const response = (f: ReturnType<typeof fixture>, token: string, choice = 'yes', decision = 'allow', feedback?: string) => ({ toolName: f.dialog.payload.toolName, choiceToken: token, choice, decision, ...(feedback === undefined ? {} : { feedback }) })

it('borrows the original formatted MCP parameters/full description and original callback choices', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  expect(shown.ready).toBe(true)
  expect(shown.details.map((row: { value: string }) => row.value)).toEqual([f.cache[123], f.cache[129], f.cache[65]])
  expect(shown.choiceDescriptions['yes-enable-auto-mode']).toBe('Original native mode explanation')
  await f.runtime.answer(f.n, f.dialog, response(f, shown.token, 'yes', 'allow', 'Review the release notes first.'))
  expect(f.select.mock.calls[0]).toEqual(['yes', 'Review the release notes first.'])
  expect(f.open).toHaveLength(0)
})
it.each(['yes-dont-ask-again', 'yes-enable-auto-mode'])('leaves offered %s effects entirely to the original callback', async choice => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  await f.runtime.answer(f.n, f.dialog, response(f, shown.token, choice))
  expect(f.select.mock.calls[0]).toEqual([choice, undefined])
})
it('preserves the original permission-card branch without substituting raw input', async () => {
  const f = fixture(true), shown = await f.runtime.choices(f.n, f.dialog)
  expect(shown.title).toBe('Original permission card?')
  expect(shown.details).toEqual([{ label: 'Request', value: 'Original native card rows' }])
})
it('retains original withholding and does not manufacture a missing standing option', async () => {
  const f = fixture(); f.cache[129] = '(value of 200289 characters cannot be shown — deny unless expected)'; f.options.splice(1, 2)
  const shown = await f.runtime.choices(f.n, f.dialog)
  expect(shown.details.some((row: { value: string }) => row.value.includes('cannot be shown'))).toBe(true)
  expect(shown.choices.map((row: { value: string }) => row.value)).toEqual(['yes', 'no'])
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token, 'yes-dont-ask-again'))).rejects.toThrow('Invalid')
  expect(f.select).not.toHaveBeenCalled()
})
it('refuses stale previews, wrong tool identities and contradictory decision envelopes', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  await expect(f.runtime.answer(f.n, f.dialog, { ...response(f, shown.token), toolName: 'another-tool' })).rejects.toThrow('Invalid')
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token, 'no', 'allow'))).rejects.toThrow('Invalid')
  f.cache[129] = 'Original preview changed'
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token))).rejects.toThrow('changed')
  expect(f.select).not.toHaveBeenCalled()
})
it('refuses missing original preview, unknown choices and replaced native dialogs', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  f.replace()
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token))).rejects.toThrow('expired')
  f.fiber.child.memoizedProps = {}
  expect((await f.runtime.choices(f.n, f.dialog)).ready).toBe(false)
  f.options.push({ value: 'unknown', label: 'Unknown' })
  await expect(f.runtime.choices(f.n, f.dialog)).rejects.toThrow('Unknown')
  expect(f.select).not.toHaveBeenCalled()
})
it('honors native readiness/refusal and rejects feedback on standing choices', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  f.setReady(false)
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token))).rejects.toThrow('not ready')
  f.setReady(true)
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token, 'yes-dont-ask-again', 'allow', 'Not supported'))).rejects.toThrow('Unsupported')
  f.refuse()
  await expect(f.runtime.answer(f.n, f.dialog, response(f, shown.token, 'no', 'deny', 'Keep the release notes private.'))).rejects.toThrow('refused')
  expect(f.open).toHaveLength(1)
})
