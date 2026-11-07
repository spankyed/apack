import { it, expect, vi } from 'vitest'
import vm from 'node:vm'
import { parse } from 'acorn'
import { claudeNativeLinuxBindings } from '../../../../../../src/features/code/be/services/claude-code/native-platform-bindings.ts'
import { claudeNativePlatformRuntime } from '../../../../../../src/features/code/be/services/claude-code/native-platform-runtime.ts'
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
