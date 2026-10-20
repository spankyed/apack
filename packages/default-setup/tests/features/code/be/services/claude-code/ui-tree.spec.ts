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


it('preserves declared Box layout and refuses CSS injection or invalid geometry', () => {
  const props = { flexDirection: 'row', flexWrap: 'wrap', gap: 'sm', width: '100%', paddingX: 2, top: -1, flexGrow: 1 }
  expect(createClaudeUiDrawing({ type: 'Box', props }).tree).toEqual({ kind: 'box', children: [], layout: props })
  for (const props of [{ display: 'block' }, { width: 'url(https://example.com/)' }, { padding: 10001 }, { left: 0.5 }, { gap: 'huge' }, { flexShrink: 10001 }]) {
    expect(() => createClaudeUiDrawing({ type: 'Box', props })).toThrow('protocol error')
  }
})


it('maps native SVG data without callback authority and enforces source/dimension/leaf bounds', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
  expect(createClaudeUiDrawing({ type: 'Svg', props: { source, alt: 'Native drawing', width: 40.5, height: 30, isInteractive: true } }).tree).toEqual({ kind: 'svg', source, alt: 'Native drawing', width: 40.5, height: 30, interactive: true })
  for (const props of [{ source: '', alt: 'x' }, { source: 'x'.repeat(131073), alt: 'x' }, { source, alt: 'x', width: 0 }, { source, alt: 'x', height: 4097 }, { source, alt: 'x', isInteractive: 'yes' }]) expect(() => createClaudeUiDrawing({ type: 'Svg', props })).toThrow('protocol error')
  expect(() => createClaudeUiDrawing({ type: 'Svg', props: { source, alt: 'x' }, children: [] })).toThrow('protocol error')
})


it('preserves native Button inline labels and presentation with one action', () => {
  const drawing = createClaudeUiDrawing({ type: 'Button', props: { key: 'save', label: 'Save 2', variant: 'primary', dimColor: true, role: 'dismiss', autoFocus: true },
    press: { plugin: 'fixture', handle: 7 }, children: ['Save ', { type: 'Text', props: { dimColor: true }, children: ['2'] }] })
  expect(drawing.tree).toMatchObject({ kind: 'button', label: 'Save 2', variant: 'primary', dimColor: true, role: 'dismiss', autoFocus: true,
    children: [{ kind: 'text', text: 'Save ' }, { kind: 'text', text: '2', style: { dimColor: true } }] })
  expect(drawing.actions.size).toBe(1)
})
it('rejects interactive descendants and malformed Button presentation', () => {
  const base = { type: 'Button', props: { label: 'Run' } }
  for (const children of [[button()], [{ type: 'Text', children: [button()] }], 'Run']) expect(() => createClaudeUiDrawing({ ...base, children })).toThrow()
  for (const props of [{ variant: 'danger' }, { dimColor: 'yes' }, { role: 'admin' }, { autoFocus: false }]) expect(() => createClaudeUiDrawing({ ...base, props: { label: 'Run', ...props } })).toThrow()
})


it('retains native Text colors and Box paint as data while rejecting invalid property types', () => {
  const paint = { borderStyle: 'round', borderColor: 'warning', borderDimColor: true, backgroundColor: 'rgb(1, 2, 3)' }
  expect(createClaudeUiDrawing({ type: 'Box', props: paint, children: [{ type: 'Text', props: { color: 'success', backgroundColor: 'navy' }, children: ['Painted'] }] }).tree)
    .toEqual({ kind: 'box', paint, children: [{ kind: 'text', text: 'Painted', style: { color: 'success', backgroundColor: 'navy' } }] })
  for (const props of [{ borderColor: 1 }, { borderStyle: {} }, { backgroundColor: [] }, { borderDimColor: 'true' }]) expect(() => createClaudeUiDrawing({ type: 'Box', props })).toThrow()
  expect(() => createClaudeUiDrawing({ type: 'Text', props: { color: {} } })).toThrow()
})


it('maps keyed Box and plugin-owned hover groups independently of root attribution', () => {
  const drawing = createClaudeUiDrawing({ type: 'Box', props: { key: 'row', borderStyle: 'single' }, hover: { borderColor: 'success' }, children: [
    { type: 'Text', props: { inverse: true }, hover: { scope: 'same', color: 'warning', inverse: false }, group: { plugin: 'owner' }, part: { plugin: 'attribution' }, children: ['Grouped'] },
    { type: 'Button', props: { key: 'go', label: 'Go' }, hover: { scope: 'same', bold: true }, press: { plugin: 'owner', handle: 4 } },
    { type: 'Box', props: { position: 'absolute', display: 'none' }, hover: { display: 'flex', left: -2 } },
  ] })
  expect(drawing.tree).toMatchObject({ kind: 'box', boxKey: 'row', hover: { paint: { borderColor: 'success' } }, children: [
    { kind: 'text', plugin: 'attribution', style: { inverse: true }, hover: { group: JSON.stringify(['owner', 'same']), text: { color: 'warning', inverse: false } } },
    { kind: 'button', hover: { group: JSON.stringify(['owner', 'same']), text: { bold: true } } },
    { kind: 'box', hover: { layout: { display: 'flex', left: -2 } } },
  ] })
  expect(drawing.actions.size).toBe(1)
  expect(createClaudeUiDrawing({ type: 'Box', props: { key: 42 } }).tree).toHaveProperty('boxKey', false)
})
it('rejects hover groups without ownership and hover changes that alter normal flow', () => {
  for (const node of [
    { type: 'Text', hover: { scope: 'group', color: 'red' } },
    { type: 'Text', hover: { scope: 'bad\nname' }, group: { plugin: 'fixture' } },
    { type: 'Text', hover: { color: 1 } },
    { type: 'Text', hover: { position: 'absolute' } },
    { type: 'Box', hover: { borderStyle: 'double' } },
    { type: 'Box', hover: { display: 'flex' } },
    { type: 'Box', props: { display: 'none' }, hover: { display: 'none' } },
    { type: 'Box', hover: { left: 2 } },
  ]) expect(() => createClaudeUiDrawing(node)).toThrow()
})


it('preserves one native Button hotkey and refuses malformed bindings', () => {
  expect(createClaudeUiDrawing({ type: 'Button', props: { label: 'Run', hotkey: 'w' } }).tree).toMatchObject({ kind: 'button', hotkey: 'w' })
  for (const hotkey of ['W', 'ab', '!', '1\n', 1]) expect(() => createClaudeUiDrawing({ type: 'Button', props: { label: 'Run', hotkey } })).toThrow()
})


it.each([0, -1, 1.5, 1_000_000_001])('refuses Code line numbers outside the native contract: %s', startLine => {
  expect(() => createClaudeUiDrawing({ type: 'Code', props: { source: 'literal', startLine } })).toThrow()
})


it('inherits native root ownership for nested scroll targets and honors a nested part override', () => {
  const drawing = createClaudeUiDrawing({ type: 'Box', part: { plugin: 'outer' }, children: [
    { type: 'Box', props: { key: 'outer-target' }, children: [{ type: 'Text', children: ['Outer'] }] },
    { type: 'Box', part: { plugin: 'inner' }, children: [{ type: 'Box', props: { key: 'inner-target' } }] },
  ] })
  expect([...drawing.scrollTargets.values()]).toEqual([{ plugin: 'outer', key: 'outer-target' }, { plugin: 'inner', key: 'inner-target' }])
  expect(drawing.tree).toMatchObject({ kind: 'box', plugin: 'outer', children: [{ kind: 'box', plugin: 'outer', scrollId: expect.any(String) }, { kind: 'box', plugin: 'inner' }] })
})

it('isolates repeated field keys in separate Client instances while preserving each field across redraws',()=>{
 const left='9b08a63e-78f6-46c5-9134-c6c64de30937',right='ea5a1bb0-1aa2-4273-959f-fc396615526b',replacement='17a0d431-59eb-4a22-aa23-a99724c9c5d3'
 const fields=(handle:number)=>[{type:'Input',props:{key:'draft',value:'',rows:1},press:{plugin:'fixture',handle}},{type:'Select',props:{key:'choice',value:'a',options:[{value:'a'},{value:'b'}]},press:{plugin:'fixture',handle:handle+1}}]
 const client=(id:string,handle:number)=>({type:'NativeClient',props:{id,pointer:false,keys:true},part:{plugin:'fixture'},children:fields(handle)})
 const first=createClaudeUiDrawing({type:'Box',children:[client(left,1),client(right,3)]})
 expect(first.fields.size).toBe(4)
 const second=createClaudeUiDrawing({type:'Box',children:[client(left,11),client(right,13)]},first)
 expect([...second.fields.keys()]).toEqual([...first.fields.keys()])
 expect([...second.fields.values()].map(field=>[field.clientInstance,field.handle])).toEqual([[left,11],[left,12],[right,13],[right,14]])
 const fresh=createClaudeUiDrawing({type:'Box',children:[client(replacement,21),client(right,23)]},second)
 const leftOld=[...second.fields].filter(([,field])=>field.clientInstance===left).map(([id])=>id)
 expect(leftOld.some(id=>fresh.fields.has(id))).toBe(false)
 for(const [id,field]of second.fields)if(field.clientInstance===right)expect(fresh.fields.has(id)).toBe(true)
 const duplicate=client(left,1);duplicate.children=[fields(1)[0]!,fields(2)[0]!]
 expect(()=>createClaudeUiDrawing(duplicate)).toThrow('ambiguous')
 expect(JSON.stringify(second.tree)).not.toMatch(/clientInstance|handle|requestId/)
})

it('preserves resolved button paint and validates its transport values', () => {
 const draw=createClaudeUiDrawing({type:'Button',props:{label:'Native',color:'#123456',hotkeyColor:'rgb(1,2,3)'}})
 expect(draw.tree).toMatchObject({kind:'button',color:'#123456',hotkeyColor:'rgb(1,2,3)'})
 expect(()=>createClaudeUiDrawing({type:'Button',props:{label:'Invalid',color:42}})).toThrow('button color')
})

it('validates private field theme roles without changing keyed field authority', () => {
  const wire = { type: 'Input', props: { key: 'draft', value: 'retained', _apackFieldTheme: { text: '#112233', inverseText: '#ddeeff' } }, press: { plugin: 'fixture', handle: 3 } }
  const first = createClaudeUiDrawing(wire)
  const second = createClaudeUiDrawing({ ...wire, props: { ...wire.props, _apackFieldTheme: { text: '#abcdef', inverseText: '#010203' } } }, first)
  expect(second.tree).toMatchObject({ kind: 'input', value: 'retained', theme: { text: '#abcdef', inverseText: '#010203' } })
  expect([...second.fields.keys()]).toEqual([...first.fields.keys()])
  for (const theme of [null, { text: '#fff' }, { text: false, inverseText: '#000' }, { text: 'x'.repeat(257), inverseText: '#000' }]) {
    expect(() => createClaudeUiDrawing({ ...wire, props: { ...wire.props, _apackFieldTheme: theme } })).toThrow('field theme')
  }
})

it('admits document paint and bounded original Code output without changing structured content or Markdown callbacks', () => {
  const drawing = createClaudeUiDrawing({ type: 'Box', children: [{ type: 'Link', props: { href: 'https://example.com', _apackDocumentTheme: { text: '#123456' } } }, { type: 'Code', props: { source: 'original', _apackCodeAnsi: '\x1b[31mdrawn\x1b[39m', _apackDocumentTheme: { text: '#abcdef' } } }, { type: 'Markdown', props: { key: 'doc', text: '[Link](https://example.com)', _apackDocumentTheme: { text: '#123456' } }, press: { plugin: 'fixture', handle: 8 } }] })
  expect(drawing.tree).toMatchObject({ children: [{ kind: 'link', color: '#123456' }, { kind: 'code', source: 'original', nativeAnsi: '\x1b[31mdrawn\x1b[39m', color: '#abcdef' }, { kind: 'markdown', color: '#123456', text: '[Link](https://example.com)' }] })
  expect(drawing.actions.size).toBe(1)
  expect(() => createClaudeUiDrawing({ type: 'Code', props: { source: 'x', _apackCodeAnsi: 1 } })).toThrow('drawing is invalid')
  expect(() => createClaudeUiDrawing({ type: 'Markdown', props: { text: 'x', _apackDocumentTheme: { text: '\n' } } })).toThrow('theme is invalid')
})


it.each(['wrap', 'end', 'middle', 'truncate', 'truncate-start', 'truncate-middle', 'truncate-end'])('preserves the declared native Text wrapping mode %s', wrap => {
  expect(createClaudeUiDrawing({ type: 'Text', props: { wrap }, children: ['release ', { type: 'Text', props: { bold: true }, children: ['notes'] }] }).tree)
    .toMatchObject({ kind: 'text', style: { wrap }, children: [{ text: 'release ' }, { text: 'notes', style: { bold: true } }] })
})
it.each(['ellipsis', 'wrap-stream', false, 0, {}])('rejects undeclared native Text wrapping mode %j', wrap => {
  expect(() => createClaudeUiDrawing({ type: 'Text', props: { wrap }, children: ['notes'] })).toThrow('native Text style is invalid')
})

it('presents a native-validated Raster as inert fixed cells without actions or pixel/file source',()=>{
 const result=createClaudeUiDrawing({type:'NativeRaster',props:{columns:8,rows:2,ansi:'Release \nready   '},part:{plugin:'native'}})
 expect(result.tree).toEqual({kind:'raster',columns:8,rows:2,nativeAnsi:'Release \nready   ',plugin:'native'});expect(result.actions.size).toBe(0)
 expect(()=>createClaudeUiDrawing({type:'NativeRaster',props:{columns:513,rows:1,ansi:'bad'}})).toThrow('Invalid native Raster')
})

it('accepts inert byte Images without source paths/actions and rejects invalid byte dimensions',()=>{
 const props={columns:8,rows:2,alt:'Native cover',format:'rgba',data:'/4gA/w==',width:1,height:1}
 const drawing=createClaudeUiDrawing({type:'NativeImage',props,part:{plugin:'native'}})
 expect(drawing.tree).toEqual({kind:'image',...props,plugin:'native'});expect(drawing.actions.size).toBe(0)
 for(const override of [{data:'file:///private/image'},{width:2},{columns:513},{format:'png',data:'AAAA'},{data:'x'.repeat(65537)}])expect(()=>createClaudeUiDrawing({type:'NativeImage',props:{...props,...override}})).toThrow()
})
