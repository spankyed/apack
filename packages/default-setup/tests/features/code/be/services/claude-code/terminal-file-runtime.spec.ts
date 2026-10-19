import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalFileRuntime } from '#features/code/be/services/claude-code/terminal-file-runtime.ts'

function fixture() {
  const stdout = {}, payload = { input: { file_path: '/private/fixture', content: 'Original input' } }, item = { payload }, open = [item], calls: unknown[] = []
  let ready = true, revision = 'original', feedback = ''
  const setter = (value: string) => { feedback = value; fiber.memoizedState.memoizedState = value }
  const control = { options: [
    { value: 'yes', label: 'Yes', option: { type: 'accept-once' } },
    { value: 'yes-session', label: { native: 'label' }, option: { type: 'accept-session', row: { applies: [{ type: 'setMode', mode: 'acceptEdits' }] } } },
    { value: 'no', label: 'No', option: { type: 'reject' } },
  ] as any[], onInputModeToggle(value: string) { const option = control.options.find(option => option.value === value)!; option.type = 'input'; option.onChange = setter },
  onChange(value: string) { calls.push({ value, feedback, input: payload.input }); open.splice(0); return true } }
  const fiber = { type: function Sat() {}, memoizedProps: { payload, wouldTakeAnswer: () => ready }, memoizedState: { memoizedState: '', queue: { dispatch: setter }, next: null }, child: { type: function Xe() {}, memoizedProps: control } }
  const d = { payload, item, revision, store: { getState: () => ({ open }) } }
  const n = { themeRoots: { ai: () => new Map([[stdout, { container: { current: fiber } }]]) }, staticRender: { $bn: vi.fn(async () => 'Original session grant') }, jsx: { e: (_type: unknown, props: unknown) => props } }
  const crypto = () => { let data = ''; return { update(value: string) { data += value; return this }, digest() { return data.startsWith('function Sat') ? '4d3297fd160d4c1497f0a21f0f98372ea53943f0e951256c3fbd8ac13dd5b406' : createHash('sha256').update(data).digest('hex') } } }
  const api = vm.runInNewContext(claudeTerminalFileRuntime + ';({nativeFileChoices,answerNativeFileChoice})', { process: { stdout }, composerFunctionHashes: new WeakMap(), createHash: crypto, nativeThemeProvider: () => ({ type: 'original theme', value: {} }), nativeDialog: () => ({ ...d, revision }), setTimeout, Promise })
  return { n, d, api, calls, control, payload, setter, ready(value: boolean) { ready = value }, revision(value: string) { revision = value } }
}
it('uses original offered labels and callbacks without constructing permission updates or changing tool input', async () => {
  const f = fixture(), shown = await f.api.nativeFileChoices(f.n, f.d)
  expect(shown.choices).toContainEqual({ value: 'yes-session', label: 'Original session grant', decision: 'allow', feedback: false })
  await f.api.answerNativeFileChoice(f.n, f.d, { decision: 'allow', choice: 'yes-session', choiceToken: shown.token })
  expect(f.calls).toEqual([{ value: 'yes-session', feedback: '', input: f.payload.input }])
})
it('acknowledges the original feedback setter, including already matching feedback, before invoking native denial', async () => {
  const f = fixture(); f.setter('Leave it unchanged')
  const shown = await f.api.nativeFileChoices(f.n, f.d)
  await f.api.answerNativeFileChoice(f.n, f.d, { decision: 'deny', choice: 'no', choiceToken: shown.token, feedback: 'Leave it unchanged' })
  expect(f.calls).toEqual([{ value: 'no', feedback: 'Leave it unchanged', input: f.payload.input }])
})
it('rejects held, changed and forged choices before invoking their native callback', async () => {
  const f = fixture(), shown = await f.api.nativeFileChoices(f.n, f.d)
  await expect(f.api.answerNativeFileChoice(f.n, f.d, { decision: 'allow', choice: 'yes-session', choiceToken: 'forged' })).rejects.toThrow('expired')
  f.control.options[1].option.row.applies[0].mode = 'different'
  await expect(f.api.answerNativeFileChoice(f.n, f.d, { decision: 'allow', choice: 'yes-session', choiceToken: shown.token })).rejects.toThrow('expired')
  f.ready(false)
  await expect(f.api.answerNativeFileChoice(f.n, f.d, { decision: 'allow', choice: 'yes' })).rejects.toThrow('not ready')
  expect(f.calls).toEqual([])
})
it('rejects feedback if the original dialog is replaced while its mode is being entered', async () => {
  const f = fixture(), shown = await f.api.nativeFileChoices(f.n, f.d)
  f.control.onInputModeToggle = () => f.revision('replacement')
  await expect(f.api.answerNativeFileChoice(f.n, f.d, { decision: 'deny', choice: 'no', choiceToken: shown.token, feedback: 'No' })).rejects.toThrow('expired')
  expect(f.calls).toEqual([])
})
