import vm from 'node:vm'
import {createHash} from 'node:crypto'
import { claudeTerminalDocumentRuntime } from '#features/code/be/services/claude-code/terminal-document-runtime.ts'
function fixture() {
  const render = vi.fn(async (_tree: unknown, _options: unknown) => '\x1b[31mOriginal code\x1b[39m'), provider = Symbol('fresh export'), code = Symbol('original CodeBlock'), columns = Symbol('original BodyColumns')
  const n = { documentDefaults: { $Et: () => ({ tasks: {}, taskDecorations: {}, settings: { originalSetting: true }, originalDefault: true }) }, jsx: { e: (type: unknown, props: unknown) => ({ type, props }) }, appProvider: { d_: provider }, documentRendering: { $d: { CodeBlock: code, MarkdownBlock: 'original MarkdownBlock', BodyColumns: { Provider: columns } } }, questionOptions: { j: () => 'session' }, staticRender: { v6e: render } }
  const theme = { text: '#abcdef' }
  const hashes=new WeakMap<Function,string>()
  const draw = vm.runInNewContext(claudeTerminalDocumentRuntime + ';nativeDocumentTree', { Buffer,createHash,composerFunctionHashes:hashes,nativeThemeProvider: () => ({ type: 'live theme', value: { resolvedTheme: theme } }), process: { stdout: { columns: 80 } }, AbortController })
  return { n, render, draw, provider, code, columns, theme,hashes }
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
  const f = fixture(), tree = { type: 'Box', children: [{ type: 'Code', props: { source: 'x'.repeat(131073), _apackCodeAnsi: 'forged' } }, { type: 'Client', props: { props: { type: 'Code', source: 'module private' } } }] }
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

it('mirrors only the original mounted Image alt fallback under its exact native placement without reading source bytes',async()=>{
 const f=fixture();function Fo(){};f.hashes.set(Fo,'90ffae0a8b68a15a4c68fa3ca5513e524c112e97e31aac7c1abc7bf8a217f6cf')
 const props={key:'cover',source:{file:'/private/native-owned-image.png',format:'png'},columns:8,rows:2,alt:'Release cover'},scope={component:'InfoNotice',requestId:'original notice'}
 const fiber:any={type:Fo,memoizedProps:{...props,elementKey:props.key,plugin:'native'},return:{memoizedProps:{value:scope}},child:{memoizedProps:{dimColor:true,children:props.alt}}}
 ;(f.n as any).themeRoots={ai:()=>({get:()=>({container:{current:fiber}})})}
 const node={type:'Image',props,image:{plugin:'native'}}
 expect(await f.draw(f.n,node,{terminalScope:scope})).toEqual({type:'Text',props:{dimColor:true},children:['Release cover'],part:{plugin:'native'}})
 expect(f.render).not.toHaveBeenCalled();expect(node.props.source.file).toBe('/private/native-owned-image.png')
 await expect(f.draw(f.n,node,{terminalScope:{...scope,requestId:'foreign'}})).rejects.toThrow('not mounted')
 fiber.child.memoizedProps={children:{type:'ink-raw-ansi'}}
 await expect(f.draw(f.n,node,{terminalScope:scope})).rejects.toThrow('pixel placement')
})
it('refuses a changed native Image renderer instead of guessing fallback from an arbitrary text node',async()=>{
 const f=fixture();function Fo(){};const scope={component:'InfoNotice',requestId:'notice'},props={source:{png:'native'},columns:1,rows:1,alt:'cover'}
 const fiber={type:Fo,memoizedProps:{...props,plugin:'native'},return:{memoizedProps:{value:scope}},child:{memoizedProps:{dimColor:true,children:'cover'}}}
 ;(f.n as any).themeRoots={ai:()=>({get:()=>({container:{current:fiber}})})}
 await expect(f.draw(f.n,{type:'Image',props,image:{plugin:'native'}},{terminalScope:scope})).rejects.toThrow('renderer changed')
})

it('projects only original allocated Image bytes and observes accepted swaps without trusting stale drawing source',async()=>{
 const f=fixture();function Fo(){};f.hashes.set(Fo,'90ffae0a8b68a15a4c68fa3ca5513e524c112e97e31aac7c1abc7bf8a217f6cf')
 const scope={component:'InfoNotice',requestId:'native-notice'},source={rgba:'/4gA/w==',width:1,height:1},props={key:'cover',source,columns:8,rows:2,alt:'Release cover'}
 const images={live:new Map([[7,{isSent:true}]])},held={current:{reactKey:'original key',source,box:'8x2'}},fiber:any={type:Fo,memoizedProps:{...props,elementKey:'cover',plugin:'native'},return:{memoizedProps:{value:scope}},memoizedState:{memoizedState:{id:7,images},next:{memoizedState:held}},child:{memoizedProps:{width:8,height:2,overflow:'hidden',children:{type:'ink-raw-ansi'}}}}
 ;(f.n as any).themeRoots={ai:()=>({get:()=>({container:{current:fiber},terminalImages:images})})}
 const node={type:'Image',props,image:{plugin:'native'}}
 expect(await f.draw(f.n,node,{terminalScope:scope})).toMatchObject({type:'NativeImage',props:{format:'rgba',data:'/4gA/w==',width:1,height:1,columns:8,rows:2}})
 held.current.source={rgba:'AIj//w==',width:1,height:1}
 expect(await f.draw(f.n,node,{terminalScope:scope})).toMatchObject({props:{data:'AIj//w=='}});expect(node.props.source).toBe(source)
 images.live.delete(7);await expect(f.draw(f.n,node,{terminalScope:scope})).rejects.toThrow('no admitted byte source')
})

it('losslessly packs native output beyond the old cap while retaining full source and callbacks', async () => {
  const f=fixture(),source='const value = "release";\n'.repeat(1600),ansi=('\x1b[38;2;12;34;56mrelease\x1b[39m\n').repeat(2500),press={plugin:'original',handle:4}
  f.render.mockResolvedValue(ansi)
  const result=await f.draw(f.n,{type:'Code',props:{source,language:'javascript'},press})
  expect(result.props.source).toBe(source);expect(result.press).toBe(press)
  expect(result.props._apackDocumentPacked).toBeDefined();expect(result.props._apackCodeAnsi).toBeUndefined()
  const {decodeClaudeDocument}=await import('#features/code/common/native-document-codec.ts')
  expect(decodeClaudeDocument(result.props._apackDocumentPacked)).toBe(ansi)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(262144)
})
it('keeps full source and marks a budget fallback instead of overflowing the surrounding drawing', async () => {
  const f=fixture(),source='x'.repeat(90000);f.render.mockResolvedValue('y'.repeat(200000))
  const result=await f.draw(f.n,{type:'Code',props:{source}})
  expect(result.props.source).toBe(source);expect(result.props._apackDocumentFallback).toBe('drawing-budget')
  expect(result.props._apackDocumentPacked).toBeUndefined()
})

it('exports only an admitted native file allocation reference without reading its pixels',async()=>{
 const f=fixture();function Fo(){};f.hashes.set(Fo,'90ffae0a8b68a15a4c68fa3ca5513e524c112e97e31aac7c1abc7bf8a217f6cf')
 const scope={component:'InfoNotice',requestId:'native-notice'},source={file:'/private/terminal-owned.rgba',format:'rgba',width:1,height:1},props={key:'cover',source,columns:8,rows:2,alt:'Release cover'}
 const images={live:new Map([[7,{isSent:true}]])},held={current:{reactKey:'original key',source,box:'8x2'}},fiber:any={type:Fo,memoizedProps:{...props,elementKey:'cover',plugin:'native'},return:{memoizedProps:{value:scope}},memoizedState:{memoizedState:{id:7,images},next:{memoizedState:held}},child:{memoizedProps:{width:8,height:2,overflow:'hidden',children:{type:'ink-raw-ansi'}}}}
 ;(f.n as any).themeRoots={ai:()=>({get:()=>({container:{current:fiber},terminalImages:images})})}
 const node={type:'Image',props,image:{plugin:'native'}}
 expect(await f.draw(f.n,node,{terminalScope:scope})).toMatchObject({type:'NativeImageReference',props:{imageId:7,columns:8,rows:2,alt:'Release cover'}})
 images.live.delete(7);await expect(f.draw(f.n,node,{terminalScope:scope})).rejects.toThrow('no admitted byte source')
})

it('exports only an admitted shared-memory allocation reference without reading its name',async()=>{
 const f=fixture();function Fo(){};f.hashes.set(Fo,'90ffae0a8b68a15a4c68fa3ca5513e524c112e97e31aac7c1abc7bf8a217f6cf')
 const scope={component:'InfoNotice',requestId:'native-notice'},source={shm:'/terminal-owned',format:'rgba',width:1,height:1},props={key:'cover',source,columns:8,rows:2,alt:'Release cover'}
 const images={live:new Map([[7,{isSent:true}]])},held={current:{reactKey:'original key',source,box:'8x2'}},fiber:any={type:Fo,memoizedProps:{...props,elementKey:'cover',plugin:'native'},return:{memoizedProps:{value:scope}},memoizedState:{memoizedState:{id:7,images},next:{memoizedState:held}},child:{memoizedProps:{width:8,height:2,overflow:'hidden',children:{type:'ink-raw-ansi'}}}}
 ;(f.n as any).themeRoots={ai:()=>({get:()=>({container:{current:fiber},terminalImages:images})})}
 const node={type:'Image',props,image:{plugin:'native'}}
 expect(await f.draw(f.n,node,{terminalScope:scope})).toMatchObject({type:'NativeImageReference',props:{imageId:7,columns:8,rows:2,alt:'Release cover'}})
 images.live.delete(7);await expect(f.draw(f.n,node,{terminalScope:scope})).rejects.toThrow('no admitted byte source')
})
