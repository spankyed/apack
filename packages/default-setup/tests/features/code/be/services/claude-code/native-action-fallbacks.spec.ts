import { withClaudeDesktopActionFallbacks, type ClaudeNativeActionHandler } from '#features/code/be/services/claude-code/native-action-fallbacks.ts'

function fixture() {
  const engine = vi.fn(), terminal = vi.fn(), admit = vi.fn(() => true)
  const owned: ClaudeNativeActionHandler = { action: 'review', context: 'Global', fallback: true, handler: terminal }
  const priority: ClaudeNativeActionHandler = { action: 'review', context: 'Global', handler: engine }
  const registry = new Map([['review', new Set([owned, priority])]])
  const register = (entry: ClaudeNativeActionHandler) => {
    if (!registry.has(entry.action)) registry.set(entry.action, new Set())
    const entries = registry.get(entry.action)!
    entries.add(entry)
    return () => { entries.delete(entry); if (!entries.size) registry.delete(entry.action) }
  }
  return { engine, terminal, admit, owned, priority, registry, register }
}

it('leaves engine handlers intact and admits desktop fallbacks without invoking hidden terminal callbacks', () => {
  const f = fixture(), originalSet = f.registry.get('review')!
  withClaudeDesktopActionFallbacks(f.registry, [{ action: 'review', contexts: ['Global'] }], f.register, f.admit, () => {
    expect(f.registry.get('review')).toBe(originalSet)
    expect(f.priority.handler).toBe(f.engine)
    f.priority.handler(); f.owned.handler()
  })
  expect(f.engine).toHaveBeenCalledOnce(); expect(f.admit).toHaveBeenCalledWith('review')
  expect(f.terminal).not.toHaveBeenCalled()
  expect(f.registry.get('review')).toBe(originalSet)
  expect(originalSet).toEqual(new Set([f.owned, f.priority]))
  expect(f.owned.handler).toBe(f.terminal)
  expect(Object.hasOwn(f.registry, 'get')).toBe(false)
  expect(Object.hasOwn(originalSet, 'add')).toBe(false)
})

it('preserves removals and new native registrations instead of restoring a stale registry snapshot', () => {
  const f = fixture(), late = vi.fn()
  const newcomer: ClaudeNativeActionHandler = { action: 'late', context: 'Global', fallback: true, handler: late }
  withClaudeDesktopActionFallbacks(f.registry, [{ action: 'review', contexts: ['Global'] }], f.register, f.admit, () => {
    f.registry.get('review')!.delete(f.owned)
    f.register(newcomer)
    expect(newcomer.handler()).toBe(false)
  })
  expect(f.registry.get('review')!.has(f.owned)).toBe(false)
  expect(f.registry.get('late')).toEqual(new Set([newcomer]))
  expect(newcomer.handler).toBe(late); expect(late).not.toHaveBeenCalled()
})

it('cleans up temporary registrations and forwarding methods when original dispatch throws', () => {
  const f = fixture(), error = Error('Original dispatch failed')
  expect(() => withClaudeDesktopActionFallbacks(f.registry, [{ action: 'desktop-only', contexts: ['Global'] }], f.register, f.admit, () => { throw error })).toThrow(error)
  expect(f.registry.has('desktop-only')).toBe(false)
  expect(f.owned.handler).toBe(f.terminal)
  expect(Object.hasOwn(f.registry, 'get')).toBe(false)
  expect(Object.hasOwn(f.registry.get('review')!, 'add')).toBe(false)
})

it('restores earlier substitutions when a later original registration refuses replacement', () => {
  const f = fixture()
  const locked: ClaudeNativeActionHandler = { action: 'locked', context: 'Global', fallback: true, handler: vi.fn() }
  Object.defineProperty(locked, 'handler', { writable: false })
  f.registry.set('locked', new Set([locked]))
  expect(() => withClaudeDesktopActionFallbacks(f.registry, [], f.register, f.admit, () => { throw Error('Must not dispatch') })).toThrow()
  expect(f.owned.handler).toBe(f.terminal)
  expect(Object.hasOwn(f.registry, 'get')).toBe(false)
  expect(Object.hasOwn(f.registry.get('review')!, 'add')).toBe(false)
})
