import { createApp, h, reactive, nextTick, type App } from 'vue'
import NativeMcpForm from '#features/threads/fe/chat/NativeMcpForm.vue'
import type { ClaudeNativeMcpForm, ClaudeNativeMcpFormOperation } from '#features/code/common/native-mcp-form.ts'
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })
function fixture() {
  const form: ClaudeNativeMcpForm = { id: 'dialog', revision: 'revision', sessionId: 'session', token: 'a'.repeat(64), ready: true, serverName: 'Research', message: 'Review the release details.', schema: { type: 'object', properties: { title: { type: 'string', title: 'Release title' }, enabled: { type: 'boolean', title: 'Enabled' }, count: { type: 'integer', title: 'Reviewers' } }, required: ['title'] }, propertyOrder: ['title', 'enabled', 'count'], values: { title: 'Original', enabled: false, count: 0 }, errors: {}, resolvingFields: [], currentFieldIndex: 0, focusedButton: null, textInputValue: 'Original' }
  const state = reactive<{ form: ClaudeNativeMcpForm; operation?: { sequence: number; status: 'pending' | 'done' | 'error'; problem?: string } }>({ form })
  const operate = vi.fn<(action: ClaudeNativeMcpFormOperation) => void>(), root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(NativeMcpForm, { form: state.form, operation: state.operation, onOperate: operate }) }); app.mount(root)
  const input = root.querySelector<HTMLInputElement>('input')!, button = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!
  async function type(value: string) { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await nextTick() }
  async function acknowledge(sequence: number, value: string) { state.form.values.title = value; state.form.textInputValue = value; state.form.token = String(sequence).repeat(64); state.operation = { sequence, status: 'done' }; await nextTick() }
  return { state, root, input, operate, type, button, acknowledge }
}
it('retains false and zero and displays original validation/resolution without validating a host answer', async () => {
  const f = fixture(); expect(f.root.querySelector('select')?.value).toBe('false'); expect([...f.root.querySelectorAll('input')].at(-1)?.value).toBe('0')
  f.state.form.errors.title = 'Original native validation'; f.state.form.resolvingFields = ['title']; await nextTick()
  expect(f.root.textContent).toContain('Original native validation'); expect(f.root.textContent).toContain('Checking date'); expect(f.button('Submit').disabled).toBe(true); expect(f.button('Cancel').disabled).toBe(false); expect(f.operate).not.toHaveBeenCalled()
})
it('coalesces queued typing and submits only after original edit acknowledgments', async () => {
  const f = fixture(); await f.type('A'); await f.type('AB'); await f.type('ABC'); f.button('Submit').click(); await nextTick()
  expect(f.operate.mock.calls).toEqual([[{ operation: 'edit', field: 'title', value: 'A' }]])
  await f.acknowledge(1, 'A'); expect(f.input.value).toBe('ABC'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'edit', field: 'title', value: 'ABC' }])
  await f.acknowledge(2, 'ABC'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'accept' }]); expect(f.operate).toHaveBeenCalledTimes(3)
})
it('waits for another pending window operation before sending its queued edit', async () => {
  const f = fixture(); f.state.operation = { sequence: 9, status: 'pending' }; await nextTick(); await f.type('Queued'); expect(f.operate).not.toHaveBeenCalled()
  f.state.operation = { sequence: 9, status: 'done' }; await nextTick(); expect(f.operate).toHaveBeenCalledWith({ operation: 'edit', field: 'title', value: 'Queued' })
})
it('cancels queued typing after the already admitted edit, without sending a later accept', async () => {
  const f = fixture(); await f.type('A'); await f.type('AB'); f.button('Submit').click(); await nextTick(); f.button('Cancel').click(); await nextTick()
  await f.acknowledge(1, 'A'); expect(f.operate.mock.calls.at(-1)).toEqual([{ operation: 'cancel' }]); expect(f.operate).toHaveBeenCalledTimes(2)
})
it('keeps unsupported schema cancellation available and reports original operation errors', async () => {
  const f = fixture(); f.state.form.schema = { type: 'object', properties: { other: { type: 'object' } } }; f.state.operation = { sequence: 1, status: 'error', problem: 'Original request expired' }; await nextTick()
  expect(f.button('Submit').disabled).toBe(true); expect(f.button('Cancel').disabled).toBe(false); expect(f.root.textContent).toContain('Original request expired'); expect(f.root.textContent).toContain('cannot be displayed')
})
