import { it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { parse } from 'acorn'
import { claudeNativeLinuxBindings } from '../../../../../../src/features/code/be/services/claude-code/native-platform-bindings.ts'
import { claudeNativePlatformRuntime } from '../../../../../../src/features/code/be/services/claude-code/native-platform-runtime.ts'
import { claudeTerminalComposerRuntime } from '../../../../../../src/features/code/be/services/claude-code/terminal-composer-runtime.ts'
import { claudeTerminalUiRuntime } from '../../../../../../src/features/code/be/services/claude-code/terminal-ui-runtime.ts'
import { createClaudePrintClientRuntime } from '../../../../../../src/features/code/be/services/claude-code/print-client-runtime.ts'

const mac = '5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37'
function fixture(platform = 'linux', binary = claudeNativeLinuxBindings.binarySha256) {
  const read = vi.fn(() => 'synthetic binary'), digest = vi.fn(() => binary)
  const context = { process: { platform, execPath: '/synthetic/claude', env: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' } }, readFileSync: read, createHash: () => ({ update() { return this }, digest }) }
  const api = vm.runInNewContext(claudeNativePlatformRuntime + ';({requireClaudeNativePlatform,hasClaudeNativePlatform,nativeFunctionName,nativeFunctionHash,importClaudeNativeModule})', context)
  return { api, read, digest, context }
}

it('requires exact platform and binary before importing anything, regardless of hosted flags', async () => {
  for (const [platform, binary] of [['linux', mac], ['darwin', claudeNativeLinuxBindings.binarySha256], ['linux', 'changed']]) {
    const f = fixture(platform, binary), load = vi.fn()
    expect(f.api.hasClaudeNativePlatform()).toBe(false)
    await expect(f.api.importClaudeNativeModule('chunk-c7wcn77x.js', load)).rejects.toThrow('exact reviewed')
    expect(load).not.toHaveBeenCalled()
  }
})

it('preserves original Mac namespace/function identity without Linux aliases', async () => {
  const f = fixture('darwin', mac), original = { r5: {}, FPe: vi.fn() }, load = vi.fn(async () => original)
  expect(await f.api.importClaudeNativeModule('chunk-c7wcn77x.js', load)).toBe(original)
  expect(load).toHaveBeenCalledWith('/$bunfs/root/chunk-c7wcn77x.js')
  expect(f.api.nativeFunctionName('nvt')).toBe('nvt')
  const hash = Object.keys(claudeNativeLinuxBindings.functionHashes)[0]
  expect(f.api.nativeFunctionHash(hash)).toBe(hash)
})

it('keeps original Linux objects, functions and live bindings across reviewed aliases', async () => {
  const f = fixture(), spec = claudeNativeLinuxBindings.modules['chunk-c7wcn77x.js']
  let current = { heldPress: vi.fn() }
  const eligible = vi.fn(), original: Record<string, unknown> = { [spec.exports.FPe]: eligible }
  Object.defineProperty(original, spec.exports.r5, { get: () => current, enumerable: true })
  const load = vi.fn(async () => original)
  const module = await f.api.importClaudeNativeModule('chunk-c7wcn77x.js', load)
  expect(module.r5).toBe(current); expect(module.FPe).toBe(eligible)
  current = { heldPress: vi.fn() }; expect(module.r5).toBe(current)
  expect(await f.api.importClaudeNativeModule('chunk-c7wcn77x.js', load)).toBe(module)
  expect(load).toHaveBeenCalledTimes(1); expect(load).toHaveBeenCalledWith('/$bunfs/root/' + spec.module)
  expect(Reflect.set(module, 'r5', {})).toBe(false); expect(module.r5).toBe(current)
  expect(f.read).toHaveBeenCalledTimes(1)
})

it('refuses unreviewed modules, fields, absent original exports and unknown producers', async () => {
  const f = fixture(), load = vi.fn(async () => ({}))
  await expect(f.api.importClaudeNativeModule('../unreviewed', load)).rejects.toThrow('Unreviewed native module')
  expect(load).not.toHaveBeenCalled()
  const module = await f.api.importClaudeNativeModule('chunk-c7wcn77x.js', load)
  expect(() => module.unreviewed).toThrow('Unreviewed native export')
  expect(() => module.r5).toThrow('Original native export is absent')
  expect(() => f.api.nativeFunctionName('UnknownProducer')).toThrow('Unreviewed native producer')
  expect(() => f.api.nativeFunctionHash('changed')).toThrow('Unreviewed native producer')
})

it('uses Linux producer names/hashes in the actual composed adapter without changing original slots', () => {
  const source = claudeTerminalUiRuntime, ast: any = parse(source, { ecmaVersion: 'latest', sourceType: 'module' })
  const declarations = (nodes: any[], name: string) => nodes.find(n => n.type === 'VariableDeclaration' && n.declarations.some((d: any) => d.id.name === name))
  const provider = ast.body.find((n: any) => n.type === 'FunctionDeclaration' && n.id.name === 'readNativeActionKeyProvider')
  const names = ['composerSignatures', 'terminalPlacementSignatures', 'terminalDefaultSignatures']
  const snippets = [declarations(provider.body.body, 'expected'), ...names.map(name => declarations(ast.body, name))]
  expect(snippets.every(Boolean)).toBe(true)
  const f = fixture(), values = vm.runInNewContext(snippets.map(n => source.slice(n.start, n.end)).join('\n') + ';({expected,composerSignatures,terminalPlacementSignatures,terminalDefaultSignatures})', f.context)
  expect(Object.keys(values.expected).sort()).toEqual(['Vvt', 'Yt'])
  expect(values.expected.Vvt).toBe('6563259c5d677b1c33363242e541aa98a4d226bf8fb720dcf9f7a64821d06e19')
  expect(values.composerSignatures.HH).toMatchObject({ component: 'SessionMode', slot: 4, hash: '01229725eeaf28c146dc3565fb3cfe35bc5e4f79a221f365237f5822bf6ca68d' })
  expect(values.composerSignatures.ltr).toMatchObject({ component: 'Spinner', slot: 21 })
  expect(values.terminalDefaultSignatures.TurnDuration).toMatchObject({ name: 'Eg', slot: 33 })
  expect(values.terminalPlacementSignatures.Lo).toMatchObject({ component: 'InfoNotice', slot: 8 })
})

it('both composed preloads parse and route native module imports through the platform gate', () => {
  for (const source of [claudeTerminalUiRuntime, createClaudePrintClientRuntime({ socketPath: '/synthetic', token: 'synthetic', epoch: 'synthetic' })]) {
    expect(() => parse(source, { ecmaVersion: 'latest', sourceType: 'module' })).not.toThrow()
    expect(source).not.toContain('nativeFunctionHash(nativeFunctionHash(')
    expect(source).toContain("importClaudeNativeModule('chunk-c7wcn77x.js')")
    expect(source).not.toContain("await import('/$bunfs/root/")
  }
})

it('admits every schema used by the actual computed native request dispatcher', async () => {
  const declaration = claudeTerminalUiRuntime.match(/const schemaNames=(\{[^\n]+\});/)
  expect(declaration).not.toBeNull()
  const schemas = vm.runInNewContext('(' + declaration![1] + ')') as Record<string, string>
  const spec = claudeNativeLinuxBindings.modules['chunk-5c94ftfz.js']
  const original = Object.fromEntries(Object.values(spec.exports).map(name => [name, vi.fn()]))
  const module = await fixture().api.importClaudeNativeModule('chunk-5c94ftfz.js', async () => original)
  expect(Object.keys(schemas)).toHaveLength(14)
  for (const name of Object.values(schemas)) expect(module[name]).toBe(original[spec.exports[name]])
})


it('admits every literal native module import in both actual composed preloads', () => {
  for (const source of [claudeTerminalUiRuntime, createClaudePrintClientRuntime({ socketPath: '/synthetic', token: 'synthetic', epoch: 'synthetic' })]) {
    const modules = [...source.matchAll(/importClaudeNativeModule\(['"]([^'"]+)['"]\)/g)].map(match => match[1])
    expect(modules).not.toHaveLength(0)
    for (const name of modules) expect(claudeNativeLinuxBindings.modules[name], name).toBeDefined()
  }
})
it('preserves the original theme storage reader, path, filename predicate, key factory and gate identities', async () => {
  const f = fixture()
  for (const [name, fields] of [
    ['chunk-5feck2gp.js', ['Ecr', 'ost']],
    ['chunk-r1ydygv8.js', ['Tr', 'Be']],
    ['chunk-gc95262s.js', ['W']],
  ] as const) {
    const spec = claudeNativeLinuxBindings.modules[name]
    const original = Object.fromEntries(fields.map(field => [spec.exports[field], field === 'Be' ? { userConfigDir: vi.fn() } : vi.fn()]))
    const module = await f.api.importClaudeNativeModule(name, async () => original)
    for (const field of fields) expect(module[field]).toBe(original[spec.exports[field]])
  }
})


it('uses the original queue removal for only the selected desktop prompt and refuses a fold in progress', () => {
  const source = claudeTerminalUiRuntime
  const ast: any = parse(source, {ecmaVersion: 'latest', sourceType: 'module'})
  const control = ast.body.find((node: any) => node.type === 'FunctionDeclaration' && node.id.name === 'cancelNativeQueuedPrompt')
  const selected = {uuid: 'desktop'}, other = {uuid: 'neighbor'}
  const commands = [selected, other], desktopQueuedPrompts = new Set([selected.uuid])
  const queue = {items: [{id: selected.uuid, cancellable: true}, {id: other.uuid, cancellable: false}]}
  const messageQueue = {
    isFoldInFlight: vi.fn(() => false),
    removeByFilter: vi.fn((matches: (command: {uuid: string}) => boolean, _reason: {reason: string}) => commands.filter(matches)),
  }
  const cancel = vm.runInNewContext(source.slice(control.start, control.end) + ';cancelNativeQueuedPrompt', {
    dispatchNativeQueueAction: (_n: unknown, _request: unknown, _abort: unknown, run: (scope: object) => unknown) => run({commands, messageQueue, queue}),
    isNativeMainHumanPrompt: () => true,
    desktopQueuedPrompts,
  })
  expect(cancel({}, {item_id: other.uuid}, {})).toEqual({handled: false})
  messageQueue.isFoldInFlight.mockReturnValueOnce(true)
  expect(cancel({}, {item_id: selected.uuid}, {})).toEqual({handled: false})
  expect(messageQueue.removeByFilter).not.toHaveBeenCalled()
  expect(cancel({}, {item_id: selected.uuid}, {})).toEqual({handled: true, cancelled: selected.uuid})
  expect(messageQueue.removeByFilter).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {reason: 'cancelled_by_sender'})
  expect(messageQueue.removeByFilter.mock.results[0].value).toEqual([selected])
  expect(desktopQueuedPrompts.size).toBe(0)
})


it('runs the original managed ConfigChange gate before notifying and refuses a stale owner or file', async () => {
  const source = claudeTerminalUiRuntime
  const ast: any = parse(source, {ecmaVersion: 'latest', sourceType: 'module'})
  const handler = ast.body.find((node: any) => node.type === 'FunctionDeclaration' && node.id.name === 'runNativeManagedSettingsRecheck')
  const observer = ast.body.find((node: any) => node.type === 'FunctionDeclaration' && node.id.name === 'observeNativeManagedSettings')
  const file = '/etc/claude-code/managed-settings.json'
  const request = {session_id: 'session', view_revision: 2}
  const facts: {view: {kind: 'main' | 'agent'; taskId?: string}; sessionId: string; sequence: number} = {view: {kind: 'main'}, sessionId: 'session', sequence: 2}
  const context = {session: {}, storageV5: {}, credentials: {}}
  const hook = vi.fn(async () => false), producer = vi.fn(() => hook)
  let subscriber: ((source: string) => void) | undefined
  const notifyChange = vi.fn((source: string) => subscriber?.(source))
  const detector = {
    isWatching: () => true,
    notifyChange,
    subscribe: (listener: (source: string) => void) => { subscriber = listener },
  }
  const publish = vi.fn(), stamp = vi.fn(() => 'original')
  const modules: Record<string, object> = {
    'chunk-1pjd7qsk.js': {D_: () => [{file, errno: 'EACCES'}]},
    'chunk-ayzz9bjs.js': {Ta: detector},
    'chunk-ne2pzqpv.js': {dAe: producer},
  }
  const runtime = [source.slice(observer.start, observer.end), source.slice(handler.start, handler.end)].join('\n')
  const { run, observe } = vm.runInNewContext(runtime + ';({run:runNativeManagedSettingsRecheck,observe:observeNativeManagedSettings})', {
    clients: new Set(['desktop']),
    process: {platform: 'linux'},
    importClaudeNativeModule: async (name: string) => modules[name],
    originalContext: {surface: 'terminal', toolContext: () => context},
    nativeViewFacts: () => facts,
    nativeLinuxManagedSettingsFile: file,
    nativeManagedFileStamp: stamp,
    publish,
  })
  observe(detector)
  const native = {gate: {_Jo: async () => {}}}
  hook.mockImplementationOnce(async () => { facts.sequence++; return false })
  await expect(run(native, request, new AbortController())).rejects.toThrow('owner changed')
  expect(notifyChange).not.toHaveBeenCalled()
  facts.sequence = 2
  stamp.mockReturnValueOnce('original').mockReturnValueOnce('changed')
  await expect(run(native, request, new AbortController())).rejects.toThrow('file changed')
  expect(notifyChange).not.toHaveBeenCalled()
  hook.mockResolvedValueOnce(true)
  await expect(run(native, request, new AbortController())).rejects.toThrow('declined')
  expect(notifyChange).not.toHaveBeenCalled()

  await expect(run(native, request, new AbortController())).resolves.toEqual({rechecked: true})
  expect(producer).toHaveBeenLastCalledWith(context.session, context.storageV5, context.credentials)
  expect(hook).toHaveBeenLastCalledWith('policy_settings', file)
  expect(notifyChange).toHaveBeenCalledExactlyOnceWith('policySettings')
  expect(publish).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({managed_settings_diagnostics: true}))

  facts.view = {kind: 'agent', taskId: 'selected'}
  await expect(run(native, request, new AbortController())).rejects.toThrow('owner changed')
  await expect(run(native, {...request, task_id: 'different'}, new AbortController())).rejects.toThrow('owner changed')
  const selected = {...request, task_id: 'selected'}
  hook.mockImplementationOnce(async () => { facts.view = {kind: 'agent', taskId: 'different'}; return false })
  await expect(run(native, selected, new AbortController())).rejects.toThrow('owner changed')
  expect(notifyChange).toHaveBeenCalledTimes(1)
  facts.view = {kind: 'agent', taskId: 'selected'}
  await expect(run(native, selected, new AbortController())).resolves.toEqual({rechecked: true})
  expect(notifyChange).toHaveBeenCalledTimes(2)
})


it('renders the current private task snapshot without lending the original task store to the export', async () => {
  const api = vm.runInNewContext(claudeTerminalComposerRuntime + ';({nativeComposerFacts,formatNativeComposer})', {
    AbortController, createHash, edits: new Map(), process: { stdout: { columns: 80 } },
    nativeThemeProvider: () => ({ type: 'Theme', value: 'dark' }),
    nativeViewFacts: () => ({ view }),
    originalContext: { toolContext: () => ({ getAppState: () => state }) },
  })
  let view: { kind: string; taskId?: string } = { kind: 'main' }
  let state: { expandedView: string; teamContext?: object; tasks?: object } = { expandedView: 'tasks' }
  let leader = false, remote = false, eligible = true
  let tasks = [{ id: '1', subject: 'Review migration notes', status: 'in_progress' }]
  const originalSubscribe = vi.fn()
  const privateTaskContext = { Provider: 'Native task provider' }
  const provider = { type: privateTaskContext, memoizedProps: { value: { getSnapshot: () => tasks, subscribe: originalSubscribe } } }
  const input = {
    component: 'Spinner', fingerprint: 'producer', fiber: { return: provider }, input: { surface: 'terminal' },
    factory: vi.fn(() => 'original spinner'), props: { word: 'Working' },
  }
  const inputs = new Map([['["Spinner","main"]', input], ['["Spinner","worker"]', input]])
  const staticRender = vi.fn(async (_tree: unknown) => 'native output')
  const native = {
    privateTasks: { $nr: privateTaskContext },
    runtime: { fse: () => eligible },
    taskSessionGlobals: { Bn: () => remote },
    taskTeamContext: { o$: () => leader },
    taskAppState: { RP: { Provider: 'Team drawing provider' } },
    questionOptions: { Ze: () => 'main', j: () => 'session' },
    documentDefaults: { $Et: () => ({ expandedView: 'none' }) },
    appProvider: { d_: 'App state provider' },
    jsx: { e: (type: string, props: unknown) => ({ type, props }) },
    staticRender: { v6e: staticRender },
  }

  const expanded = api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs)
  await expect(api.formatNativeComposer(native, expanded, expanded.props, {})).resolves.toBe('native output')
  const appTree = staticRender.mock.calls[0]![0] as { props: { initialState: unknown; children: { props: { children: { type: string; props: { value: { getSnapshot(): unknown; subscribe(): () => void } } } } } } }
  expect(appTree.props.initialState).toEqual({ expandedView: 'tasks' })
  const taskTree = appTree.props.children.props.children
  expect(taskTree.type).toBe(privateTaskContext.Provider)
  expect(taskTree.props.value.getSnapshot()).toBe(tasks)
  taskTree.props.value.subscribe()()
  expect(originalSubscribe).not.toHaveBeenCalled()

  state = { expandedView: 'none' }
  const collapsed = api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs)
  expect(collapsed.taskList.expanded).toBe(false)
  expect(collapsed.fingerprint).not.toBe(expanded.fingerprint)
  tasks = [{ ...tasks[0]!, status: 'completed' }]
  expect(api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs).fingerprint).not.toBe(collapsed.fingerprint)
  state = {
    expandedView: 'tasks',
    teamContext: { leadAgentId: 'lead', teammates: { worker: { name: 'reviewer', color: 'blue', socketPath: '/private/worker' } } },
    tasks: { worker: { type: 'in_process_teammate', status: 'running', identity: { agentName: 'reviewer', agentId: 'worker' },
      abortController: new AbortController(), progress: { recentActivities: [{ isRead: true, activityDescription: 'Reading' }] } } },
  }
  expect(api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs).taskList).toBeUndefined()
  leader = true
  const team = api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs)
  await api.formatNativeComposer(native, team, team.props, {})
  const teamTree = staticRender.mock.calls[1]![0] as typeof appTree
  expect(teamTree.props.initialState).toEqual({ expandedView: 'tasks' })
  const teamProjection = teamTree.props.children.props.children
  expect(teamProjection.type).toBe('Team drawing provider')
  expect(teamProjection.props.value.getSnapshot()).toEqual({
    expandedView: 'tasks',
    teamContext: { leadAgentId: 'lead', teammates: { worker: { name: 'reviewer', color: 'blue' } } },
    tasks: { worker: { type: 'in_process_teammate', status: 'running', identity: { agentName: 'reviewer', agentId: 'worker' },
      progress: { recentActivities: [{ isRead: true, activityDescription: 'Reading' }] } } },
  })
  remote = true
  expect(api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs).taskList).toBeUndefined()
  remote = false
  eligible = false
  expect(api.nativeComposerFacts(native, 'window', 'Spinner', 'main', inputs).taskList).toBeUndefined()
  eligible = true
  state = { expandedView: 'tasks' }
  view = { kind: 'agent', taskId: 'worker' }
  expect(api.nativeComposerFacts(native, 'window', 'Spinner', 'worker', inputs).taskList).toBeUndefined()
})
