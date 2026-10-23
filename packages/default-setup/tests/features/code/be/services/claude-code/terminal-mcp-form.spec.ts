import { runInNewContext } from 'node:vm'
import { createHash, randomUUID } from 'node:crypto'
import { claudeTerminalMcpFormRuntime } from '#features/code/be/services/claude-code/terminal-mcp-form-runtime.ts'
function fixture() {
  function ZCo() {} function tet() {} function Fet() {} function Panel() {} function Box() {}
  const sessionId = randomUUID(), payload = { serverName: 'research', params: { mode: 'form', message: 'Review release details', requestedSchema: { type: 'object' } } }
  let item = { id: 'original', kind: 'mcp_elicitation', payload }, open = [item], ready = true
  const fields = { schemaFields: [{ name: 'title', schema: { type: 'string' } }, { name: 'enabled', schema: { type: 'boolean' } }, { name: 'audience', schema: { type: 'string', enum: ['internal', 'public'] } }], formValues: { title: 'Original', enabled: false, audience: 'internal' } as Record<string, unknown>, validationErrors: {} as Record<string, string>, resolvingFields: new Set<string>(), currentFieldIndex: 0 as number | undefined, focusedButton: null as string | null, expandedAccordion: undefined as string | undefined, accordionOptionIndex: 0, textInputValue: 'Original', textInputCursorOffset: 8, setTextInputCursorOffset: vi.fn((offset: number) => { fields.textInputCursorOffset = offset }), handleTextInputChange: vi.fn((value: string) => { fields.textInputValue = value; fields.formValues[fields.schemaFields[fields.currentFieldIndex!].name] = value }) }
  const cancel = vi.fn(() => { open = []; return true })
  const key = vi.fn((event: { key: string }) => {
    const at = fields.currentFieldIndex ?? (fields.focusedButton === 'accept' ? 3 : 4)
    if (event.key === 'down' || event.key === 'up') {
      if (fields.expandedAccordion) { fields.accordionOptionIndex += event.key === 'down' ? 1 : -1; return }
      const next = (at + (event.key === 'down' ? 1 : 4)) % 5
      fields.currentFieldIndex = next < 3 ? next : undefined; fields.focusedButton = next === 3 ? 'accept' : next === 4 ? 'decline' : null
    } else if (event.key === 'right') { fields.expandedAccordion = fields.schemaFields[at].name; fields.accordionOptionIndex = 0 }
    else if (event.key === 'left') fields.expandedAccordion = undefined
    else if (event.key === ' ') {
      if (fields.expandedAccordion) { fields.formValues.audience = ['internal', 'public'][fields.accordionOptionIndex]; fields.expandedAccordion = undefined }
      else fields.formValues.enabled = !fields.formValues.enabled
    } else if (event.key === 'backspace') delete fields.formValues[fields.schemaFields[at].name]
    else if (event.key === 'return' && fields.focusedButton && !Object.keys(fields.validationErrors).length) open = []
  })
  const cache = new WeakMap<Function, string>([[ZCo, '275d086d7b1ac78d0b4b1939853b2a4fe61e3bc9062ab8c6e7fb281589c3c2db'], [tet, 'ba2a4f9045e565e0ac28db116418d4758517b2a2007cc6ae64a40ec73fc4277d'], [Fet, 'c09e34983d996a1a05efed050f5a2f796a68dc838f95090729f83ee627eabb16'], [key, '2804d5c249ad1589908e897ff8786895851b0c7200aa1fc57068444739efadb3']])
  const root = { type: ZCo, memoizedProps: { payload, wouldTakeAnswer: () => ready }, child: { type: tet, child: { type: Panel, memoizedProps: { onCancel: cancel }, child: { type: Box, memoizedProps: { onKeyDown: key }, child: { type: Fet, memoizedProps: fields } } } } }
  const store = { getState: () => ({ open }) }, context = { dialogStore: store }, n = { mcpInputTiming: { AM: 0 }, runtime: { ey: () => ({ surface: 'terminal', toolContext: () => context }) }, questionOptions: { q: () => sessionId }, themeRoots: { ai: () => new Map([['stdout', { container: { current: root } }]]) } }
  const api = runInNewContext(claudeTerminalMcpFormRuntime + '\n({dialog:nativeMcpDialog,presentation:nativeMcpFormPresentation,operate:operateNativeMcpForm})', { AbortController, originalContext: undefined, readFileSync: () => JSON.stringify({ sessionId }), configUrl: 'config', dialogRevisions: new Map(), createHash, randomUUID, composerFunctionHashes: cache, nativeFunctionName: (name: string) => name, process: { stdout: 'stdout' }, setTimeout })
  const show = () => api.presentation(n, api.dialog(n))
  const operate = (action: unknown, overrides = {}) => { const form = show(); return api.operate(n, { id: form.id, revision: form.revision, session_id: sessionId, token: form.token, action, ...overrides }, new AbortController().signal) }
  return { api, n, show, operate, fields, key, cancel, cache, ZCo, root, setReady(value: boolean) { ready = value }, expire() { item = { ...item }; open = [item] } }
}
it('projects original values/errors and dispatches text edits only to the original field callback', async () => {
  const f = fixture(); expect(f.show().values.enabled).toBe(false)
  const result = await f.operate({ operation: 'edit', field: 'title', value: 'Updated' })
  expect(f.fields.handleTextInputChange).toHaveBeenCalledWith('Updated'); expect(result.form.values.title).toBe('Updated'); expect(result.settled).toBe(false)
})
it('uses original boolean/enum navigation and preserves false without host answer injection', async () => {
  const f = fixture(); await f.operate({ operation: 'edit', field: 'enabled', value: true }); expect(f.fields.formValues.enabled).toBe(true)
  await f.operate({ operation: 'edit', field: 'enabled', value: false }); expect(f.fields.formValues.enabled).toBe(false)
  await f.operate({ operation: 'edit', field: 'audience', value: 'public' }); expect(f.fields.formValues.audience).toBe('public')
  expect(f.fields.handleTextInputChange).not.toHaveBeenCalled()
})
it('leaves native validation refusal visible instead of settling a host-validated answer', async () => {
  const f = fixture(); f.fields.validationErrors.title = 'Original native error'
  const result = await f.operate({ operation: 'accept' }); expect(result.settled).toBe(false); expect(result.form.errors.title).toBe('Original native error')
})
it.each(['accept', 'decline', 'cancel'])('settles %s only through an original mounted callback', async operation => {
  const f = fixture(); const result = await f.operate({ operation }); expect(result.settled).toBe(true)
  if (operation === 'cancel') expect(f.cancel).toHaveBeenCalledOnce(); else expect(f.key.mock.calls.at(-1)?.[0].key).toBe('return')
})
it('refuses stale tokens, readiness, unknown fields/options and changed renderer hashes', async () => {
  const f = fixture(); await expect(f.operate({ operation: 'edit', field: 'title', value: 'new' }, { token: '0'.repeat(64) })).rejects.toThrow('changed')
  f.setReady(false); await expect(f.operate({ operation: 'cancel' })).rejects.toThrow('not ready'); f.setReady(true)
  await expect(f.operate({ operation: 'edit', field: 'foreign', value: 'x' })).rejects.toThrow('Unknown')
  await expect(f.operate({ operation: 'edit', field: 'audience', value: 'foreign' })).rejects.toThrow('options')
  f.cache.set(f.ZCo, 'changed'); expect(() => f.show()).toThrow('wrapper changed'); expect(f.cancel).not.toHaveBeenCalled()
})
it('rechecks dialog lifetime after original navigation and honors aborted requests', async () => {
  const f = fixture(); f.key.mockImplementationOnce(() => f.expire())
  await expect(f.operate({ operation: 'edit', field: 'audience', value: 'public' })).rejects.toThrow('expired'); expect(f.fields.handleTextInputChange).not.toHaveBeenCalled()
  const g = fixture(), form = g.show(), abort = new AbortController(); abort.abort()
  await expect(g.api.operate(g.n, { id: form.id }, abort.signal)).rejects.toThrow(); expect(g.key).not.toHaveBeenCalled(); expect(g.cancel).not.toHaveBeenCalled()
})

it('cancels the same original request across asynchronous field-state changes but refuses a different dialog', async () => {
  const f = fixture(), token = f.show().token; f.fields.validationErrors.date = 'Original async validation changed'
  await expect(f.operate({ operation: 'cancel' }, { token })).resolves.toMatchObject({ settled: true }); expect(f.cancel).toHaveBeenCalledOnce()
  const g = fixture(); await expect(g.operate({ operation: 'cancel' }, { revision: randomUUID() })).rejects.toThrow('changed'); expect(g.cancel).not.toHaveBeenCalled()
})

it('forwards a bounded UTF-16 cursor to the original setter after its text callback', async () => {
  const f = fixture()
  const result = await f.operate({ operation: 'edit', field: 'title', value: 'A😀B', cursorOffset: 3 })
  expect(f.fields.setTextInputCursorOffset).toHaveBeenCalledWith(3)
  expect(f.fields.handleTextInputChange.mock.invocationCallOrder[0]).toBeLessThan(f.fields.setTextInputCursorOffset.mock.invocationCallOrder[0])
  expect(result.form.textInputCursorOffset).toBe(3)
})
it.each([-1, 1.5, 5])('rejects invalid cursor %s before changing original text', async cursorOffset => {
  const f = fixture()
  await expect(f.operate({ operation: 'edit', field: 'title', value: 'A😀B', cursorOffset })).rejects.toThrow('cursor offset')
  expect(f.fields.handleTextInputChange).not.toHaveBeenCalled()
  expect(f.fields.setTextInputCursorOffset).not.toHaveBeenCalled()
})

it('moves only the active original cursor without revalidating its text, and refuses a foreign field', async () => {
  const f = fixture()
  await f.operate({ operation: 'cursor', field: 'title', cursorOffset: 2 })
  expect(f.fields.setTextInputCursorOffset).toHaveBeenCalledWith(2)
  expect(f.fields.handleTextInputChange).not.toHaveBeenCalled()
  await expect(f.operate({ operation: 'cursor', field: 'enabled', cursorOffset: 0 })).rejects.toThrow('cursor field changed')
  expect(f.key).not.toHaveBeenCalled()
})
