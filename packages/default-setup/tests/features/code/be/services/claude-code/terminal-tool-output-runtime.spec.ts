import vm from 'node:vm'
import { claudeTerminalToolOutputRuntime } from '#features/code/be/services/claude-code/terminal-tool-output-runtime.ts'

function fixture() {
  const theme = { type: 'original-theme-provider', value: { resolvedTheme: { text: '#123456' } } }
  const helpers = vm.runInNewContext(`${claudeTerminalToolOutputRuntime};({formatUse:formatNativeToolUse,format:formatNativeToolResult,usesEngine:nativeDrawingUsesEngine})`, { process: { stdout: { columns: 90 } }, nativeThemeProvider: () => theme })
  const n = {
    toolExport: { uer: vi.fn((tools: unknown) => tools) },
    jsx: { e: (type: unknown, props: unknown) => ({ type, props }) },
    appProvider: { d_: 'original-app-provider' }, questionOptions: { j: () => 'original-session' },
    toolRendering: { h3: 'original-message-renderer' },
    runtime: { sQt: vi.fn(() => ({ lookups: { original: true }, inProgressToolUseIDs: new Set() })) },
    staticRender: { v6e: vi.fn(async () => '\u001b[32mOriginal formatted output\u001b[0m') },
  }
  return { n, theme, formatUse: helpers.formatUse, format: helpers.format, usesEngine: helpers.usesEngine }
}
it('uses original export providers without giving the temporary store ownership of live tasks', async () => {
  const f = fixture(), block = { type: 'tool_result', tool_use_id: 'original-tool' }, sibling = { type: 'tool_result', tool_use_id: 'sibling-tool' }
  const original = { toolUseResult: { content: 'original' }, message: { content: [block, sibling] } }
  const rewritten = { content: 'display-only' }, tools = [{ name: 'Write' }]
  const facts = { message: original, messages: [original], block, fingerprint: 'native-source' }
  expect(await f.format(f.n, facts, rewritten, { tools, columns: 70 })).toContain('Original formatted output')
  const [tree, options] = f.n.staticRender.v6e.mock.calls[0] as unknown as [any, unknown]
  expect(options).toEqual({ columns: 70 })
  expect(tree).toMatchObject({ type: 'original-app-provider', props: { session: 'original-session', keybindings: false } })
  expect(tree.props.store).toBeUndefined(); expect(tree.props.initialState).toBeUndefined()
  expect(tree.props.children.type).toBe(f.theme.type); expect(tree.props.children.props.value).toBe(f.theme.value)
  const rendered = tree.props.children.props.children
  expect(rendered.type).toBe('original-message-renderer')
  expect(rendered.props.message).toEqual({ ...original, message: { ...original.message, content: [block] }, toolUseResult: rewritten })
  expect(rendered.props.message).not.toBe(original); expect(original.toolUseResult.content).toBe('original'); expect(original.message.content).toEqual([block, sibling])
  expect(rendered.props).toMatchObject({ verbose: true, isTranscriptMode: true, isStatic: true, disableDisplayOverride: true })
  expect(f.n.runtime.sQt).toHaveBeenCalledWith([{ message: original }])
})
it('rejects oversized formatter output and formats current state on every requested drawing', async () => {
  const f = fixture(), message = { toolUseResult: {} }, facts = { message, messages: [message], fingerprint: 'source' }
  await f.format(f.n, facts, message.toolUseResult, { tools: [] })
  await f.format(f.n, facts, message.toolUseResult, { tools: [] })
  expect(f.n.staticRender.v6e).toHaveBeenCalledTimes(2)
  f.n.staticRender.v6e.mockResolvedValueOnce('x'.repeat(65537))
  await expect(f.format(f.n, facts, {}, { tools: [] })).rejects.toThrow('output limit')
})
it('formats only drawings that request the original engine output', () => {
  const f = fixture()
  expect(f.usesEngine({ type: 'Box', children: [{ type: 'engine', ref: 0 }] })).toBe(true)
  expect(f.usesEngine({ type: 'Client', props: { module: './custom.ts' } })).toBe(false)
  const cycle: { type: string; children?: unknown[] } = { type: 'Box' }; cycle.children = [cycle]
  expect(() => f.usesEngine(cycle)).toThrow('tree limit')
})

it('refuses publication when the request is cancelled while the original renderer finishes', async () => {
 const f=fixture(),controller=new AbortController(),message={toolUseResult:{}},facts={message,messages:[message],block:{type:'tool_result'}}
 let finish!:(text:string)=>void
 f.n.staticRender.v6e.mockImplementationOnce(()=>new Promise<string>(resolve=>{finish=resolve}))
 const pending=f.format(f.n,facts,{}, {tools:[],signal:controller.signal})
 controller.abort();finish('late native drawing')
 await expect(pending).rejects.toThrow(/aborted/i)
})

it('uses original compact rendering for oversized Workflow calls without mutating their script', async () => {
 const f=fixture(),script='x'.repeat(200289),block={type:'tool_use',id:'workflow',name:'Workflow',input:{script}},message={message:{content:[block]}},facts={message,messages:[message],block}
 const output=await f.formatUse(f.n,facts,{tool:'Workflow',input:block.input},{tools:[]})
 const tree=(f.n.staticRender.v6e.mock.calls[0] as unknown as [any])[0],rendered=tree.props.children.props.children
 expect(rendered.props.verbose).toBe(false);expect(rendered.props.message.message.content[0].input.script).toBe(script)
 expect(output).toContain('Original formatted output');expect(output).toContain('Full Workflow script omitted from this view.')
 expect(block.input.script).toBe(script)
})
it('keeps ordinary Workflow calls and other tools on their original verbose rendering', async () => {
 for(const [name,script] of [['Workflow','small script'],['Bash','x'.repeat(70000)]]){
  const f=fixture(),block={type:'tool_use',id:'tool',name,input:{script}},message={message:{content:[block]}}
  const output=await f.formatUse(f.n,{message,messages:[message],block},{tool:name,input:block.input},{tools:[]})
  expect((f.n.staticRender.v6e.mock.calls[0] as unknown as [any])[0].props.children.props.children.props.verbose).toBe(true)
  expect(output).not.toContain('Full Workflow script omitted')
 }
})
