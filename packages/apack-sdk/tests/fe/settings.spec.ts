// The settings a feature reads and changes of its own, without reaching into the view that draws them. The
// composables follow the settings for as long as the scope calling them lives, as useShell() does, and refuse to
// start outside a scope, where nothing would ever stop them.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, reactive, readonly } from 'vue'
import { _createFeSettings, useFeatureSettings, useSettingsSave, useAppSettings } from '../../src/fe/settings.ts'
import { fakeSettings, type FakeSettings } from '../../src/testing/fake-settings.ts'
import { startFeTestRuntime } from '../../src/testing/fe-runtime.ts'
import { bindFeHost, unbindFeHost } from '../../src/runtime/fe-host.ts'
import type { FeatureRef } from '../../src/ids/index.ts'
import { _settingsJsonProblems } from '../../src/framework/settings-validation.ts'

const CODE = 'default-setup/code' as FeatureRef

let settings: FakeSettings
let frontendSettings: ReturnType<typeof _createFeSettings>

beforeEach(() => {
  settings = fakeSettings({ app: { projects: ['one'] }, features: { [CODE]: { mdEditorDefault: true } } })
  frontendSettings = _createFeSettings()
  frontendSettings.bindSettings(settings).activate()
  bindFeHost({ catalog: {} as never, application: {} as never, secrets: {} as never, settings, client: {} as never, packs: {} as never })
})
afterEach(() => unbindFeHost())

/** Runs `body` in a scope, as a component's setup does, and returns it with the scope that holds it */
function inScope<T>(body: () => T): { value: T; stop: () => void } {
  const scope = effectScope()
  const value = scope.run(body)!
  return { value, stop: () => scope.stop() }
}

it.each(['form', 'handle'] as const)('%s writes detach nested Vue drafts before transport', async kind => {
  const target = { kind: 'feature', featureRef: CODE } as const
  const value = reactive([{ shortcut: reactive({ key: 'F7', modifiers: ['ctrl'], global: true }) }])
  const condition = readonly({ runId: 'run', expected: { exists: true, value: reactive([{ name: 'before' }]) } })
  let sent: unknown
  let compared: unknown
  vi.spyOn(settings, 'update').mockImplementation((_target, _path, value, condition) => {
    sent = structuredClone(value)
    compared = structuredClone(condition)
    return Promise.resolve({ status: 'saved' })
  })
  const scope = inScope(() => kind === 'form' ? useSettingsSave(settings) : frontendSettings.useSettings<{ modes: typeof value }>(target))
  const result = 'update' in scope.value
    ? await scope.value.update(target, ['modes'], value, condition)
    : await scope.value.set({ path: ['modes'], value, condition })
  expect(result).toEqual({ status: 'saved' })
  expect(sent).toEqual([{ shortcut: { key: 'F7', modifiers: ['ctrl'], global: true } }])
  expect(compared).toEqual({ runId: 'run', expected: { exists: true, value: [{ name: 'before' }] } })
  value[0]!.shortcut.modifiers.push('alt')
  expect(sent).toEqual([{ shortcut: { key: 'F7', modifiers: ['ctrl'], global: true } }])
  scope.stop()
})

it('does not turn invalid reactive data into valid JSON settings', async () => {
  vi.spyOn(settings, 'update').mockImplementation((_target, _path, value) => {
    const problems = _settingsJsonProblems(value)
    return Promise.resolve(problems.length
      ? { status: 'refused', problems: problems.map(problem => problem.message) }
      : { status: 'saved' })
  })
  const scope = inScope(() => useSettingsSave(settings))
  const cycle: Record<string, unknown> = reactive({})
  cycle.self = cycle
  for (const value of [reactive({ missing: undefined }), reactive({ number: Infinity }), reactive({ date: new Date() }), cycle]) {
    expect((await scope.value.update({ kind: 'app' }, [], value)).status).toBe('refused')
  }
  scope.stop()
})

it('reads host app preferences, and follows it', () => {
  const { value: general, stop } = inScope(() => useAppSettings())
  expect(general.value).toEqual({ projects: ['one'] })

  settings.set({ app: { projects: ['one', 'two'] } })
  expect(general.value).toEqual({ projects: ['one', 'two'] })

  stop()
  settings.set({ app: { projects: [] } })
  expect(general.value).toEqual({ projects: ['one', 'two'] }) // the scope is gone; nothing follows it any more
})

it("reads a feature's own settings, and follows them", () => {
  const { value: code, stop } = inScope(() => useFeatureSettings<{ mdEditorDefault: boolean }>(CODE))
  expect(code.value).toEqual({ mdEditorDefault: true })

  settings.update({ kind: 'feature', featureRef: CODE }, ['mdEditorDefault'], false)
  expect(code.value).toEqual({ mdEditorDefault: false })

  stop()
})

it('changes app and feature preferences at the address the caller named', () => {
  const { value: save, stop } = inScope(() => useSettingsSave(settings))

  save.update({ kind: 'app' }, ['projects'], ['three'])
  save.update({ kind: 'feature', featureRef: CODE }, ['cliPaths', 'git'], '/opt/bin/git')

  expect(settings.updates).toEqual([
    { target: { kind: 'app' }, path: ['projects'], value: ['three'] },
    { target: { kind: 'feature', featureRef: CODE }, path: ['cliPaths', 'git'], value: '/opt/bin/git' },
  ])
  expect(settings.get({ kind: 'app' })).toEqual({ projects: ['three'] })
  expect(settings.get({ kind: 'feature', featureRef: CODE })).toEqual({ mdEditorDefault: true, cliPaths: { git: '/opt/bin/git' } })
  stop()
})

it('keeps save status local to the form that made the request', async () => {
  const first = inScope(() => useSettingsSave(settings))
  const other = inScope(() => useSettingsSave(settings))
  expect(first.value.save.value).toEqual({ status: 'idle', problems: [] })
  settings.answer({ status: 'refused', problems: ['invalid value'] })
  await first.value.update({ kind: 'app' }, ['projects'], [])
  expect(first.value.save.value).toEqual({ status: 'refused', problems: ['invalid value'] })
  expect(other.value.save.value).toEqual({ status: 'idle', problems: [] })
  first.stop()
  other.stop()
})

it('refuses reactive settings access outside a component or effect scope', () => {

  expect(() => useAppSettings()).toThrow('runs in a component or an effect scope')
  expect(() => useFeatureSettings(CODE)).toThrow('runs in a component or an effect scope')
  expect(() => useSettingsSave(settings)).toThrow('runs in a component or an effect scope')
})

// A test that reads settings it never said anything about can't know what it asserts, so the stand-in says where
// the usable one is instead of answering with an empty document
it('names fakeSettings when a test reaches for settings it did not pass', () => {
  unbindFeHost()
  const stopRuntime = startFeTestRuntime()

  expect(() => inScope(() => useAppSettings()))
    .toThrow('pass settings: fakeSettings({ … }) from @apackdev/sdk/testing to startFeTestRuntime')

  stopRuntime()
})


it('typed handles follow their feature, write through the port and reset its overrides', () => {
  const { value: code, stop } = inScope(() => frontendSettings.useSettings<{ mdEditorDefault: boolean }>({ kind: 'feature', featureRef: CODE }))
  code.set({ path: ['mdEditorDefault'], value: false })
  expect(code.value.value).toEqual({ mdEditorDefault: false })
  code.reset()
  expect(code.value.value).toBeUndefined()
  stop()
  settings.set({ features: { [CODE]: { mdEditorDefault: true } } })
  expect(code.value.value).toBeUndefined()
})

it('binds reactive pack-group reads and mutations to one namespaced target', async () => {
  settings.set({ packs: { examples: { assistant: { name: 'Ada' } } } })
  const target = { kind: 'pack', packId: 'examples', groupId: 'assistant' } as const
  const { value: handle, stop } = inScope(() => frontendSettings.useSettings<{ name: string }>(target))
  expect(handle.value.value).toEqual({ name: 'Ada' })
  await handle.set({ path: ['name'], value: 'Grace' })
  expect(settings.updates).toEqual([{ target, path: ['name'], value: 'Grace' }])
  expect(handle.value.value).toEqual({ name: 'Grace' })
  stop()
  settings.set({ packs: { examples: { assistant: { name: 'After disposal' } } } })
  expect(handle.value.value).toEqual({ name: 'Grace' })
})

it('requires host acceptance and never falls back to the ambient administrative port', async () => {
  const generated = _createFeSettings()
  expect(() => inScope(() => generated.useSettings({ kind: 'feature', featureRef: CODE }))).toThrow('before host acceptance')
  const scoped = fakeSettings({ features: { [CODE]: { limit: 1 } } })
  const update = vi.spyOn(scoped, 'update')
  const { activate, dispose: revoke } = generated.bindSettings(scoped)
  activate()
  const { value: handle, stop } = inScope(() => generated.useSettings<{ limit: number }>({ kind: 'feature', featureRef: CODE }))
  await handle.set({ path: ['limit'], value: 2, condition: { runId: 'run', expected: { exists: true, value: 1 } } })
  expect(update).toHaveBeenCalledWith({ kind: 'feature', featureRef: CODE }, ['limit'], 2,
    { runId: 'run', expected: { exists: true, value: 1 } })
  expect(scoped.updates).toHaveLength(1)
  expect(settings.updates).toEqual([])
  const candidate = generated.bindSettings(settings)
  candidate.dispose()
  expect(handle.value.value).toEqual({ limit: 2 })
  revoke()
  expect((await handle.set({ path: ['limit'], value: 3 })).status).toBe('refused')
  expect((await handle.reset()).status).toBe('refused')
  expect(() => inScope(() => generated.useSettings({ kind: 'feature', featureRef: CODE }))).toThrow('after unload')
  stop()
})

it('does not reactivate retained handles or subscriptions when a cached frontend module is rebound', async () => {
  const generated = _createFeSettings()
  const first = fakeSettings({ features: { [CODE]: { limit: 1 } } })
  const { activate, dispose: revoke } = generated.bindSettings(first)
  activate()
  const old = inScope(() => generated.useSettings<{ limit: number }>({ kind: 'feature', featureRef: CODE }))
  revoke()
  const second = fakeSettings({ features: { [CODE]: { limit: 10 } } })
  const { activate: activateSecond, dispose: revokeSecond } = generated.bindSettings(second)
  activateSecond()
  revoke()
  first.set({ features: { [CODE]: { limit: 100 } } })
  expect(old.value.value.value).toEqual({ limit: 1 })
  expect((await old.value.set({ path: ['limit'], value: 2 })).status).toBe('refused')
  const next = inScope(() => generated.useSettings<{ limit: number }>({ kind: 'feature', featureRef: CODE }))
  await next.value.set({ path: ['limit'], value: 11 })
  expect(second.updates).toHaveLength(1)
  expect(first.updates).toEqual([])
  old.stop()
  next.stop()
  revokeSecond()
})

it('releases every subscription once even when one cleanup throws', () => {
  const generated = _createFeSettings()
  const failedStop = vi.fn(() => { throw new Error('failed cleanup') })
  const healthyStop = vi.fn()
  const source = { ...settings, subscribe: vi.fn().mockReturnValueOnce(failedStop).mockReturnValueOnce(healthyStop) }
  const { activate, dispose: revoke } = generated.bindSettings(source)
  activate()
  const first = inScope(() => generated.useSettings({ kind: 'app' }))
  const second = inScope(() => generated.useSettings({ kind: 'app' }))
  expect(revoke).toThrow('could not be disposed')
  expect(failedStop).toHaveBeenCalledOnce()
  expect(healthyStop).toHaveBeenCalledOnce()
  expect(() => revoke()).not.toThrow()
  first.stop()
  second.stop()
  expect(failedStop).toHaveBeenCalledOnce()
  expect(healthyStop).toHaveBeenCalledOnce()
})


it('uses the explicitly supplied writer even when another settings port is bound to the window', async () => {
  const scoped = fakeSettings({ features: { [CODE]: { count: 1 } } });
  const { value: save, stop } = inScope(() => useSettingsSave(scoped));
  await save.update({ kind: 'feature', featureRef: CODE }, ['count'], 2);
  expect(scoped.get({ kind: 'feature', featureRef: CODE })).toEqual({ count: 2 });
  expect(settings.updates).toEqual([]);
  stop();
});


it('requires explicit activation and refuses disposed preparations', () => {
  const generated = _createFeSettings()
  const candidate = generated.bindSettings(settings)
  expect(() => inScope(() => generated.useSettings({ kind: 'app' }))).toThrow('before host acceptance')
  candidate.dispose()
  expect(() => candidate.activate()).toThrow('Only pending')
  expect(() => inScope(() => generated.useSettings({ kind: 'app' }))).toThrow('before host acceptance')
})
