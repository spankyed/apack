import vm from 'node:vm'
import { claudeTerminalDocumentRuntime } from '#features/code/be/services/claude-code/terminal-document-runtime.ts'
function fixture() {
  const render = vi.fn(async (_tree: unknown, _options: unknown) => '\x1b[31mOriginal code\x1b[39m'), provider = Symbol('fresh export'), code = Symbol('original CodeBlock'), columns = Symbol('original BodyColumns')
  const n = { documentDefaults: { $Et: () => ({ tasks: {}, taskDecorations: {}, settings: { originalSetting: true }, originalDefault: true }) }, jsx: { e: (type: unknown, props: unknown) => ({ type, props }) }, appProvider: { d_: provider }, documentRendering: { $d: { CodeBlock: code, MarkdownBlock: 'original MarkdownBlock', BodyColumns: { Provider: columns } } }, questionOptions: { j: () => 'session' }, staticRender: { v6e: render } }
  const theme = { text: '#abcdef' }
  const draw = vm.runInNewContext(claudeTerminalDocumentRuntime + ';nativeDocumentTree', { nativeThemeProvider: () => ({ type: 'live theme', value: { resolvedTheme: theme } }), process: { stdout: { columns: 80 } }, AbortController })
  return { n, render, draw, provider, code, columns, theme }
}
it('uses original CodeBlock under fresh export, current theme and body width without changing source or callbacks', async () => {
  const f = fixture(), press = { plugin: 'plugin', handle: 7 }, code = { type: 'Code', props: { source: 'original source', language: 'typescript', _apackCodeAnsi: 'forged' } }, tree = { type: 'Box', children: [code, { type: 'Button', press }] }
  const before = JSON.stringify(tree), drawn = await f.draw(f.n, tree, { columns: 54 })
  expect(JSON.stringify(tree)).toBe(before)
  expect(drawn.children[0].props).toMatchObject({ source: 'original source', _apackCodeAnsi: '\x1b[31mOriginal code\x1b[39m' })
  expect(drawn.children[1].press).toBe(press)
  expect(f.render.mock.calls[0]![0]).toMatchObject({ type: f.provider, props: { session: 'session', keybindings: false, initialState: { tasks: {}, taskDecorations: {}, originalDefault: true, settings: { originalSetting: true, syntaxHighlightingDisabled: false } }, children: { type: 'live theme', props: { children: { type: f.columns, props: { value: 54, children: { type: f.code } } } } } } })
})
it('keeps oversized source bounded and strips supplied native output without traversing Client module props', async () => {
  const f = fixture(), tree = { type: 'Box', children: [{ type: 'Code', props: { source: 'x'.repeat(32769), _apackCodeAnsi: 'forged' } }, { type: 'Client', props: { props: { type: 'Code', source: 'module private' } } }] }
  const drawn = await f.draw(f.n, tree)
  expect(drawn.children[0].props._apackCodeAnsi).toBeUndefined()
  expect(drawn.children[1]).toBe(tree.children[1])
  expect(f.render).not.toHaveBeenCalled()
})
it('refuses a retired render after the original asynchronous renderer settles', async () => {
  const f = fixture(), abort = new AbortController()
  f.render.mockImplementation(async () => { abort.abort(); return 'late' })
  await expect(f.draw(f.n, { type: 'Code', props: { source: 'source' } }, { signal: abort.signal })).rejects.toThrow()
})

it('refuses mixed-theme output if native preview changes while Code rendering is pending', async () => {
  const f = fixture()
  f.render.mockImplementation(async () => { f.theme.text = '#123456'; return 'late old-theme code' })
  await expect(f.draw(f.n, { type: 'Code', props: { source: 'source' } })).rejects.toThrow('theme changed')
})

it('copies only the current syntax setting into fresh defaults and refuses a mid-render settings change', async () => {
  const f = fixture(), state = { settings: { syntaxHighlightingDisabled: true }, tasks: { live: 'must not copy' } }
  ;(f.n as any).runtime = { ey: () => ({ toolContext: () => ({ getAppState: () => state }) }) }
  await f.draw(f.n, { type: 'Code', props: { source: 'source' } })
  expect(f.render.mock.calls[0]![0]).toMatchObject({ props: { initialState: { tasks: {}, settings: { syntaxHighlightingDisabled: true } } } })
  f.render.mockImplementation(async () => { state.settings.syntaxHighlightingDisabled = false; return 'stale settings' })
  await expect(f.draw(f.n, { type: 'Code', props: { source: 'source' } })).rejects.toThrow('settings changed')
})

it('refuses a document whose native plugin eligibility is revoked during formatting', async () => {
  const f = fixture(); let eligible = true
  ;(f.n as any).engine = { FPe: () => eligible }
  f.render.mockImplementation(async () => { eligible = false; return 'revoked drawing' })
  await expect(f.draw(f.n, { type: 'Box', part: { plugin: 'native-plugin' }, children: [{ type: 'Code', props: { source: 'source' } }] })).rejects.toThrow('eligibility changed')
})

it('renders native Markdown without mounting its callback or changing its original source', async () => {
  const f = fixture(), press = { plugin: 'plugin', handle: 42 }
  const tree = { type: 'Markdown', props: { key: 'markdown', text: '**original**', _apackMarkdownAnsi: 'forged' }, press }
  const drawn = await f.draw(f.n, tree)
  expect(drawn.press).toBe(press)
  expect(drawn.props.text).toBe('**original**')
  expect(drawn.props._apackMarkdownAnsi).toBe('\x1b[31mOriginal code\x1b[39m')
  expect(JSON.stringify(f.render.mock.calls[0]![0])).toContain('original MarkdownBlock')
})

it('uses original Raster decoding and palette rendering without forwarding source bytes or inventing controls',async()=>{
 const f=fixture(),words=new Uint32Array([0x2588,0xff8800,0x1000000]);
 const decode=vi.fn(()=>({words})),paint=vi.fn(()=>"\x1b[38;2;255;136;0m█"),palette={};
 ;(f.n as any).engine={yCr:decode,gAs:paint,j7s:()=>palette,FPe:()=>true}
 const tree={type:'Raster',props:{key:'chart',columns:1,rows:1,cells:'original packed cells'},raster:{plugin:'native-plugin'}}
 const result=await f.draw(f.n,tree)
 expect(decode).toHaveBeenCalledWith('original packed cells',1,1);expect(paint).toHaveBeenCalledWith(words,{columns:1,rows:1},palette)
 expect(result).toEqual({type:'NativeRaster',props:{columns:1,rows:1,ansi:'\x1b[38;2;255;136;0m█'},part:{plugin:'native-plugin'}})
 expect(tree.props.cells).toBe('original packed cells')
 decode.mockReturnValue({problem:'invalid cell'} as any);await expect(f.draw(f.n,tree)).rejects.toThrow('invalid cell')
})
it('bounds native Raster output explicitly and refuses retired Raster eligibility',async()=>{
 const f=fixture();let eligible=true
 ;(f.n as any).engine={yCr:()=>({words:[]}),gAs:()=>{eligible=false;return 'x'.repeat(65537)},j7s:()=>({}),FPe:()=>eligible}
 const tree={type:'Raster',props:{columns:512,rows:256,cells:'native'},raster:{plugin:'native-plugin'}}
 await expect(f.draw(f.n,tree)).rejects.toThrow('eligibility changed')
 ;(f.n as any).engine.FPe=()=>true
 expect(await f.draw(f.n,tree)).toMatchObject({type:'Text',children:['Raster preview exceeds this view. Open the native interface to inspect it.']})
})
