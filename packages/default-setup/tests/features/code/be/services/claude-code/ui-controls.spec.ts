import { createClaudeUiControls } from '#features/code/be/services/claude-code/ui-controls.ts'
import { createHostControls } from '#features/code/be/services/claude-code/host-controls.ts'

function fixture(capabilities: string[] = ['ui_surface_v1']) {
  const writes: Array<{ request_id: string; request: Record<string, unknown> }> = []
  const controls = createHostControls(value => { writes.push(value as typeof writes[number]); return true })
  const ui = createClaudeUiControls(Promise.resolve({ commands: [], agents: [], models: [], capabilities }), controls)
  return { ui, controls, writes, reply(index: number, response: unknown) {
    controls.receive({ response: { request_id: writes[index]!.request_id, subtype: 'success', response } })
  } }
}
const client = { client_id: 'fixture-ui', surface: 'desktop' as const }

describe('native UI transport', () => {
  it('gates on initialization without requiring a system/init event or a model turn', async () => {
    let ready!: (value: { commands: []; agents: []; models: []; capabilities: string[] }) => void
    const initialized = new Promise<{ commands: []; agents: []; models: []; capabilities: string[] }>(resolve => { ready = resolve })
    const request = vi.fn(async () => ({ surfaces: ['desktop'] }))
    const ui = createClaudeUiControls(initialized, { request })
    const attaching = ui.attach(client)
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
    ready({ commands: [], agents: [], models: [], capabilities: ['ui_surface_v1'] })
    await expect(attaching).resolves.toEqual({ surfaces: ['desktop'] })
    expect(request).toHaveBeenCalledWith({ subtype: 'ui_attach', ...client, answers: [] })
  })

  it('rejects absent capability and invalid client IDs without writing control requests', async () => {
    const f = fixture([])
    await expect(f.ui.attach(client)).rejects.toThrow('capability is unavailable')
    await expect(f.ui.attach({ ...client, client_id: 'reserved:client' })).rejects.toThrow()
    expect(f.writes).toEqual([])
    f.controls.close()
  })

  it('preserves tree capabilities and attribution, then propagates stale press and detach verdicts', async () => {
    const f = fixture()
    const rendering = f.ui.render({ ...client, component: 'AbovePrompt', instance_id: 'fixture-above', props: {} })
    await Promise.resolve()
    const tree = { type: 'Button', props: { key: 'run' }, press: { plugin: 'fixture-plugin', handle: 42 } }
    f.reply(0, { tree, props: {}, rewritten: true, hooked: true, drawn_by: ['fixture-plugin'] })
    const rendered = await rendering
    expect(rendered.tree).toEqual(tree)
    expect(rendered.drawn_by).toEqual(['fixture-plugin'])
    const pressing = f.ui.press({ ...client, ...tree.press, key: tree.props.key })
    await Promise.resolve()
    expect(f.writes[1]!.request).toEqual({ subtype: 'ui_press', ...client, plugin: 'fixture-plugin', handle: 42, key: 'run' })
    f.reply(1, { handled: false })
    await expect(pressing).resolves.toEqual({ handled: false })
    const detaching = f.ui.detach(client.client_id)
    await Promise.resolve()
    f.reply(2, { detached: false, surfaces: [] })
    await expect(detaching).resolves.toEqual({ detached: false, surfaces: [] })
    f.controls.close()
  })

  it('rejects malformed native render data and native errors instead of treating them as empty drawings', async () => {
    const f = fixture()
    const rendering = f.ui.render({ ...client, component: 'AbovePrompt', instance_id: 'fixture-above', props: {} })
    const assertion = expect(rendering).rejects.toThrow('must contain a tree')
    await Promise.resolve()
    f.reply(0, { props: {}, rewritten: false, hooked: false })
    await assertion
    const pressing = f.ui.press({ ...client, plugin: 'fixture-plugin', handle: 42 })
    const rejected = expect(pressing).rejects.toThrow('process exited')
    await Promise.resolve()
    f.controls.close(new Error('process exited'))
    await rejected
    await expect(f.ui.detach(client.client_id)).rejects.toThrow('process exited')
  })
  it('correlates field edits and picks with keyed native redraw identity and preserves rewritten values', async () => {
    const f = fixture()
    const identity = { ...client, plugin: 'fixture-plugin', handle: 42, key: 'field', component: 'AbovePrompt', instance_id: 'fixture-above' }
    const editing = f.ui.input({ ...identity, kind: 'change', value: 'first\nsecond' })
    await Promise.resolve()
    expect(f.writes[0]!.request).toEqual({ subtype: 'ui_input', ...identity, kind: 'change', value: 'first\nsecond' })
    f.reply(0, { handled: true, element: 'field', value: 'rewritten' })
    await expect(editing).resolves.toEqual({ handled: true, element: 'field', value: 'rewritten' })
    const selecting = f.ui.select({ ...identity, value: 'unknown' })
    await Promise.resolve()
    expect(f.writes[1]!.request).toEqual({ subtype: 'ui_select', ...identity, value: 'unknown' })
    f.reply(1, { handled: false })
    await expect(selecting).resolves.toEqual({ handled: false })
    await expect(f.ui.input({ ...identity, kind: 'submit', value: 'x'.repeat(16385) })).rejects.toThrow()
    expect(f.writes).toHaveLength(2)
    f.controls.close()
  })

  it('keeps programmatic adoption separate from person edits and preserves native prompt frames', async () => {
    const f = fixture()
    const edit = f.ui.promptEdit({ ...client, by: 'person', text: 'hello', cursor: 5 })
    await Promise.resolve()
    expect(f.writes[0]!.request).toEqual({ subtype: 'ui_prompt_edit', ...client, by: 'person', text: 'hello', cursor: 5 })
    const frame = { text: 'HELLO', cursor: 5, decorations: [{ start: 0, end: 5, bold: true }] }
    f.reply(0, frame); await expect(edit).resolves.toEqual(frame)
    const adoption = f.ui.promptEdit({ ...client, by: 'app', text: '', cursor: 0 })
    await Promise.resolve(); f.reply(1, { text: '', cursor: 0, superseded: true })
    await expect(adoption).resolves.toEqual({ text: '', cursor: 0, superseded: true })
    await expect(f.ui.promptEdit({ ...client, by: 'app', text: '', cursor: 0, key: { key: 'return' } })).rejects.toThrow('no key')
    expect(f.writes).toHaveLength(2)
    f.controls.close()
  })

  it('rejects malformed native caret and decoration frames', async () => {
    const f = fixture()
    const edit = f.ui.promptEdit({ ...client, by: 'person', text: 'a', cursor: 1 })
    const assertion = expect(edit).rejects.toThrow('decoration range')
    await Promise.resolve(); f.reply(0, { text: 'a', cursor: 1, decorations: [{ start: 0, end: 2 }] })
    await assertion; f.controls.close()
  })

})


it('validates native autocomplete rows and token boundaries while preserving supersession', async () => {
  const f = fixture()
  const pending = f.ui.promptAutocomplete({ ...client, text: 'prefix tok', cursor: 10 })
  await vi.waitFor(() => expect(f.writes).toHaveLength(1))
  expect(f.writes[0]!.request).toEqual({ subtype: 'ui_prompt_autocomplete', ...client, text: 'prefix tok', cursor: 10 })
  f.reply(0, { start: 7, suggestions: [{ text: 'token', label: 'Token', description: 'Native description' }] })
  await expect(pending).resolves.toMatchObject({ start: 7, suggestions: [{ text: 'token' }] })
  const stale = f.ui.promptAutocomplete({ ...client, text: 'tok', cursor: 3 })
  await vi.waitFor(() => expect(f.writes).toHaveLength(2)); f.reply(1, { suggestions: [], superseded: true })
  await expect(stale).resolves.toEqual({ suggestions: [], superseded: true })
  const invalid = f.ui.promptAutocomplete({ ...client, text: 'tok', cursor: 3 })
  const rejected = expect(invalid).rejects.toThrow('token range')
  await vi.waitFor(() => expect(f.writes).toHaveLength(3)); f.reply(2, { suggestions: [{ text: 'token' }], start: 4 })
  await rejected
})
