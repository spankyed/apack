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

  it.each([null, [], { type: 'Box', children: false }, { type: 'Text', children: 'bad' },
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


it('keeps keyed field authority through redraws and refuses ambiguous keys', () => {
  const input = { type: 'Input', props: { key: 'draft', rows: 3, value: 'first\nsecond' }, press: { plugin: 'fixture', handle: 1 } }
  const first = createClaudeUiDrawing(input)
  const second = createClaudeUiDrawing({ ...input, press: { plugin: 'fixture', handle: 2 } }, first)
  expect(second.tree).toMatchObject({ kind: 'input', rows: 3, value: 'first\nsecond' })
  expect([...second.fields.keys()]).toEqual([...first.fields.keys()])
  expect([...second.fields.values()][0]!.handle).toBe(2)
  expect(() => createClaudeUiDrawing({ type: 'Box', children: [input, input] })).toThrow()
  expect(() => createClaudeUiDrawing({ type: 'Select', props: { key: 'pick', options: [{ value: 'a' }, { value: 'a' }] }, press: input.press })).toThrow('ambiguous')
})


it('keeps document text literal and scopes Markdown link callbacks without exposing handles', () => {
  const drawing = createClaudeUiDrawing({ type: 'Markdown', props: { key: 'doc', text: '**Hello**', dimColor: true, pressableLinks: ['https://example.com/'] }, press: { plugin: 'fixture', handle: 8 } })
  expect(drawing.tree).toMatchObject({ kind: 'markdown', text: '**Hello**', dim: true })
  const [actionId, capability] = [...drawing.actions][0]!
  expect(capability).toEqual({ plugin: 'fixture', handle: 8, key: 'doc' })
  expect(drawing.links.get(actionId)?.has('https://example.com/')).toBe(true)
  expect(JSON.stringify(drawing.tree)).not.toContain('handle')
  expect(createClaudeUiDrawing({ type: 'Code', props: { source: '<script>bad()</script>', path: 'fixture.ts', startLine: 9 } }).tree).toEqual({ kind: 'code', source: '<script>bad()</script>', path: 'fixture.ts', startLine: 9, format: 'source', wrap: 'wrap' })
  expect(() => createClaudeUiDrawing({ type: 'Markdown', props: { key: 'doc', text: 'x', pressableLinks: [1] } })).toThrow()
})


it('preserves nested inline text styles and accepts empty native containers', () => {
  expect(createClaudeUiDrawing({ type: 'Box' }).tree).toEqual({ kind: 'box', children: [] })
  expect(createClaudeUiDrawing({ type: 'Text' }).tree).toEqual({ kind: 'text', text: '' })
  expect(createClaudeUiDrawing({ type: 'Text', props: { weight: 'medium', dir: 'rtl', mono: true }, children: ['Hello ', { type: 'Text', props: { italic: true }, children: ['world'] }] }).tree)
    .toEqual({ kind: 'text', text: '', style: { weight: 'medium', dir: 'rtl', mono: true }, children: [{ kind: 'text', text: 'Hello ' }, { kind: 'text', text: 'world', style: { italic: true } }] })
  expect(() => createClaudeUiDrawing({ type: 'Text', props: { weight: 'evil' } })).toThrow('protocol error')
})

it('keeps unsafe Link targets inert while preserving labels and inline children', () => {
  for (const href of ['javascript:alert(1)', 'file:///tmp/secret', 'http://example.com/', 'https://example.com/\nspoof']) {
    expect(createClaudeUiDrawing({ type: 'Link', props: { href, label: 'Read' } }).tree).toEqual({ kind: 'link', children: [{ kind: 'text', text: 'Read' }] })
  }
  for (const href of ['https://example.com/', 'http://localhost:8080/']) {
    const drawing = createClaudeUiDrawing({ type: 'Link', props: { href }, children: [{ type: 'Text', props: { bold: true }, children: ['Open'] }] })
    expect(drawing.tree).toMatchObject({ kind: 'link', href, children: [{ kind: 'text', text: 'Open', style: { bold: true } }] })
    expect(drawing.actions.size).toBe(0)
  }
})
