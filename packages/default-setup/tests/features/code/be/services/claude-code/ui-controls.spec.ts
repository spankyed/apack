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
})
