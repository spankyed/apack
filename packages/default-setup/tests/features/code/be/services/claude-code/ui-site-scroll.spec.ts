import { createClaudeSiteScroll } from '#features/code/be/services/claude-code/ui-site-scroll.ts'
import { createClaudeUiDrawing } from '#features/code/be/services/claude-code/ui-tree.ts'

const report = (revision: number, by = 0) => ({ revision, by, offset: revision, rows: 5, contentRows: 30, keyed: [] })
function fixture() {
  let current = true
  const drawing = createClaudeUiDrawing({ type: 'Box', props: { key: 'target' }, part: { plugin: 'fixture' } })
  const ui = { scroll: vi.fn(async (_request: unknown) => ({ moved: true, offset: 2 })) }, publish = vi.fn()
  const host = createClaudeSiteScroll({ ui, client: { client_id: 'view', surface: 'desktop' }, component: 'Pane', instanceId: 'review', current: () => current, drawing: () => drawing, publish })
  return { host, ui, publish, drawing, replace: () => { current = false } }
}
it('maps only current opaque keyed regions to native names and preserves denied offsets', async () => {
  const f = fixture(), id = [...f.drawing.scrollTargets.keys()][0]
  f.ui.scroll.mockResolvedValueOnce({ moved: false, offset: 1 })
  f.host.report({ ...report(1), keyed: [{ id, top: 6, bottom: 8 }, { id: 'foreign', top: 0, bottom: 1 }] })
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalled())
  expect(f.ui.scroll).toHaveBeenCalledWith(expect.objectContaining({ component: 'Pane', instance_id: 'review', keyed: [{ plugin: 'fixture', key: 'target', top: 6, bottom: 8 }] }))
  expect(f.host.state).toMatchObject({ requestRevision: 1, offset: 1, followEnd: false })
  f.host.dispose()
})
it('folds queued person deltas and publishes only the latest request', async () => {
  const f = fixture(); let answer!: (value: { moved: boolean; offset: number }) => void
  f.ui.scroll.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
  f.host.report(report(1, 1)); f.host.report({ ...report(2, 2), pointer: { column: 1, row: 2 } }); f.host.report({ ...report(3, -1), pointer: { column: 5, row: 4 } })
  expect(f.ui.scroll).toHaveBeenCalledTimes(1)
  answer({ moved: true, offset: 1 })
  await vi.waitFor(() => expect(f.ui.scroll).toHaveBeenCalledTimes(2))
  expect(f.ui.scroll.mock.calls[1][0]).toMatchObject({ by: 1, offset: 3, pointer: { column: 5, row: 4 } })
  expect(f.publish).toHaveBeenCalledTimes(1); expect(f.host.state?.requestRevision).toBe(3)
  f.host.dispose()
})
it('lets a matching plugin push supersede in-flight replies and pending older gestures', async () => {
  const f = fixture(); let answer!: (value: { moved: boolean; offset: number }) => void
  f.ui.scroll.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
  f.host.report(report(1, 1)); f.host.report(report(2, 2))
  f.host.receive({ type: 'system', subtype: 'ui_scroll', client_id: 'foreign', component: 'Pane', instance_id: 'review', offset: 8 })
  expect(f.publish).not.toHaveBeenCalled()
  f.host.receive({ type: 'system', subtype: 'ui_scroll', client_id: 'view', component: 'Pane', instance_id: 'review', offset: 20, follow_end: true })
  answer({ moved: true, offset: 1 }); await Promise.resolve(); await Promise.resolve()
  expect(f.publish).toHaveBeenCalledTimes(1); expect(f.host.state).toMatchObject({ offset: 20, followEnd: true })
  expect(f.ui.scroll).toHaveBeenCalledTimes(1); f.host.dispose()
})
it('ignores malformed reports and late output after disposal or owner replacement', async () => {
  const f = fixture(); f.host.report({ ...report(1), keyed: [{ id: 'a', top: 4, bottom: 3 }] })
  f.host.report({ ...report(1), pointer: { column: NaN, row: 1 } })
  expect(f.ui.scroll).not.toHaveBeenCalled(); f.replace(); f.host.report(report(2)); expect(f.ui.scroll).not.toHaveBeenCalled()
  f.host.dispose(); f.host.receive({ type: 'system', subtype: 'ui_scroll', client_id: 'view', component: 'Pane', instance_id: 'review', offset: 2 })
  expect(f.publish).not.toHaveBeenCalled()
})
it('does not register ambiguous plugin/key pairs as scroll targets', () => {
  const box = { type: 'Box', part: { plugin: 'fixture' }, props: { key: 'same' } }
  const drawing = createClaudeUiDrawing({ type: 'Box', children: [box, structuredClone(box)] })
  expect(drawing.scrollTargets.size).toBe(0)
})
