import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { claudeTerminalBashRuntime } from '#features/code/be/services/claude-code/terminal-bash-runtime.ts'

function fixture() {
  const output = {}, payload = { toolName: 'Bash', input: { command: 'original command' } }
  function Tst() { return 'reviewed renderer' }
  function Xe() { return 'original choice control' }
  const item = { payload }, open = [item]
  const d = { item, payload, revision: 'revision', store: { getState: () => ({ open }) } }
  const control = { options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as any[], onChange: vi.fn(() => { open.splice(0) }) }
  const cache = Array(24); cache[23] = { noteFocus: vi.fn(), body: { offersStanding: true, isStandingHeld: false } }
  const fiber: any = { type: Tst, memoizedProps: { payload, wouldTakeAnswer: () => true }, updateQueue: { memoCache: { data: [cache] } }, child: { type: Xe, memoizedProps: control } }
  const n = { themeRoots: { ai: () => new Map([[output, { container: { current: fiber } }]]) } }
  const hashes = new WeakMap([[Tst, 'a1c816cf807cd385354df0a915bea27b7ade8b971aca77ac266d0af49522686a']])
  const api = vm.runInNewContext(claudeTerminalBashRuntime + ';({ read: nativeBashChoices, answer: answerNativeBashChoice })', { process: { stdout: output }, createHash, composerFunctionHashes: hashes, setTimeout, Date, nativeDialog: () => d })
  return { api, n, d, control, fiber, open, payload }
}

it('borrows only the current original dialog choices and refuses foreign tokens or unavailable choices', async () => {
  const f = fixture(), source = f.api.read(f.n, f.d)
  expect(source.choices.map((choice: any) => choice.value)).toEqual(['yes', 'no'])
  await expect(f.api.answer(f.n, f.d, { choice: 'yes', choiceToken: 'foreign' })).rejects.toThrow('expired')
  await expect(f.api.answer(f.n, f.d, { choice: 'yes-prefix-edited', choiceToken: source.token, prefix: '*' })).rejects.toThrow('Invalid')
  expect(f.control.onChange).not.toHaveBeenCalled()
  await f.api.answer(f.n, f.d, { choice: 'yes', choiceToken: source.token })
  expect(f.control.onChange).toHaveBeenCalledWith('yes')
  expect(f.payload.input.command).toBe('original command')
})

it('rejects a token after native eligibility changes and ignores a foreign payload', async () => {
  const f = fixture(), source = f.api.read(f.n, f.d)
  f.control.options.pop()
  await expect(f.api.answer(f.n, f.d, { choice: 'yes', choiceToken: source.token })).rejects.toThrow('expired')
  f.fiber.memoizedProps.payload = { ...f.payload }
  expect(f.api.read(f.n, f.d)).toBeUndefined()
})

it('waits for original edited-prefix state and uses the new callback without rewriting command input', async () => {
  const f = fixture(), edited = vi.fn(), replacement = vi.fn(() => { f.open.splice(0) })
  f.control.options.push({ value: 'yes-prefix-edited', label: 'Remember prefix', type: 'input', initialValue: 'npm *', onChange: (prefix: string) => { edited(prefix); f.control.options[2].initialValue = prefix; f.control.onChange = replacement } })
  const source = f.api.read(f.n, f.d)
  await f.api.answer(f.n, f.d, { choice: 'yes-prefix-edited', choiceToken: source.token, prefix: 'npm run *' })
  expect(edited).toHaveBeenCalledWith('npm run *')
  expect(replacement).toHaveBeenCalledWith('yes-prefix-edited')
  expect(f.payload.input.command).toBe('original command')
})

it('leaves rich labels and unrelated feedback inputs with the native terminal', () => {
  const f = fixture()
  f.control.options.push({ value: 'yes-feedback', label: 'Feedback', type: 'input', onChange: vi.fn() }, { value: 'rich', label: { type: 'unknown' } })
  expect(f.api.read(f.n, f.d).choices.map((choice: any) => choice.value)).toEqual(['yes', 'no'])
})

it('preserves a native held-choice refusal without consuming the dialog', async () => {
  const f = fixture(), source = f.api.read(f.n, f.d)
  f.control.onChange.mockImplementation(() => false as any)
  await expect(f.api.answer(f.n, f.d, { choice: 'yes', choiceToken: source.token })).rejects.toThrow('held or refused')
  expect(f.open).toEqual([f.d.item])
})

it('withholds standing choices while the original review layout is held', () => {
  const f = fixture()
  f.control.options.push({ value: 'yes-enable-auto-mode', label: 'Switch to auto mode' })
  f.fiber.updateQueue.memoCache.data[0][23].body.isStandingHeld = true
  expect(f.api.read(f.n, f.d).choices.map((choice: any) => choice.value)).toEqual(['yes', 'no'])
})
