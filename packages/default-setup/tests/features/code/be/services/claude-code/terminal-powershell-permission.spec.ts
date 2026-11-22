import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalPowerShellRuntime } from '#features/code/be/services/claude-code/terminal-powershell-runtime.ts'

function fixture(withFeedback = false) {
  function jat() {}
  function Xe() {}
  const item = { id: 'permission', kind: 'permission_powershell' }
  const payload = { toolName: 'PowerShell' }
  const open = [item]
  const dialog = { item, payload, revision: randomUUID(), sessionId: randomUUID(), store: { getState: () => ({ open }) } }
  let current = dialog
  let refusing = false
  const onChange = vi.fn((_: string) => { if (refusing) return false; open.pop(); return true })
  const onCancel = vi.fn(() => { open.pop() })
  const options: { value: string; label: string; type?: string; initialValue?: string; onChange?: (text: string) => void }[] = [{ value: 'yes', label: 'Original approval' }, { value: 'no', label: 'Original refusal' }]
  const onInputModeToggle = () => {}
  const control = { type: Xe, props: { options, onChange: (choice: string) => onChange(choice), onCancel, onInputModeToggle } }
  const acceptedFeedback = vi.fn(), refusedFeedback = vi.fn()
  const feedback = {
    acceptFeedback: '', rejectFeedback: '', handleInputModeToggle: onInputModeToggle,
    setAcceptFeedback: (text: string) => update('acceptFeedback', text),
    setRejectFeedback: (text: string) => update('rejectFeedback', text),
  }
  function update(field: 'acceptFeedback' | 'rejectFeedback', text: string) {
    feedback[field] = text
    const report = field === 'acceptFeedback' ? acceptedFeedback : refusedFeedback
    control.props.onChange = choice => { report(text); return onChange(choice) }
  }
  const usePrefix = (value: string) => {
    const report = vi.fn()
    const option = { value: 'yes-prefix-edited', label: 'Original editable rule', type: 'input', initialValue: value,
      onChange(text: string) {
        option.initialValue = text
        control.props.onChange = choice => { report(text); return onChange(choice) }
      },
    }
    options.splice(1, 0, option)
    return { option, report }
  }
  const memoRow = Array.from({ length: 35 }, (_, index) => index === 34 ? feedback : null)
  const command = { kind: 'full', text: 'Write-Output "Local fixture"', marker: '' }
  const body = [false, 'Original reason', null, 'Do you want to proceed?', control]
  const panel = { title: 'PowerShell command', children: [null, { props: { commandDisplay: command } }, { props: { children: body } }, null] }
  const wrapper = { fitted: { description: 'Original description', body: { isStandingHeld: false } }, children: { props: panel } }
  const fiber = { type: jat, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: { memoizedProps: wrapper }, updateQueue: { memoCache: { data: withFeedback ? [memoRow] : [] } } }
  const n = { themeRoots: { ai: () => new Map([[undefined, { container: { current: fiber } }]]) } }
  const code = rewriteClaudeNativePlatformSelectors(claudeTerminalPowerShellRuntime)
  const runtime = vm.runInNewContext(`${code};({show:nativePowerShellPresentation,answer:answerNativePowerShellPermission})`, {
    process: { stdout: undefined }, createHash, composerFunctionHashes: new WeakMap(), setTimeout,
    nativeFunctionName: (name: string) => name,
    nativeFunctionHash: () => createHash('sha256').update(jat.toString()).digest('hex'),
    nativeGenericPermissionText: (_runtime: unknown, node: string) => Promise.resolve(node),
    nativeDialog: () => current,
  })
  const show = () => runtime.show(n, dialog)
  const answer = (token: string, decision: string, choice: string, feedback?: string, prefix?: string) => runtime.answer(n, dialog, { feedback, prefix, toolName: 'PowerShell', choiceToken: token, decision, choice }, new AbortController().signal)
  return { show, answer, usePrefix, onChange, onCancel, acceptedFeedback, refusedFeedback, feedback, refuse: () => { refusing = true }, command, options, fitted: wrapper.fitted, replace: () => { current = { ...dialog, item: { ...item }, revision: randomUUID() } } }
}

it.each([['allow', 'yes'], ['deny', 'no'], ['cancel', '']])('sends %s to the original PowerShell control', async (decision, choice) => {
  const f = fixture(), shown = await f.show()
  expect(shown).toMatchObject({ reason: 'Original reason', presentation: { title: 'PowerShell command', ready: true, canCancel: true, defaultFocusValue: 'yes', details: [
    { label: 'Description', value: 'Original description' }, { label: 'Command', value: f.command.text },
  ] } })
  await f.answer(shown.presentation.token, decision, choice)
  if (decision === 'cancel') {
    expect(f.onCancel).toHaveBeenCalledOnce()
    expect(f.onChange).not.toHaveBeenCalled()
  } else {
    expect(f.onChange).toHaveBeenCalledExactlyOnceWith(choice)
    expect(f.onCancel).not.toHaveBeenCalled()
  }
})

it('leaves unrecognized editable choices and withheld previews in the original terminal', async () => {
  const f = fixture()
  f.options.splice(1, 0, { value: 'yes-prefix-edited', label: 'Original standing rule' })
  expect(await f.show()).toBeUndefined()
  f.options.splice(1, 1)
  f.command.kind = 'withheld'
  expect(await f.show()).toBeUndefined()
})

it('shows the original standing suggestion and refuses it after the original renderer holds it', async () => {
  const f = fixture()
  f.options.splice(1, 0, { value: 'yes-apply-suggestions', label: 'Original directory grant' })
  const first = await f.show()
  expect(first.presentation.choices[1]).toEqual({ value: 'yes-apply-suggestions', label: 'Original directory grant', decision: 'allow', feedback: false })
  f.fitted.body.isStandingHeld = true
  await expect(f.answer(first.presentation.token, 'allow', 'yes-apply-suggestions')).rejects.toThrow('choices changed')
  expect(f.onChange).not.toHaveBeenCalled()
  f.fitted.body.isStandingHeld = false
  await f.answer(first.presentation.token, 'allow', 'yes-apply-suggestions')
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('yes-apply-suggestions')
})

it('rejects mismatched decisions and retired native dialogs before invoking any callback', async () => {
  const f = fixture(), shown = await f.show()
  await expect(f.answer(shown.presentation.token, 'allow', 'no')).rejects.toThrow('Invalid native PowerShell choice')
  f.replace()
  await expect(f.answer(shown.presentation.token, 'allow', 'yes')).rejects.toThrow('Native PowerShell permission expired')
  expect(f.onChange).not.toHaveBeenCalled()
  expect(f.onCancel).not.toHaveBeenCalled()
})

it.each([['allow', 'yes', 'acceptedFeedback'], ['deny', 'no', 'refusedFeedback']] as const)('commits %s feedback through the confirmed native state before deciding', async (decision, choice, report) => {
  const f = fixture(true), shown = await f.show()
  expect(shown.presentation.choices.find((option: { value: string }) => option.value === choice)?.feedback).toBe(true)
  await f.answer(shown.presentation.token, decision, choice, 'Keep exact spacing  in this instruction.')
  expect(f[report]).toHaveBeenCalledExactlyOnceWith('Keep exact spacing  in this instruction.')
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith(choice)
})

it('restores the prior native text when the original callback refuses the operation', async () => {
  const f = fixture(true), shown = await f.show()
  f.refuse()
  await expect(f.answer(shown.presentation.token, 'allow', 'yes', 'Do not keep this after failure')).rejects.toThrow('refused')
  expect(f.feedback.acceptFeedback).toBe('')
})

it('passes an edited prefix through the original field and fresh choice while preserving the actual command', async () => {
  const f = fixture(), field = f.usePrefix('Write-Output "Local fixture"')
  const shown = await f.show()
  expect(shown.presentation.choices[1]).toEqual({ value: 'yes-prefix-edited', label: 'Original editable rule', decision: 'allow', feedback: false, prefix: f.command.text })
  await expect(f.answer(shown.presentation.token, 'allow', 'yes-prefix-edited', undefined, ' ')).rejects.toThrow('Invalid PowerShell permission prefix')
  await expect(f.answer(shown.presentation.token, 'allow', 'yes', undefined, 'Write-Output *')).rejects.toThrow('Invalid PowerShell permission prefix')
  expect(f.onChange).not.toHaveBeenCalled()
  await f.answer(shown.presentation.token, 'allow', 'yes-prefix-edited', undefined, 'write-output "Local fixture"')
  expect(field.report).toHaveBeenCalledExactlyOnceWith('write-output "Local fixture"')
  expect(f.onChange).toHaveBeenCalledExactlyOnceWith('yes-prefix-edited')
  expect(f.command.text).toBe('Write-Output "Local fixture"')
})

it('presents the original withheld marker with one-time choices and leaves the raw command out of the preview', async () => {
  const f = fixture(true)
  f.command.kind = 'withheld'
  f.command.marker = '(Original withheld marker)'
  const shown = await f.show()
  expect(shown.withheld).toBe(true)
  expect(shown.presentation.details.at(-1)).toEqual({ label: 'Command', value: f.command.marker })
  expect(JSON.stringify(shown.presentation)).not.toContain(f.command.text)
  expect(shown.presentation.choices.map((choice: { value: string }) => choice.value)).toEqual(['yes', 'no'])
  f.usePrefix(f.command.text)
  expect(await f.show()).toBeUndefined()
})
