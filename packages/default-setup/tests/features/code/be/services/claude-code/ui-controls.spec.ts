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
  it('keeps native admission review distinct from a delivered Agent message', async () => {
    const request = vi.fn(async () => ({ kind: 'review', text: '', removed: 1 }))
    const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
    const result = await ui.submitAgent({ client_id: 'agent-ui', text: '\u200b' })
    expect(result).toEqual({ kind: 'review', text: '', removed: 1 }); expect(result).not.toHaveProperty('input')
  })

  it('retains Agent reply text and validates the original native human receipt', async () => {
    const request = vi.fn(async () => ({ kind: 'input', messageId: '12345678-1234-4234-8234-123456789abc', previousStatus: 'completed' }))
    const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
    await expect(ui.submitAgent({ client_id: 'agent-ui', text: '  Keep whitespace  ' })).resolves.toMatchObject({ kind: 'input', messageId: '12345678-1234-4234-8234-123456789abc' })
    expect(request).toHaveBeenCalledWith({ subtype: 'apack_ui_agent_dispatch', client_id: 'agent-ui', text: '  Keep whitespace  ' })
    await expect(ui.submitAgent({ client_id: 'agent-ui', text: ' ' })).rejects.toThrow()
    const print = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
    await expect(print.submitAgent({ client_id: 'parent-ui', text: 'Do not send' })).rejects.toThrow('capability is unavailable')
    expect(request).toHaveBeenCalledOnce()
  })

  it('requires terminal-owner capability before advertising a selected Agent prompt host', async () => {
    const request = vi.fn(async () => ({ surfaces: ['desktop'] }))
    const target = { session_id: 'native-session', revision: 4, agent_id: 'agent-one' }
    const print = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
    await expect(print.attach({ ...client, native_view: target })).rejects.toThrow('Agent UI attachment capability')
    expect(request).not.toHaveBeenCalled()
    const terminal = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
    await expect(terminal.attach({ ...client, native_view: target })).resolves.toEqual({ surfaces: ['desktop'] })
    expect(request).toHaveBeenCalledWith({ subtype: 'ui_attach', ...client, native_view: target, answers: [] })
    await expect(terminal.attach({ ...client, surface: 'mobile', native_view: target })).rejects.toThrow('requires desktop')
    await expect(terminal.attach({ ...client, native_view: { ...target, revision: 0 } })).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })

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
    const assertion = expect(rendering).rejects.toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ path: ['tree'] })]) })
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


it('preserves focus hold-only, container and redirected element reports', async () => {
  const f = fixture()
  const site = { ...client, component: 'AbovePrompt' as const, instance_id: 'above-prompt', by: 'person' as const, is_held: true }
  const held = f.ui.focus(site)
  await Promise.resolve()
  expect(f.writes[0]!.request).toEqual({ subtype: 'ui_focus', ...site })
  f.reply(0, { moved: false, element: null }); await expect(held).resolves.toEqual({ moved: false, element: null })
  const container = f.ui.focus({ ...site, element: null })
  await Promise.resolve()
  expect(f.writes[1]!.request).toEqual({ subtype: 'ui_focus', ...site, element: null })
  const redirect = { plugin: 'fixture-plugin', key: 'redirected' }
  f.reply(1, { moved: true, element: redirect }); await expect(container).resolves.toEqual({ moved: true, element: redirect })
  const denied = f.ui.focus({ ...site, by: 'auto', element: redirect })
  await Promise.resolve(); f.reply(2, { moved: false, element: null, deny: 'hook declined' })
  await expect(denied).resolves.toMatchObject({ moved: false, deny: 'hook declined' })
  await expect(f.ui.focus({ ...site, instance_id: 'x'.repeat(257) })).rejects.toThrow()
  expect(f.writes).toHaveLength(3); f.controls.close()
})

it('rejects malformed focus replies and gates focus on the UI capability', async () => {
  const options = { ...client, component: 'AbovePrompt' as const, instance_id: 'above-prompt', by: 'person' as const, is_held: false }
  const f = fixture(), pending = f.ui.focus(options)
  const rejected = expect(pending).rejects.toThrow()
  await Promise.resolve(); f.reply(0, { moved: true, element: { key: 'missing-plugin' } })
  await rejected; f.controls.close()
  const unavailable = fixture([])
  await expect(unavailable.ui.focus(options)).rejects.toThrow('capability is unavailable')
  expect(unavailable.writes).toEqual([]); unavailable.controls.close()
})


describe('native pane controls', () => {
  it('preserves roster manners and focus requests without requiring a model turn', async () => {
    const f = fixture()
    const pending = f.ui.panes(client.client_id)
    await Promise.resolve()
    expect(f.writes[0].request).toEqual({ subtype: 'ui_panes', client_id: client.client_id })
    const roster = { panes: [{ id: 'review-pane', title: '<Review>', plugin: 'fixture', close_on_escape: true, hold_toasts: true, rows: 8, columns: 40 }], shown_id: 'review-pane', focused_id: null, focus_requested_id: 'review-pane' }
    f.reply(0, roster); await expect(pending).resolves.toEqual(roster)
    f.controls.close()
  })
  it('uses separate show, focus/release and person-close verdicts, preserving refusal', async () => {
    const f = fixture()
    const selected = { ...client, id: 'review-pane' }
    const showing = f.ui.showPane(selected); await Promise.resolve()
    expect(f.writes[0].request).toEqual({ subtype: 'ui_pane_show', ...selected })
    f.reply(0, { shown_id: selected.id }); await expect(showing).resolves.toEqual({ shown_id: selected.id })
    const focus = f.ui.focusPane({ ...client, id: null }); await Promise.resolve()
    expect(f.writes[1].request).toEqual({ subtype: 'ui_pane_focus', ...client, id: null })
    f.reply(1, { focused_id: null }); await expect(focus).resolves.toEqual({ focused_id: null })
    const close = f.ui.closePane({ client_id: client.client_id, id: selected.id }); await Promise.resolve()
    expect(f.writes[2].request).toEqual({ subtype: 'ui_close', client_id: client.client_id, id: selected.id })
    f.reply(2, { closed: false }); await expect(close).resolves.toEqual({ closed: false })
    f.controls.close()
  })
  it('rejects absent capability, foreign-shaped identities and malformed roster data', async () => {
    const denied = fixture([])
    await expect(denied.ui.panes(client.client_id)).rejects.toThrow('capability is unavailable')
    expect(denied.writes).toEqual([]); denied.controls.close()
    const f = fixture()
    await expect(f.ui.closePane({ client_id: client.client_id, id: '../pane' })).rejects.toThrow()
    await expect(f.ui.focusPane({ ...client, id: '' })).rejects.toThrow()
    expect(f.writes).toEqual([])
    const roster = f.ui.panes(client.client_id); await Promise.resolve()
    f.reply(0, { panes: [{ id: 'pane', title: 'Pane', plugin: 'fixture', close_on_escape: false }], shown_id: 'pane', focused_id: null, focus_requested_id: null })
    await expect(roster).rejects.toThrow(); f.controls.close()
  })
})

it('preserves native scroll denial/follow-end and validates site geometry before writing', async () => {
  const f = fixture()
  const options = { ...client, component: 'Pane' as const, instance_id: 'review', offset: 3, by: -2, body_rows: 8, content_rows: 30, keyed: [{ plugin: 'fixture', key: 'target', top: 10, bottom: 12 }] }
  const pending = f.ui.scroll(options); await Promise.resolve()
  expect(f.writes[0].request).toEqual({ subtype: 'ui_scroll', ...options })
  f.reply(0, { moved: false, offset: 4, deny: 'kept', follow_end: true })
  await expect(pending).resolves.toMatchObject({ moved: false, offset: 4, follow_end: true })
  await expect(f.ui.scroll({ ...options, body_rows: -1 })).rejects.toThrow()
  expect(f.writes).toHaveLength(1); f.controls.close()
})

it('fences panel transport capability and refuses payload on read operations', async () => {
  const request = vi.fn(async () => ({ open: true })), panel_id = '12345678-1234-4234-8234-123456789abc'
  const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
  await expect(ui.agentPanel({ client_id: 'agent-ui', panel_id, operation: 'input', text: '\x1b' })).resolves.toEqual({ open: true })
  expect(request).toHaveBeenCalledWith({ subtype: 'apack_ui_agent_panel', client_id: 'agent-ui', panel_id, operation: 'input', text: '\x1b' })
  await expect(ui.agentPanel({ client_id: 'agent-ui', panel_id, operation: 'read', text: 'forged' } as never)).rejects.toThrow()
  const print = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
  await expect(print.agentPanel({ client_id: 'agent-ui', panel_id, operation: 'close' })).rejects.toThrow('capability')
  expect(request).toHaveBeenCalledOnce()
})

it('keeps instance lifetime metadata on the native adapter and never sends it to the original print transport', async () => {
  const request = vi.fn(async () => ({ tree: {}, props: {}, rewritten: false, hooked: false, released: true, handled: true }))
  const native = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_ui_instance_lifetime_v1'] }), { request })
  const scope = { client_id: 'view', component: 'ToolResult', instance_id: 'result', instance_revision: 2 }
  await native.releaseInstance(scope); expect(request).toHaveBeenLastCalledWith({ subtype: 'apack_ui_release_instance', ...scope })
  await native.render({ ...scope, surface: 'desktop', props: {} }); expect(request).toHaveBeenLastCalledWith({ subtype: 'ui_render', ...scope, surface: 'desktop', props: {} })
  const print = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
  request.mockClear(); expect(await print.releaseInstance(scope)).toEqual({ released: false }); expect(request).not.toHaveBeenCalled()
  await print.render({ ...scope, surface: 'desktop', props: {} }); expect(request).toHaveBeenLastCalledWith({ subtype: 'ui_render', client_id: 'view', component: 'ToolResult', instance_id: 'result', surface: 'desktop', props: {} })
  await print.press({ ...scope, surface: 'desktop', plugin: 'fixture', handle: 1 }); expect(request).toHaveBeenLastCalledWith({ subtype: 'ui_press', client_id: 'view', surface: 'desktop', plugin: 'fixture', handle: 1 })
})


it('discovers only native-adapter groups and validates source revisions before mounting',async()=>{
 const group={id:'native-group',anchorIds:[],members:[{toolUseId:'tool',revision:'b'.repeat(64)}],usesEngine:true,isActive:true,isExpanded:false,initialized:false,revision:'a'.repeat(64)}
 const request=vi.fn(async()=>({groups:[group]}))
 const print=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1']}),{request})
 await expect(print.toolGroups('view')).resolves.toEqual([]);expect(request).not.toHaveBeenCalled()
 const native=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1','apack_ui_instance_lifetime_v1']}),{request})
 await expect(native.toolGroups('view')).resolves.toEqual([group]);expect(request).toHaveBeenCalledWith({subtype:'apack_ui_tool_groups',client_id:'view'})
 request.mockResolvedValueOnce({groups:[{...group,revision:'not-a-source-revision'}]})
 await expect(native.toolGroups('view')).rejects.toThrow()
})

it('discovers only source-revision-bound composer placements on the native owner',async()=>{
 const request=vi.fn(async()=>({placements:[{component:'Spinner',id:'native-agent',revision:'a'.repeat(64)}]}))
 const ui=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1','apack_ui_instance_lifetime_v1']}),{request})
 await expect(ui.composerPlacements('view')).resolves.toHaveLength(1)
 expect(request).toHaveBeenCalledWith({subtype:'apack_ui_composer',client_id:'view'})
 const print=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1']}),{request})
 await expect(print.composerPlacements('view')).resolves.toEqual([])
 expect(request).toHaveBeenCalledTimes(1)
 request.mockResolvedValue({placements:[{component:'Spinner',id:'native-agent',revision:'wrong'}]})
 await expect(ui.composerPlacements('view')).rejects.toThrow()
})


describe('print Client projection', () => {
  const frame = { tree: { type: 'Text', children: ['original'] }, props: {}, rewritten: false, hooked: true }
  const request = { client_id: 'print-client', surface: 'desktop' as const, component: 'AbovePrompt', instance_id: 'above', instance_revision: 2, props: {} }
  const projection = () => ({ managedSettingsDiagnostics:vi.fn(async()=>[]), project: vi.fn(async (_request, value) => value), action: vi.fn(async () => undefined as unknown), event: vi.fn(async () => ({ handled: false })), release: vi.fn(async () => ({ released: true })), detach: vi.fn(async () => {}) })
  it('projects only after original public admission and keeps private revisions off the native schema', async () => {
    const bridge = projection(), native = vi.fn(async () => frame)
    const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request: native }, undefined, bridge)
    await expect(ui.render(request)).resolves.toEqual(frame)
    expect(native).toHaveBeenCalledWith({ subtype: 'ui_render', client_id: 'print-client', surface: 'desktop', component: 'AbovePrompt', instance_id: 'above', props: {} })
    expect(bridge.project).toHaveBeenCalledWith(request, frame)
    native.mockRejectedValueOnce(Error('original admission refused'))
    await expect(ui.render(request)).rejects.toThrow('original admission refused')
    expect(bridge.project).toHaveBeenCalledTimes(1)
    const { surface: _surface, props: _props, ...release } = request
    await expect(ui.releaseInstance(release)).resolves.toEqual({ released: true })
    expect(bridge.release).toHaveBeenCalledWith(release)
  })
  it('uses current Client actions without replaying them through public press and preserves native refusals', async () => {
    const bridge = projection(), native = vi.fn(async () => ({ handled: true }))
    bridge.action.mockResolvedValueOnce({ handled: false })
    const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request: native }, undefined, bridge)
    const action = { client_id: 'print-client', surface: 'desktop' as const, plugin: 'fixture', handle: 42 }
    await expect(ui.press(action)).resolves.toEqual({ handled: false }); expect(native).not.toHaveBeenCalled()
    await expect(ui.press(action)).resolves.toEqual({ handled: true }); expect(native).toHaveBeenCalledTimes(1)
    const unavailable = createClaudeUiControls(Promise.resolve({ capabilities: [] }), { request: native }, undefined, bridge)
    await expect(unavailable.press(action)).rejects.toThrow('capability')
    expect(bridge.action).toHaveBeenCalledTimes(2)
  })
})


it('admits only validated action keys on the existing native-owner transport', async () => {
  const action_keys = { revision: 'a'.repeat(64), bindings: [], continuations: [], pending: null }
  const request = vi.fn(async () => ({ handled: true, action_keys }))
  const native = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
  const key = { client_id: client.client_id, revision: action_keys.revision, event: { key: 'u', ctrl: true, alt: true, shift: false, super: false, from_composer: true } }
  await expect(native.key(key)).resolves.toEqual({ handled: true, action_keys })
  expect(request).toHaveBeenCalledWith({ subtype: 'apack_ui_action_key', ...key })
  await expect(native.key({ ...key, handle: 99 } as typeof key)).rejects.toThrow()
  const print = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
  await expect(print.key(key)).rejects.toThrow('native action keys are unavailable')
  expect(request).toHaveBeenCalledOnce()
})

it('ignores malformed optional key metadata without discarding a valid native drawing', async () => {
  const tree = { type: 'Button', props: { key: 'keep', label: 'Keep reviewing' }, press: { plugin: 'fixture', handle: 1 } }
  const request = vi.fn(async () => ({ tree, props: {}, rewritten: false, hooked: true, _apack_action_keys: { revision: 'invalid' } }))
  const ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1'] }), { request })
  const result = await ui.render({ ...client, component: 'AbovePrompt', instance_id: 'above', props: {} })
  expect(result.tree).toEqual(tree)
  expect(result._apack_action_keys).toBeUndefined()
})

it('reads original structured managed-settings diagnostics without treating them as permission decisions', async () => {
  const warning={file:'/etc/claude-code/managed-settings.json',path:'',message:'Settings file could not be read: EACCES',severity:'fatal',errno:'EACCES'}
  const request=vi.fn(async()=>({diagnostics:[warning]}))
  const ui=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1','apack_ui_instance_lifetime_v1']}),{request})
  await expect(ui.managedSettingsDiagnostics('owned')).resolves.toEqual([warning])
  expect(request).toHaveBeenCalledWith({subtype:'apack_ui_managed_settings_diagnostics',client_id:'owned'})
  request.mockResolvedValueOnce({diagnostics:[{...warning,message:'x'.repeat(32769)}]})
  await expect(ui.managedSettingsDiagnostics('owned')).rejects.toThrow()
})

it('reads print-owner policy diagnostics through its owned projection without terminal lifetime capability', async()=>{
 const warning={file:'managed settings',path:'',message:'Original unreadable file diagnostic',severity:'fatal' as const}
 const projection={managedSettingsDiagnostics:vi.fn(async()=>[warning]),project:vi.fn(async(_request,value)=>value),action:vi.fn(async()=>undefined),event:vi.fn(async()=>({handled:false})),release:vi.fn(async()=>({released:true})),detach:vi.fn(async()=>{})}
 const request=vi.fn();const ui=createClaudeUiControls(Promise.resolve({capabilities:['ui_surface_v1']}),{request},undefined,projection)
 await expect(ui.managedSettingsDiagnostics('print-view')).resolves.toEqual([warning]);expect(projection.managedSettingsDiagnostics).toHaveBeenCalledWith('print-view');expect(request).not.toHaveBeenCalled()
})


it('does not treat background snapshots as decision acknowledgements or the reverse', async () => {
  const request = vi.fn(async () => ({ open: true } as unknown)), ui = createClaudeUiControls(Promise.resolve({ capabilities: ['ui_surface_v1', 'apack_native_view_v1'] }), { request })
  const identity = { client_id: 'client', panel_id: crypto.randomUUID() }
  await expect(ui.backgroundReview({ ...identity, operation: 'read' })).resolves.toEqual({ open: true })
  await expect(ui.backgroundReview({ ...identity, operation: 'confirm', revision: crypto.randomUUID() })).rejects.toThrow()
  request.mockResolvedValue({ answered: true })
  await expect(ui.backgroundReview({ ...identity, operation: 'read' })).rejects.toThrow()
})
