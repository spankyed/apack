import vm from 'node:vm'
import { claudeTerminalDocumentRuntime } from '#features/code/be/services/claude-code/terminal-document-runtime.ts'
function fixture() {
  const render = vi.fn(async (_tree: unknown, _options: unknown) => '\x1b[31mOriginal code\x1b[39m'), provider = Symbol('fresh export'), code = Symbol('original CodeBlock'), columns = Symbol('original BodyColumns')
  const n = { documentDefaults: { $Et: () => ({ tasks: {}, taskDecorations: {}, settings: { originalSetting: true }, originalDefault: true }) }, jsx: { e: (type: unknown, props: unknown) => ({ type, props }) }, appProvider: { d_: provider }, documentRendering: { $d: { CodeBlock: code, BodyColumns: { Provider: columns } } }, questionOptions: { j: () => 'session' }, staticRender: { v6e: render } }
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
