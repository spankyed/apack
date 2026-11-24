import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { claudeTerminalUiRuntime } from '#features/code/be/services/claude-code/terminal-ui-runtime.ts'

it('keeps only the latest native completion and cancels detached drafts', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(start, end)};({autocomplete,clearCompletion})`, { AbortController, Promise, Map, clientViewCurrent: () => true }) as {
    autocomplete(native: unknown, client: string, box: { text: string }): Promise<{ suggestions: string[]; start?: number; superseded?: boolean }>
    clearCompletion(client: string): void
  }
  const calls: { text: string; signal: AbortSignal; resolve(value: { suggestions: string[] }): void }[] = []
  const native = { session: {
    rwt: (box: { text: string }) => box.text ? { start: 0, text: box.text } : undefined,
    r_n: (args: { text: string }, signal: AbortSignal) => new Promise<{ suggestions: string[] }>(resolve => calls.push({ text: args.text, signal, resolve })),
    n_n: (rows: string[]) => rows,
  } }
  const first = api.autocomplete(native, 'a', { text: 'old' }); await Promise.resolve()
  const middle = api.autocomplete(native, 'a', { text: 'middle' })
  const latest = api.autocomplete(native, 'a', { text: 'latest' })
  expect(calls[0]!.signal.aborted).toBe(true)
  expect(await middle).toEqual({ suggestions: [], superseded: true })
  calls[0]!.resolve({ suggestions: ['stale'] })
  expect(await first).toEqual({ suggestions: [], superseded: true })
  await Promise.resolve(); expect(calls[1]!.text).toBe('latest')
  calls[1]!.resolve({ suggestions: ['current'] })
  expect(await latest).toEqual({ suggestions: ['current'], start: 0 })
  const detached = api.autocomplete(native, 'a', { text: 'detached' }); await Promise.resolve()
  api.clearCompletion('a'); expect(calls[2]!.signal.aborted).toBe(true)
  calls[2]!.resolve({ suggestions: ['late'] })
  expect(await detached).toEqual({ suggestions: [], superseded: true })
  expect(await api.autocomplete(native, 'b', { text: '' })).toEqual({ suggestions: [] })
})

it('discards a completed plugin reply when the native view changed while it waited', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  let current = true
  const api = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';autocomplete', {
    AbortController, clientViewCurrent: () => current,
  }) as (native: unknown, client: string, box: { text: string }) => Promise<unknown>
  let finish!: (result: { suggestions: string[] }) => void
  const plugin = vi.fn(() => new Promise<{ suggestions: string[] }>(resolve => { finish = resolve }))
  const native = { session: { rwt: () => ({ start: 0 }), r_n: plugin, n_n: (rows: string[]) => rows } }

  const old = api(native, 'parent-client', { text: 'first draft' })
  await Promise.resolve()
  expect(plugin).toHaveBeenCalledOnce()
  current = false
  finish({ suggestions: ['old-view completion'] })
  expect(await old).toEqual({ suggestions: [], superseded: true })
  expect(await api(native, 'parent-client', { text: 'retired draft' })).toEqual({ suggestions: [], superseded: true })
  expect(plugin).toHaveBeenCalledOnce()

  plugin.mockResolvedValueOnce({ suggestions: ['selected Agent completion'] })
  current = true
  expect(await api(native, 'agent-client', { text: 'new draft' })).toEqual({
    start: 0, suggestions: ['selected Agent completion'],
  })
})

it('keeps original indexed file rows distinct from plugin replacement ranges', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  let current = true
  const storageV5 = Symbol('native-session-storage')
  const originalContext = { surface: 'terminal', toolContext: () => ({ storageV5 }) }
  const api = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';({autocomplete,nativeFileCompletionToken})', {
    AbortController, originalContext, clientViewCurrent: () => current,
  }) as {
    autocomplete(native: unknown, client: string, box: { text: string; cursor: number }): Promise<unknown>
    nativeFileCompletionToken(box: { text: string; cursor: number }): unknown
  }
  const index = {}
  const files = vi.fn(async () => [{ displayText: 'docs/release notes.md' }, { displayText: 'bad\npath' }])
  const native = { fileSuggestions: { s5t: files, RSe: index }, session: {
    rwt: () => ({ start: 12, token: 'relea' }),
    r_n: async () => ({ suggestions: [{ text: 'plugin-row' }] }),
    n_n: (items: unknown[]) => items,
  } }
  const text = 'Open @"docs/release notes.md" again'
  const cursor = 'Open @"docs/relea'.length
  const endOfPath = 'Open @"docs/release notes.md"'.length
  expect(await api.autocomplete(native, 'current', { text, cursor })).toEqual({
    start: 12, suggestions: [
      { text: '@"docs/release notes.md" ', label: 'docs/release notes.md', replacement: { start: 5, end: endOfPath } },
      { text: 'plugin-row' },
    ],
  })
  expect(files.mock.calls[0]).toEqual([index, 'docs/release notes.md', true, storageV5])
  expect(api.nativeFileCompletionToken({ text: 'user@example', cursor: 12 })).toBeUndefined()
  current = false
  expect(await api.autocomplete(native, 'old', { text, cursor })).toEqual({ suggestions: [], superseded: true })
  expect(files).toHaveBeenCalledOnce()
})

it('offers native Agent definitions and visible MCP resources with the native reference spelling', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  let remoteWorkspace = false
  const state = {
    agentDefinitions: { activeAgents: [{ agentType: 'release-reviewer', whenToUse: 'Review migration notes' }] },
    mcp: { resources: { docs: [
      { server: 'docs', uri: 'doc://release', name: 'Release notes' },
      { server: 'docs', uri: 'doc://release-panel', mimeType: 'text/html;profile=mcp-app' },
    ] } },
  }
  const originalContext = { surface: 'terminal', toolContext: () => ({ getAppState: () => state }) }
  const api = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';autocomplete', {
    AbortController, originalContext, clientViewCurrent: () => true,
  }) as (native: unknown, client: string, box: { text: string; cursor: number }) => Promise<unknown>
  const search = vi.fn((query: string, items: { displayText: string }[]) =>
    items.filter(item => item.displayText.includes(query)).map(item => ({item,score:0.1})))
  class Search {
    constructor(private readonly items: { displayText: string }[]) {}
    search(query: string) { return search(query, this.items) }
  }
  const native = {
    fileSuggestions: { s5t: async () => [{ displayText: 'release.md', metadata: { score:0.6 } }], RSe: {} },
    referenceSearch: { ohe: Search },
    referenceWorkspace: { Ct: () => remoteWorkspace },
    engine: { q0t: (resource: { mimeType?: string }) => resource.mimeType === 'text/html;profile=mcp-app' },
    session: { rwt: () => undefined },
  }
  expect(await api(native,'attached',{text:'@release',cursor:8})).toEqual({
    start:0,suggestions:[
      {label:'release-reviewer (agent)',text:'@"release-reviewer (agent)" ',description:'Review migration notes',replacement:{start:0,end:8}},
      {label:'docs:doc://release',text:'@docs:doc://release ',description:'Release notes',replacement:{start:0,end:8}},
      {label:'release.md',text:'@release.md ',replacement:{start:0,end:8}},
    ],
  })
  expect(search).toHaveBeenCalledOnce()
  remoteWorkspace = true
  expect(await api(native,'attached',{text:'@release',cursor:8})).toEqual({
    start:0,suggestions:[{label:'release.md',text:'@release.md ',replacement:{start:0,end:8}}],
  })
})

it('advances MCP template parameters through the original connected client and retires a replaced connection', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const template = { uriTemplate:'resource://release/{branch}/{section}', name:'Release sections' }
  const adjacent = { uriTemplate:'resource://artifacts/{name}{variant}{locale}/manifest', name:'Artifact manifest' }
  const connection = { type:'connected',name:'docs',client:{} }
  const state = { mcp:{ clients:[connection], resourceTemplates:{ docs:[template,adjacent] } } }
  const originalContext = { surface:'terminal',toolContext:()=>({ getAppState:()=>state, session:{} }) }
  type Draft = { text: string; cursor: number }
  type Reply = { suggestions: { text: string; templateOfferId?: string }[] }
  const { autocomplete, confirmNativeTemplate } = vm.runInNewContext(
    claudeTerminalUiRuntime.slice(start,end)+';({autocomplete,confirmNativeTemplate})', {
      AbortController,originalContext,clientViewCurrent:()=>true,randomUUID,
    },
  ) as {
    autocomplete(native: unknown, client: string, draft: Draft): Promise<Reply>
    confirmNativeTemplate(client: string, draft: Draft, ticket: string): Reply
  }
  const completeResourceTemplate = vi.fn(async () => ['main'])
  const native = {
    fileSuggestions:{s5t:async()=>[{displayText:'local.md'}],RSe:{}},
    referenceSearch:{Is:()=>true,ohe:class { search() { return [] } }},
    referenceWorkspace:{Ct:()=>false},
    referenceTransport:{mcpClientModule:()=>({ensureConnectedClient:async()=>connection,completeResourceTemplate})},
    engine:{q0t:()=>false},
    session:{rwt:()=>undefined},
  }
  const query = (text: string) => autocomplete(native,'selected',{text,cursor:text.length})
  expect((await query('@docs:resource://unrelated')).suggestions[0]?.text).toBe('@local.md ')
  expect((await query('@docs:resource://re')).suggestions[0]?.text).toBe('@docs:resource://release/')
  expect((await query('@docs:resource://release/ma')).suggestions[0]?.text).toBe('@docs:resource://release/main/')
  expect(completeResourceTemplate).toHaveBeenLastCalledWith(connection,template.uriTemplate,'branch','ma',{})
  completeResourceTemplate.mockResolvedValueOnce(['notes'])
  expect((await query('@docs:resource://release/main/no')).suggestions[0]?.text).toBe('@docs:resource://release/main/notes ')
  expect(completeResourceTemplate).toHaveBeenLastCalledWith(connection,template.uriTemplate,'section','no',{branch:'main'})
  completeResourceTemplate.mockResolvedValueOnce(['release bundle'])
  expect((await query('@docs:resource://artifacts/re')).suggestions[0]?.text).toBe('@"docs:resource://artifacts/release bundle/manifest" ')
  expect(completeResourceTemplate).toHaveBeenLastCalledWith(connection,adjacent.uriTemplate,'name','re',{})
  const text = '@docs:resource://release/main/no'
  const draft = { text, cursor: text.length }
  const offered = (await query(text)).suggestions[0]!
  expect(offered.templateOfferId).toBeDefined()
  expect(confirmNativeTemplate('other',draft,offered.templateOfferId!).suggestions).toEqual([])
  const calls = completeResourceTemplate.mock.calls.length
  expect(confirmNativeTemplate('selected',draft,offered.templateOfferId!).suggestions).toEqual([offered])
  expect(confirmNativeTemplate('selected',draft,offered.templateOfferId!).suggestions).toEqual([])
  expect(completeResourceTemplate).toHaveBeenCalledTimes(calls)
  const withdrawn = (await query(text)).suggestions[0]!
  state.mcp.resourceTemplates.docs = [adjacent]
  expect(confirmNativeTemplate('selected',draft,withdrawn.templateOfferId!).suggestions).toEqual([])
  state.mcp.resourceTemplates.docs = [template,adjacent]
  completeResourceTemplate.mockImplementationOnce(async()=>{
    state.mcp.clients=[{...connection,client:{}}]
    return ['retired']
  })
  expect((await query('@docs:resource://release/main/no')).suggestions).toEqual([])
})

it('uses the native team roster for addressed completion and refuses changed recipients', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const state = { viewingAgentTaskId: undefined as string | undefined, teamContext: {
    teamName: 'release', leadAgentId: 'lead', teammates: {
      lead: { name:'team-lead' }, reviewer: { name:'release-reviewer' },
    },
  } }
  const context = { getAppState: () => state }
  const originalContext = { surface:'terminal',toolContext:()=>context }
  const { autocomplete, nativeTeamAddress, sameNativeTeamAddress } = vm.runInNewContext(
    claudeTerminalUiRuntime.slice(start,end)+';({autocomplete,nativeTeamAddress,sameNativeTeamAddress})',{
      AbortController,originalContext,clientViewCurrent:()=>true,
    })
  const native = { planTeams:{is:()=>true}, session:{rwt:()=>undefined}, fileSuggestions:{s5t:async()=>[],RSe:{}} }
  expect((await autocomplete(native,'main',{text:'@rele',cursor:5})).suggestions).toEqual([
    {label:'@release-reviewer',text:'@release-reviewer ',description:'Send message',replacement:{start:0,end:5}},
  ])
  expect(nativeTeamAddress(native,context,'@team-lead Hello')).toBeUndefined()
  expect(nativeTeamAddress(native,context,'@release-reviewer ')).toBeUndefined()
  const address = nativeTeamAddress(native,context,'@release-reviewer Check this')
  expect(address).toEqual({id:'reviewer',team:'release',name:'release-reviewer'})
  state.teamContext.teamName = 'replacement'
  expect(sameNativeTeamAddress(address,nativeTeamAddress(native,context,'@release-reviewer Check this'))).toBe(false)
  state.viewingAgentTaskId = 'reviewer'
  expect((await autocomplete(native,'main',{text:'@rele',cursor:5})).suggestions).toEqual([])
})

it('shows named native Agents and only exposes peer suggestions while the native policy admits them', async () => {
  const start = claudeTerminalUiRuntime.indexOf('const nativeAtPathChars=')
  const end = claudeTerminalUiRuntime.indexOf('const dialogRevisions=')
  const state = { agentNameRegistry:new Map([['review-worker','worker-id']]),tasks:{'worker-id':{status:'running'}} }
  const session = {}, context = { session,getAppState:()=>state }
  const originalContext = { surface:'terminal',toolContext:()=>context }
  const api = vm.runInNewContext(claudeTerminalUiRuntime.slice(start,end)+';autocomplete',{
    AbortController,originalContext,clientViewCurrent:()=>true,
  })
  let allowed = true
  let finishRoster!: (value: object) => void
  const read = vi.fn(() => new Promise<object>(resolve=>{finishRoster=resolve}))
  const roster = {}
  const match = vi.fn((_roster,query)=>query==='release'?[{displayText:'@"release notes"',description:'message session'}]:[])
  const n = {
    runtime:{igr:read,Xps:match},addressAdmission:{Yi:()=>allowed},referenceWorkspace:{Ct:()=>false},
    fileSuggestions:{s5t:async()=>[],RSe:{}},session:{rwt:()=>undefined},
  }
  const query = (text: string) => api(n,'client',{text,cursor:text.length})
  const first = query('@release')
  allowed = false
  finishRoster(roster)
  expect((await first).suggestions).toEqual([])
  expect(match).not.toHaveBeenCalled()
  allowed = true
  expect((await query('@release')).suggestions).toEqual([
    {label:'@"release notes"',text:'@"release notes" ',description:'message session',replacement:{start:0,end:8}},
  ])
  expect(read).toHaveBeenCalledOnce()
  allowed = false
  expect((await query('@review')).suggestions).toEqual([
    {label:'@review-worker',text:'@review-worker ',description:'Send message · running',replacement:{start:0,end:7}},
  ])
})

it('coalesces queued edits, adopts app changes and retires edits on detach', async () => {
  type Box = { text: string; cursor: number; superseded?: boolean }
  type Edit = { before: Box; after: Box; key?: { key: string; name: string } }
  const start = claudeTerminalUiRuntime.indexOf('const edits=new Map();')
  const end = claudeTerminalUiRuntime.indexOf('// Each attached composer')
  const themeStart = claudeTerminalUiRuntime.indexOf('function nativeThemeProvider(')
  const themeEnd = claudeTerminalUiRuntime.indexOf('function nativeThemeTree(')
  const api = vm.runInNewContext(`${claudeTerminalUiRuntime.slice(themeStart, themeEnd)}${claudeTerminalUiRuntime.slice(start, end)};({editPrompt,clearEdit})`, {
    AbortController, Promise, Map, desktopPromptChanges: new Map(), retireDesktopPromptChanges: () => {},
  }) as {
    editPrompt(native: unknown, client: string, box: Box, key?: { key: string }, by?: string): Promise<Box> | Box
    clearEdit(client: string): void
  }
  const calls: { event: Edit; signal: AbortSignal; resolve(value: Box): void }[] = []
  const native = { session: {
    o_n: (box: Box) => ({ text: box.text, cursor: Math.min(box.cursor, box.text.length) }),
    Aze: (before: Box, after: Box) => ({ start: 0, end: before.text.length, inputText: after.text }),
    kGr: (event: Edit, signal: AbortSignal) => new Promise<Box>(resolve => calls.push({ event, signal, resolve })),
  }, runtime: { nxe: () => [], qgr: () => [] } }
  const first = api.editPrompt(native, 'a', { text: 'a', cursor: 1 }, { key: 'a' }); await Promise.resolve()
  const middle = api.editPrompt(native, 'a', { text: 'ab', cursor: 2 }, { key: 'b' })
  const latest = api.editPrompt(native, 'a', { text: 'abc', cursor: 3 }, { key: 'c' })
  calls[0]!.resolve({ text: 'A', cursor: 1 }); await first
  expect(await middle).toEqual({ text: 'ab', cursor: 2, superseded: true })
  await Promise.resolve(); expect(calls[1]!.event.key).toBeUndefined()
  expect(calls[1]!.event.after.text).toBe('abc')
  calls[1]!.resolve({ text: 'ABC', cursor: 3 }); await latest
  expect(api.editPrompt(native, 'a', { text: 'restored', cursor: 8 }, undefined, 'app')).toEqual({ text: 'restored', cursor: 8 })
  const next = api.editPrompt(native, 'a', { text: 'restored ', cursor: 9 }, { key: 'space' }); await Promise.resolve()
  expect(calls[2]!.event.before.text).toBe('restored')
  expect(calls[2]!.event.key).toMatchObject({ key: ' ', name: '' })
  api.clearEdit('a'); expect(calls[2]!.signal.aborted).toBe(true)
  calls[2]!.resolve({ text: 'LATE', cursor: 4 })
  expect(await next).toEqual({ text: 'restored ', cursor: 9, superseded: true })
})

it('projects original zero-width hints only for the latest eligible owned terminal draft', () => {
  const start = claudeTerminalUiRuntime.indexOf('function ownedPromptDecorations(')
  const end = claudeTerminalUiRuntime.indexOf('function clearEdit(')
  const project = vm.runInNewContext(claudeTerminalUiRuntime.slice(start, end) + ';ownedPromptDecorations', {
    originalContext: undefined, process,
  }) as (native: unknown, runs: unknown, text: string, latest: boolean) => unknown
  const paint = { start: 0, end: 3, bold: true }
  const hint = { start: 1, end: 1, virtualText: ' note ' }
  let surface = 'terminal', reader = false, admitted = true
  const originalDisplay = vi.fn((text: string) => ({ text: text.slice(0, 1) + hint.virtualText + text.slice(1) }))
  const native = {
    runtime: { nxe: () => [paint, hint], ey: () => ({ surface }), qgr: () => [paint] },
    gate: { ioe: () => admitted },
    themeRoots: { ai: () => new Map([[process.stdout, { isScreenReaderEnabled: reader }]]) },
    engine: { Yen: originalDisplay },
  }
  expect(project(native, [], 'abc', true)).toEqual([paint, hint])
  expect(originalDisplay).toHaveBeenCalledOnce()
  expect(project(native, [], 'abc', false)).toEqual([paint])
  expect(project(native, [], '', true)).toEqual([paint])
  expect(project(native, [], 'e\u0301', true)).toEqual([paint])
  reader = true
  expect(project(native, [], 'abc', true)).toEqual([paint])
  reader = false
  surface = 'desktop'
  expect(project(native, [], 'abc', true)).toEqual([paint])
  surface = 'terminal'
  admitted = false
  expect(project(native, [], 'abc', true)).toEqual([paint])
  admitted = true
  originalDisplay.mockReturnValueOnce({ text: 'e\u0301' })
  expect(project(native, [], 'abc', true)).toEqual([paint])
})
