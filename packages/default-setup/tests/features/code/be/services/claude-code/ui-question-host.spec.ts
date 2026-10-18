import { createClaudeQuestionHost } from '#features/code/be/services/claude-code/ui-question-host.ts'
import type { ClaudeUiQuestionRow } from '#features/code/be/services/claude-code/ui-presentation.ts'

const row: ClaudeUiQuestionRow = { messageId: 'message', id: 'dialog', revision: 'revision', sessionId: 'session', requestId: 'request' }
const frame = () => ({ tree: { type: 'Box', children: [{ type: 'Button', props: { key: 'refresh', label: 'Refresh' }, press: { plugin: 'fixture', handle: 1 } }, { type: 'engine', ref: 1 }] }, question: { token: 'issued-token', dialogId: 'dialog', revision: 'revision', shownInput: { questions: [] }, presentation: { previewFormat: 'markdown' as const, extendedQuestions: false, optionalDescriptions: false, previews: [] } }, props: {}, hooked: true, rewritten: true })
function fixture() {
  let pending: ClaudeUiQuestionRow | undefined = row
  const source = { ownerId: 'owner', render: vi.fn(async () => frame()), hold: vi.fn(async () => {}) }
  const ui = { press: vi.fn(async () => ({ handled: true })), input: vi.fn(async () => ({ handled: true })), select: vi.fn(async () => ({ handled: true })) }
  const create = (id: string) => createClaudeQuestionHost({ source, ui, client: { client_id: id, surface: 'desktop' }, row: () => pending, current: () => true, publish: vi.fn() })
  return { source, ui, create, replace(value?: ClaudeUiQuestionRow) { pending = value } }
}
function action(host: ReturnType<typeof createClaudeQuestionHost>) {
  const body = host.state?.body
  if (body?.status !== 'live' || body.tree.kind !== 'box' || body.tree.children?.[0]?.kind !== 'button') throw Error('Expected live button')
  return body.tree.children[0].actionId!
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('isolates view callbacks and retires a drawing while keeping its engine mounted during redraw', async () => {
  const f = fixture(), first = f.create('first'), second = f.create('second')
  first.start(); second.start(); await vi.advanceTimersByTimeAsync(50)
  const old = action(first)
  await expect(second.press(old)).resolves.toEqual({ handled: false })
  first.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render', instances: [{ component: 'AskUserQuestion', instance_id: 'foreign' }] })
  expect(action(first)).toBe(old)
  first.receive({ type: 'system', subtype: 'ui_invalidate', event: 'ui.render' })
  expect(first.state?.body).toMatchObject({ status: 'live', tree: { children: [{ kind: 'button' }, { kind: 'unsupported', component: 'engine' }] } })
  expect(action(first)).toBeUndefined()
  await expect(first.press(old)).resolves.toEqual({ handled: false })
  await vi.advanceTimersByTimeAsync(50)
  await expect(first.press(action(first))).resolves.toEqual({ handled: true })
  expect(f.ui.press).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ client_id: 'first', plugin: 'fixture', handle: 1 }))
  first.dispose(); second.dispose()
})
it('holds the token displayed at first input and rejects duplicate or foreign draft fields', async () => {
  const f = fixture(), host = f.create('view'); host.start(); await vi.advanceTimersByTimeAsync(50)
  const event = { actionId: host.state!.draftActionId, revision: 1, kind: 'change' as const, value: 'earlier-displayed-token' }
  await expect(host.field({ ...event, actionId: 'foreign' })).resolves.toEqual({ handled: false })
  await expect(host.field(event)).resolves.toEqual({ handled: true })
  await expect(host.field(event)).resolves.toEqual({ handled: false })
  expect(f.source.hold).toHaveBeenCalledExactlyOnceWith({ ...row, clientId: 'view', renderToken: 'earlier-displayed-token' })
  f.replace(); host.refresh()
  await expect(host.field({ ...event, revision: 2 })).resolves.toEqual({ handled: false })
  expect(host.state).toBeUndefined(); host.dispose()
})
it('discards a delayed drawing after dialog replacement or disposal', async () => {
  const f = fixture(); let resolve!: (value: ReturnType<typeof frame>) => void
  f.source.render.mockImplementationOnce(() => new Promise(yes => { resolve = yes }))
  const host = f.create('view'); host.start(); await vi.advanceTimersByTimeAsync(50)
  f.replace({ ...row, revision: 'new-revision' }); host.refresh(); resolve(frame())
  await vi.advanceTimersByTimeAsync(50)
  expect(host.state?.revision).toBe('new-revision')
  const id = action(host); host.dispose()
  await expect(host.press(id)).resolves.toEqual({ handled: false })
  expect(f.ui.press).not.toHaveBeenCalled()
})
