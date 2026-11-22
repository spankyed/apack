import vm from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { rewriteClaudeNativePlatformSelectors } from '#features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalPowerShellRuntime } from '#features/code/be/services/claude-code/terminal-powershell-runtime.ts'

function fixture() {
  function jat() {}
  function Xe() {}
  const item = { id: 'permission', kind: 'permission_powershell' }
  const payload = { toolName: 'PowerShell' }
  const open = [item]
  const dialog = { item, payload, revision: randomUUID(), sessionId: randomUUID(), store: { getState: () => ({ open }) } }
  let current = dialog
  const onChange = vi.fn((_: string) => { open.pop() })
  const onCancel = vi.fn(() => { open.pop() })
  const options = [{ value: 'yes', label: 'Original approval' }, { value: 'no', label: 'Original refusal' }]
  const control = { type: Xe, props: { options, onChange, onCancel } }
  const command = { kind: 'full', text: 'Write-Output "Local fixture"' }
  const body = [false, 'Original reason', null, 'Do you want to proceed?', control]
  const panel = { title: 'PowerShell command', children: [null, { props: { commandDisplay: command } }, { props: { children: body } }, null] }
  const wrapper = { fitted: { description: 'Original description' }, children: { props: panel } }
  const fiber = { type: jat, memoizedProps: { payload, wouldTakeAnswer: () => true }, child: { memoizedProps: wrapper } }
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
  const answer = (token: string, decision: string, choice: string) => runtime.answer(n, dialog, { toolName: 'PowerShell', choiceToken: token, decision, choice })
  return { show, answer, onChange, onCancel, command, options, replace: () => { current = { ...dialog, item: { ...item }, revision: randomUUID() } } }
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

it('leaves standing-rule and withheld previews in the original terminal', async () => {
  const f = fixture()
  f.options.splice(1, 0, { value: 'yes-prefix-edited', label: 'Original standing rule' })
  expect(await f.show()).toBeUndefined()
  f.options.splice(1, 1)
  f.command.kind = 'withheld'
  expect(await f.show()).toBeUndefined()
})

it('rejects mismatched decisions and retired native dialogs before invoking any callback', async () => {
  const f = fixture(), shown = await f.show()
  await expect(f.answer(shown.presentation.token, 'allow', 'no')).rejects.toThrow('Invalid native PowerShell choice')
  f.replace()
  await expect(f.answer(shown.presentation.token, 'allow', 'yes')).rejects.toThrow('Native PowerShell permission expired')
  expect(f.onChange).not.toHaveBeenCalled()
  expect(f.onCancel).not.toHaveBeenCalled()
})
