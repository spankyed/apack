import { createClaudeUiDrawing } from '#features/code/be/services/claude-code/ui-tree.ts'

const button = () => ({ type: 'Button', props: { key: 'run', label: 'Run fixture', onclick: 'ignored' }, press: { plugin: 'fixture', handle: 42 } })

describe('native UI presentation boundary', () => {
  it('keeps native callback authority out of the presentation and issues fresh action IDs per drawing', () => {
    const wire = { type: 'Box', part: { plugin: 'fixture' }, children: [
      { type: 'Text', children: ['Synthetic count: ', '0'] }, button(), { type: 'engine', ref: 7 },
    ] }
    const first = createClaudeUiDrawing(wire)
    const second = createClaudeUiDrawing(wire)
    expect(first.tree).toMatchObject({ kind: 'box', plugin: 'fixture', children: [
      { kind: 'text', text: 'Synthetic count: 0' }, { kind: 'button', label: 'Run fixture' }, { kind: 'unsupported', component: 'engine' },
    ] })
    expect(first.actions.size).toBe(1)
    const [id, capability] = [...first.actions][0]!
    expect(capability).toEqual({ plugin: 'fixture', handle: 42, key: 'run' })
    expect(second.actions.has(id)).toBe(false)
    expect(JSON.stringify(first.tree)).not.toMatch(/handle|onclick|"ref"|"press"/)
  })

  it('renders unknown components inert without registering their callbacks or forwarding props', () => {
    const result = createClaudeUiDrawing({ type: 'Client', props: { html: '<script>bad()</script>' }, children: [button()] })
    expect(result.tree).toEqual({ kind: 'unsupported', component: 'Client' })
    expect(result.actions.size).toBe(0)
    expect(createClaudeUiDrawing({ type: 'Button', props: { label: 'Unavailable' } }).tree).toEqual({ kind: 'button', label: 'Unavailable' })
  })

  it.each([null, [], { type: 'Box' }, { type: 'Text', children: 'bad' },
    { ...button(), press: { plugin: 'fixture', handle: 0.5 } },
    { ...button(), props: { label: 'Run', key: 3 } },
  ])('rejects malformed supported nodes: %j', tree => {
    expect(() => createClaudeUiDrawing(tree)).toThrow('protocol error')
  })

  it('refuses oversized content even inside properties of unsupported components', () => {
    expect(() => createClaudeUiDrawing({ type: 'Client', props: { ignored: 'x'.repeat(262145) } })).toThrow('payload limit')
    expect(() => createClaudeUiDrawing({ type: 'Client', props: { ignored: '😀'.repeat(65537) } })).toThrow('payload limit')
    expect(() => createClaudeUiDrawing({ type: 'Box', children: Array.from({ length: 1025 }, () => '') })).toThrow('node limit')
  })

  it('bounds nesting and rejects cycles without recursive serialization', () => {
    let tree: unknown = 'leaf'
    for (let i = 0; i < 40; i++) tree = { type: 'Box', children: [tree] }
    expect(() => createClaudeUiDrawing(tree)).toThrow('structural limits')
    const cycle: Record<string, unknown> = { type: 'Client' }
    cycle.self = cycle
    expect(() => createClaudeUiDrawing(cycle)).toThrow('repeated object references')
  })
})
