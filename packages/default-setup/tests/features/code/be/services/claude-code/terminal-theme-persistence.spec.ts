import vm from 'node:vm'
import { claudeTerminalThemePanelRuntime } from '#features/code/be/services/claude-code/terminal-theme-panel-runtime.ts'

const saved = { name: 'Release', base: 'dark', overrides: { text: '#55ccaa' } }
function setup(v5 = false) {
  const provider = { read: vi.fn(async (_keys: unknown[]) => ({ ok: true, value: { items: [{ found: true, value: Buffer.from(JSON.stringify(saved)) }] } })) }
  const identity: any[] = Array(152)
  Object.assign(identity, { 24: 'dark', 25: ' Release ', 27: provider, 34: saved.overrides, 36: 'release' })
  const read: any = { snapshot: { revision: 'before' }, identity }
  const current = vi.fn(), entry: any = { current }
  const gate = { W: vi.fn(() => v5) }
  const keys = { Tr: vi.fn(() => true), Be: { userConfigDir: vi.fn((dir: string, names: string[]) => ({ dir, names })) } }
  const store = { ost: vi.fn(() => '/original/themes'), Ecr: vi.fn(async () => [{ ...saved, slug: 'release' }]) }
  const n = { themeStorageGate: gate, themeStorageKeys: keys, themeStore: store }
  const api = vm.runInNewContext(`${claudeTerminalThemePanelRuntime};
    nativeThemeCommandFrame=(_n,entry)=>entry.current();
    waitForNativeThemePanel=async()=>({...read,snapshot:{...read.snapshot,revision:read.snapshot.editor?read.snapshot.revision:'fresh'}});readNativeThemePanel=waitForNativeThemePanel;
    ({nativeThemeCommitTarget,nativeThemeCommitResult,nativeThemePanel});`, {
    Buffer, Date, read, setTimeout, sameNativeSettingsFiber:()=>true, currentNativeSettingsFiber:()=>read.fiber, awaitNativeSettingsReading: async (work: Promise<unknown>, signal: AbortSignal) => {
      const result = await work; signal.throwIfAborted(); return result
    },
  })
  entry.themeCommit = { ...api.nativeThemeCommitTarget(n, read), until: Date.now() + 10000 }
  const abort = new AbortController()
  return { api, n, read, entry, current, provider, gate, keys, store, abort,
    check: () => api.nativeThemeCommitResult(n, entry, read, abort) }
}

it('uses original filesystem readback and refreshes the mounted snapshot without inventing a Saved result', async () => {
  const s = setup(), result = await s.check()
  expect(s.store.Ecr).toHaveBeenCalledWith('/original/themes', 'user')
  expect(s.provider.read).not.toHaveBeenCalled()
  expect(result).toEqual({ snapshot: { revision: 'fresh' } })
  expect(s.entry.themeCommit).toBeUndefined()
})
it('uses the exact original writer provider and canonical key when storageV5 is admitted', async () => {
  const s = setup(true); await s.check()
  expect(s.keys.Be.userConfigDir).toHaveBeenCalledWith('themes', ['release.json'])
  expect(s.provider.read).toHaveBeenCalledWith([{ dir: 'themes', names: ['release.json'] }])
  expect(s.store.Ecr).not.toHaveBeenCalled()
})
it('keeps unconfirmed persistence pending, then reports an honest problem, and permits late confirmation', async () => {
  const s = setup(); s.store.Ecr.mockResolvedValue([])
  expect((await s.check()).snapshot.commitPending).toBe(true)
  s.entry.themeCommit.until = Date.now() - 1
  const unconfirmed = await s.check()
  expect(unconfirmed.problem).toMatch(/has not confirmed saving/)
  expect(unconfirmed.snapshot.commitPending).toBeUndefined()
  s.store.Ecr.mockResolvedValue([{ ...saved, slug: 'release' }])
  expect((await s.check()).problem).toBeUndefined()
  expect(s.entry.themeCommit).toBeUndefined()
})
it('does not mistake unreadable storage for confirmed persistence', async () => {
  const s = setup(true); s.provider.read.mockRejectedValue(Error('storage unavailable')); s.entry.themeCommit.until = Date.now() - 1
  expect((await s.check()).problem).toMatch(/has not confirmed saving/)
  expect(s.entry.themeCommit).toBeDefined()
})
it.each(['commit', 'gate', 'provider', 'owner', 'cancel'] as const)('rejects a held read after %s replacement or retirement', async kind => {
  const s = setup(true)
  let release!: (result: any) => void
  s.provider.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const checking = s.check()
  if (kind === 'commit') s.entry.themeCommit = { ...s.entry.themeCommit }
  if (kind === 'gate') s.gate.W.mockReturnValue(false)
  if (kind === 'provider') s.read.identity[27] = {}
  if (kind === 'owner') s.current.mockImplementation(() => { throw Error('owner retired') })
  if (kind === 'cancel') s.abort.abort(Error('cancelled'))
  release({ ok: true, value: { items: [{ found: true, value: Buffer.from(JSON.stringify(saved)) }] } })
  await expect(checking).rejects.toThrow()
})
it('derives the expected name from the original writer trimming contract', () => {
  const s = setup(), target = s.api.nativeThemeCommitTarget(s.n, s.read)
  expect(target.provider).toBe(s.provider)
  expect(target.value).toContain('"Release"')
  expect(target.value).not.toContain(' Release ')
})
it('refuses oversized original override values', () => {
  const s = setup(); s.read.identity[34] = { text: 'x'.repeat(16385) }
  expect(() => s.api.nativeThemeCommitTarget(s.n, s.read)).toThrow(/bound/)
})

it('opens the original retry form without carrying an old unconfirmed error that disables Save', async () => {
  const s = setup(), props = {}, fiber = { memoizedProps: props }
  Object.assign(s.read, { props, fiber, owner: {}, controls: { select: vi.fn(() => {
    s.read.snapshot = { revision: 'retry', editor: { kind: 'form', revision: 'retry-editor', fields: [] } }
  }) } })
  s.read.snapshot.editor = { kind: 'choice', revision: 'tokens', options: [{ value: 'text', disabled: false }] }
  s.entry.themeCommit.until = Date.now() - 1
  const result = await s.api.nativeThemePanel(s.n, s.entry, { operation: 'editor', revision: 'before', editor_revision: 'tokens', command: { action: 'select', value: 'text' } }, s.abort)
  expect(s.read.controls.select).toHaveBeenCalledExactlyOnceWith('text')
  expect(s.entry.themeCommit).toBeUndefined()
  expect(result.snapshot.editor.kind).toBe('form')
  expect(result.problem).toBeUndefined()
  expect(result.snapshot.commitPending).toBeUndefined()
})

it('explains the original Reset recovery route when its in-memory removal was not persisted', async () => {
  const s = setup(); s.store.Ecr.mockResolvedValue([])
  s.entry.themeCommit.operation = 'reset'; s.entry.themeCommit.until = Date.now() - 1
  const result = await s.check()
  expect(result.problem).toBe('Claude Code has not confirmed resetting this color. Reopen the theme editor to retry Reset.')
  expect(result.savedKey).toBeUndefined()
  expect(s.entry.themeCommit).toBeDefined()
})
