import { createApp, h, reactive, nextTick, type App } from 'vue'
import NativeMcpForm from '#features/threads/fe/chat/NativeMcpForm.vue'
import type { ClaudeNativeMcpForm, ClaudeNativeMcpFormOperation } from '#features/code/common/native-mcp-form.ts'
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })
function fixture() {
  const form: ClaudeNativeMcpForm = { id: 'dialog', revision: 'revision', sessionId: 'session', token: 'a'.repeat(64), ready: true, serverName: 'Research', message: 'Review the release details.', schema: { type: 'object', properties: { title: { type: 'string', title: 'Release title' }, enabled: { type: 'boolean', title: 'Enabled' }, count: { type: 'integer', title: 'Reviewers' } }, required: ['title'] }, propertyOrder: ['title', 'enabled', 'count'], values: { title: 'Original', enabled: false, count: 0 }, errors: {}, resolvingFields: [], currentFieldIndex: 0, focusedButton: null, textInputValue: 'Original' }
  const state = reactive<{ form: ClaudeNativeMcpForm; operation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string } }>({ form })
  const pending = vi.fn<(pending: boolean) => void>()
  const operate = vi.fn<(action: ClaudeNativeMcpFormOperation) => void>(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeMcpForm, { form: state.form, operation: state.operation, onOperate: operate, onPending: pending }) }); app.mount(root)
  const input = root.querySelector<HTMLInputElement>('input')!, button = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!
  async function type(value: string) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
  async function acknowledge(sequence: number, value: string) { state.form.values.title = value; state.form.textInputValue = value; state.form.token = String(sequence).repeat(64); state.operation = { sequence, status: 'done' }; await nextTick() }
  return { state, root, input, operate, pending, type, button, acknowledge }
}
it('retains false and zero and displays original validation/resolution without validating a host answer', async () => {
  const f = fixture(); expect(f.root.querySelector('select')?.value).toBe('false'); expect([...f.root.querySelectorAll('input')].at(-1)?.value).toBe('0')
  f.state.form.errors.title = 'Original native validation'; f.state.form.resolvingFields = ['title']; await nextTick()
  expect(f.root.textContent).toContain('Original native validation'); expect(f.root.textContent).toContain('Checking date'); expect(f.button('Submit').disabled).toBe(true); expect(f.button('Cancel').disabled).toBe(false); expect(f.operate).not.toHaveBeenCalled()
})
it('coalesces queued typing and submits only after original edit acknowledgments', async () => {
  const f = fixture(); await f.type('A'); await f.type('AB'); await f.type('ABC'); f.button('Submit').click(); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'edit', field: 'title', value: 'A', cursorOffset: 1 }]])
  await f.acknowledge(1, 'A'); expect(f.input.value).toBe('ABC'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'edit', field: 'title', value: 'ABC', cursorOffset: 3 }])
  await f.acknowledge(2, 'ABC'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'accept' }]); expect(f.operate).toHaveBeenCalledTimes(3)
})
it('waits for another pending window operation before sending its queued edit', async () => {
  const f = fixture(); f.state.operation = { sequence: 9, status: 'pending' }; await nextTick(); await f.type('Queued'); expect(f.operate).not.toHaveBeenCalled()
  f.state.operation = { sequence: 9, status: 'done' }; await nextTick(); expect(f.operate).toHaveBeenCalledWith({ operation: 'edit', field: 'title', value: 'Queued', cursorOffset: 6 })
})
it('cancels queued typing after the already admitted edit, without sending a later accept', async () => {
  const f = fixture(); await f.type('A'); await f.type('AB'); f.button('Submit').click(); await nextTick(); f.button('Cancel').click(); await nextTick()
  await f.acknowledge(1, 'A'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'cancel' }]); expect(f.operate).toHaveBeenCalledTimes(2)
})
it('keeps unsupported schema cancellation available and reports original operation errors', async () => {
  const f = fixture(); f.state.form.schema = { type: 'object', properties: { other: { type: 'object' } } }; f.state.operation = { sequence: 1, status: 'error', problem: 'Original request expired' }; await nextTick()
  expect(f.button('Submit').disabled).toBe(true); expect(f.button('Cancel').disabled).toBe(false); expect(f.root.textContent).toContain('Original request expired'); expect(f.root.textContent).toContain('cannot be displayed')
})

it('keeps IME preedit local through native refresh and sends only the final composition once', async () => {
  const f = fixture(); await f.type('Before'); f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  f.input.value = '未'; f.input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); await nextTick()
  await f.acknowledge(1, 'Before'); f.state.form.token = 'b'.repeat(64); await nextTick(); expect(f.input.value).toBe('未'); expect(f.operate).toHaveBeenCalledTimes(1); expect(f.button('Submit').disabled).toBe(true)
  f.input.value = '完成'; f.input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '完成' })); await nextTick()
  f.input.dispatchEvent(new InputEvent('input', { bubbles: true })); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'edit', field: 'title', value: 'Before', cursorOffset: 6 }], [{ operation: 'edit', field: 'title', value: '完成', cursorOffset: 2 }]])
})
it('forwards an extra Backspace on an empty field as native unset instead of an empty string', async () => {
  const f = fixture(); await f.type(''); await f.acknowledge(1, '')
  f.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })); await nextTick()
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'edit', field: 'title', value: null }])
})

it('sends collapsed cursor movement without replacing text and preserves browser selection during native refresh', async () => {
  const f = fixture(); f.input.focus(); f.input.setSelectionRange(2, 2)
  f.input.dispatchEvent(new Event('select', { bubbles: true })); await nextTick()
  expect(f.operate).toHaveBeenCalledWith({ operation: 'cursor', field: 'title', cursorOffset: 2 })
  f.input.setSelectionRange(1, 4); f.input.dispatchEvent(new Event('select', { bubbles: true })); await nextTick()
  expect(f.operate).toHaveBeenCalledTimes(1)
  f.state.form.token = 'c'.repeat(64); await nextTick()
  expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([1, 4])
})

it('restores original cursor into an unfocused native field without stealing composer focus', async () => {
  const f = fixture(), composer = document.createElement('textarea'); document.body.append(composer); composer.focus()
  f.state.form.textInputCursorOffset = 3; f.state.form.token = 'd'.repeat(64); await nextTick()
  expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([3, 3])
  expect(document.activeElement).toBe(composer)
  expect(f.operate).not.toHaveBeenCalled()
})

it('holds the handoff guard through coalesced edits and clears it only after the final acknowledgement', async () => {
  const f = fixture(); await f.type('A'); await f.type('AB')
  expect(f.pending.mock.calls.at(-1)).toEqual([true])
  await f.acknowledge(1, 'A'); expect(f.pending.mock.calls.at(-1)).toEqual([true])
  await f.acknowledge(2, 'AB'); expect(f.pending.mock.calls.at(-1)).toEqual([false])
})
it('holds the handoff guard during IME and releases it on unmount without dispatching queued work', async () => {
  const f = fixture(); f.input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); await nextTick()
  expect(f.pending.mock.calls.at(-1)).toEqual([true])
  await f.type('未'); expect(f.operate).not.toHaveBeenCalled()
  app?.unmount(); app = undefined
  expect(f.pending.mock.calls.at(-1)).toEqual([false]); expect(f.operate).not.toHaveBeenCalled()
})
it('coalesces cursor movement into the queued text edit and avoids a duplicate operation on acknowledgement', async () => {
  const f = fixture(); await f.type('A'); await f.type('ABCD')
  f.input.setSelectionRange(2, 2); f.input.dispatchEvent(new Event('select', { bubbles: true })); await nextTick()
  await f.acknowledge(1, 'A')
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'edit', field: 'title', value: 'ABCD', cursorOffset: 2 }])
  await f.acknowledge(2, 'ABCD'); expect(f.operate).toHaveBeenCalledTimes(2)
})

it('mirrors focus on another field before its cursor without rewriting zero or false', async () => {
  const f = fixture(), count = f.root.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
  const offset = count.selectionEnd; count.focus(); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'focus', field: 'count' }]])
  f.state.form.currentFieldIndex = 2; f.state.form.textInputValue = '0'; f.state.operation = { sequence: 1, status: 'done' }; await nextTick()
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'cursor', field: 'count', cursorOffset: offset }])
  expect(f.state.form.values).toEqual({ title: 'Original', enabled: false, count: 0 })
  f.state.operation = { sequence: 2, status: 'done' }; await nextTick(); expect(f.pending).toHaveBeenLastCalledWith(false)
})
it('preserves a browser range while focusing its field in the original owner', async () => {
  const f = fixture(); f.state.form.currentFieldIndex = 2; f.state.form.textInputValue = '0'; await nextTick()
  f.input.setSelectionRange(1, 4); f.input.focus(); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'focus', field: 'title' }]])
  f.state.form.currentFieldIndex = 0; f.state.form.textInputValue = 'Original'; f.state.form.textInputCursorOffset = 8
  f.state.operation = { sequence: 1, status: 'done' }; await nextTick()
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'cursor', field: 'title', cursorOffset: 4 }])
  expect([f.input.selectionStart, f.input.selectionEnd]).toEqual([1, 4])
})
it('keeps Submit pending across an earlier nontext focus acknowledgement', async () => {
  const f = fixture(); f.root.querySelector<HTMLSelectElement>('select')!.focus(); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'focus', field: 'enabled' }]])
  f.button('Submit').click(); await nextTick()
  f.state.form.currentFieldIndex = 1; f.state.operation = { sequence: 1, status: 'done' }; await nextTick()
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'accept' }])
  expect(f.root.querySelector<HTMLButtonElement>('button.accept')!.disabled).toBe(true)
  expect(f.root.querySelector<HTMLButtonElement>('button.accept')!.textContent).toBe('Sending…')
})

it('retains a mid-string caret when focus returns behind an earlier edit and another field', async () => {
  const f = fixture(), count = f.root.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
  f.input.value = 'ABCD'; f.input.setSelectionRange(2, 2); f.input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'edit', field: 'title', value: 'ABCD', cursorOffset: 2 }]])
  count.focus(); f.input.focus(); await nextTick()
  for (let sequence = 1; sequence <= 4; sequence++) {
    f.state.form.currentFieldIndex = sequence === 1 || sequence === 4 ? 0 : 2
    f.state.form.textInputValue = sequence === 1 || sequence === 4 ? 'ABCD' : '0'
    f.state.form.values.title = 'ABCD'; f.state.operation = { sequence, status: 'done' }; await nextTick()
  }
  expect(f.operate.mock.calls.map(([action]) => action.operation)).toEqual(['edit', 'focus', 'cursor', 'focus', 'cursor'])
  expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'cursor', field: 'title', cursorOffset: 2 }])
})
