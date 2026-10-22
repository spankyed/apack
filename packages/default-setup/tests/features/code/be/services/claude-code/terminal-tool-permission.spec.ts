import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalToolPermissionRuntime } from '#features/code/be/services/claude-code/terminal-tool-permission-runtime.ts'

/** Mock mounted controls exercise adapter guards; they do not establish native/app acceptance. */
function fixture(skill = false) {
  const payload = { toolName: skill ? 'Skill' : 'WebFetch' }, item = { id: 'original-dialog', kind: skill ? 'permission_skill' : 'permission_webfetch', payload }
  const open = [item], store = { getState: () => ({ open }) }
  const dialog = { item, payload, revision: randomUUID(), sessionId: randomUUID(), store }
  let current = dialog, ready = true, refuse = false
  const decide = vi.fn(() => { if (refuse) return false; open.splice(0); return true })
  const options = skill ? [{ value: 'yes', label: 'Yes', feedbackConfig: { type: 'accept' } }, { value: 'yes-exact', label: 'Original exact scope' }, { value: 'no', label: 'No', feedbackConfig: { type: 'reject' } }] : [{ value: 'yes', label: 'Yes' }, { value: 'yes-dont-ask-again-domain', label: 'Original domain scope' }, { value: 'no', label: 'No' }]
  const control = skill ? { options, onSelect: decide } : { options, onChange: decide }
  function VCe() {} function WCe() {} function Xe() {}
  const producer = skill ? WCe : VCe
  const fiber = { type: producer, memoizedProps: { payload, wouldTakeAnswer: () => ready }, child: { type: Xe, memoizedProps: control } }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: fiber } }]]) } }
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const runtime = vm.runInNewContext(claudeTerminalToolPermissionRuntime + ';({choices:nativeToolPermissionChoices,answer:answerNativeToolPermissionChoice})', {
    process: { stdout: undefined }, createHash, composerFunctionHashes: new WeakMap(),
    nativeFunctionName: (name: string) => name, nativeFunctionHash: () => hash(producer.toString()),
    nativeDialog: () => current, setTimeout,
  })
  return { runtime, n, dialog, options, control, fiber, decide, open,
    setReady(value: boolean) { ready = value }, setRefuse() { refuse = true },
    replace() { current = { ...dialog, item: { ...item }, revision: randomUUID() } },
  }
}
it.each([false, true])('preserves original offered values/labels and dispatches only the original callback (Skill=%s)', async skill => {
  const f = fixture(skill), shown = await f.runtime.choices(f.n, f.dialog)
  expect(shown.ready).toBe(true)
  expect(shown.choices.map((choice: { value: string }) => choice.value)).toEqual(f.options.map(option => option.value))
  const choice = skill ? 'yes-exact' : 'yes-dont-ask-again-domain'
  await f.runtime.answer(f.n, f.dialog, { choice, choiceToken: shown.token })
  expect(f.decide.mock.calls[0]).toEqual(skill ? [choice, undefined] : [choice])
  expect(f.open).toHaveLength(0)
})
it('preserves native Skill feedback and refusal', async () => {
  const f = fixture(true), shown = await f.runtime.choices(f.n, f.dialog)
  f.setRefuse()
  await expect(f.runtime.answer(f.n, f.dialog, { choice: 'no', choiceToken: shown.token, feedback: 'Review the scope first' })).rejects.toThrow('refused')
  expect(f.decide.mock.calls[0]).toEqual(['no', 'Review the scope first'])
  expect(f.open).toHaveLength(1)
})
it('refuses an unknown choice, wrong token and unsupported WebFetch feedback without calling native', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  for (const request of [{ choice: 'unknown', choiceToken: shown.token }, { choice: 'yes', choiceToken: 'old' }, { choice: 'no', choiceToken: shown.token, feedback: 'Unsupported' }]) {
    await expect(f.runtime.answer(f.n, f.dialog, request)).rejects.toThrow()
  }
  expect(f.decide).not.toHaveBeenCalled()
})
it('refuses native grace and dialog replacement without calling a stale callback', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  f.setReady(false)
  await expect(f.runtime.answer(f.n, f.dialog, { choice: 'yes', choiceToken: shown.token })).rejects.toThrow('not ready')
  f.setReady(true); f.replace()
  await expect(f.runtime.answer(f.n, f.dialog, { choice: 'yes', choiceToken: shown.token })).rejects.toThrow('expired')
  expect(f.decide).not.toHaveBeenCalled()
})
it('refuses changed offered choices and unknown source values', async () => {
  const f = fixture(), shown = await f.runtime.choices(f.n, f.dialog)
  f.options.splice(1, 1)
  await expect(f.runtime.answer(f.n, f.dialog, { choice: 'yes-dont-ask-again-domain', choiceToken: shown.token })).rejects.toThrow('changed')
  f.options.push({ value: 'new-native-grant', label: 'Unknown scope' })
  await expect(f.runtime.choices(f.n, f.dialog)).rejects.toThrow('Unknown original')
  expect(f.decide).not.toHaveBeenCalled()
})
it('refuses a changed renderer fingerprint and ambiguous controls', async () => {
  const changed = fixture()
  changed.fiber.type = function VCe() { return 1 }
  await expect(changed.runtime.choices(changed.n, changed.dialog)).rejects.toThrow('renderer changed')
  const ambiguous = fixture()
  Object.assign(ambiguous.fiber.child, { sibling: { ...ambiguous.fiber.child } })
  const shown = await ambiguous.runtime.choices(ambiguous.n, ambiguous.dialog)
  expect(shown.ready).toBe(false)
  expect(shown.choices).toHaveLength(0)
  await expect(ambiguous.runtime.answer(ambiguous.n, ambiguous.dialog, { choice: 'yes', choiceToken: shown.token })).rejects.toThrow('not ready')
  expect(ambiguous.decide).not.toHaveBeenCalled()
})
